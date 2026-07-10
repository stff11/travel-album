import { Router, type IRouter } from "express";
import multer from "multer";
import crypto from "crypto";
import { db, photosTable, tripsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import {
  ListPhotosQueryParams,
  GetPhotoParams,
  DeletePhotoParams,
  ListPhotosResponse,
  GetPhotoResponse,
  RegroupPhotosResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { assignPhotoToTrip, regroupAllPhotos } from "../lib/tripGrouping";
import { uploadToCloudinary, deleteFromCloudinary } from "../lib/cloudinary";
import exifr from "exifr";

const router: IRouter = Router();

type DbPhoto = typeof photosTable.$inferSelect;

function serializePhoto(p: DbPhoto) {
  return {
    ...p,
    takenAt: p.takenAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

// MemoryStorage avoids disk I/O and potential /tmp issues
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

router.get("/photos", async (req, res): Promise<void> => {
  const params = ListPhotosQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const photos = params.data.tripId
    ? await db.select().from(photosTable).where(eq(photosTable.tripId, params.data.tripId))
    : await db.select().from(photosTable);
  res.json(ListPhotosResponse.parse(photos.map(serializePhoto)));
});

router.post("/photos/regroup", async (req, res): Promise<void> => {
  const result = await regroupAllPhotos();
  res.json(RegroupPhotosResponse.parse(result));
});

router.post(
  "/photos/upload",
  upload.single("file"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const { buffer, originalname, mimetype } = req.file;

    // 1. Deduplication (Hash raw buffer)
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const [existing] = await db.select().from(photosTable).where(eq(photosTable.fileHash, fileHash));
    if (existing) {
      res.status(201).json(GetPhotoResponse.parse(serializePhoto(existing)));
      return;
    }

    // 2. Metadata Extraction (from memory buffer)
    let lat = null, lng = null, takenAt = new Date();
    try {
      const data = await exifr.parse(buffer, { gps: true, tiff: true, exif: true });
      if (data?.latitude && data?.longitude) { lat = data.latitude; lng = data.longitude; }
      if (data?.DateTimeOriginal) takenAt = data.DateTimeOriginal;
    } catch (err) { logger.warn({ err }, "EXIF extraction failed"); }

    // 3. Upload directly to Cloudinary (buffer stream)
    try {
      const cdn = await uploadToCloudinary(buffer);

      // 4. Save to DB
      const [photo] = await db.insert(photosTable).values({
        filename: originalname,
        originalName: originalname,
        mimeType: mimetype,
        fileHash,
        cloudinaryPublicId: cdn.publicId,
        cloudinaryUrl: cdn.secureUrl,
        lat, lng, takenAt,
        tripId: null,
      }).returning();

      // 5. Grouping Logic
      const tripId = await assignPhotoToTrip({ ...photo, lat, lng, takenAt });
      if (tripId != null) {
        await db.update(photosTable).set({ tripId }).where(eq(photosTable.id, photo.id));
        photo.tripId = tripId;
      }

      res.status(201).json(GetPhotoResponse.parse(serializePhoto(photo)));
    } catch (err) {
      logger.error({ err }, "Cloudinary upload failed");
      res.status(500).json({ error: "Failed to upload image" });
    }
  }
);

router.get("/photos/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetPhotoParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [photo] = await db.select().from(photosTable).where(eq(photosTable.id, params.data.id));
  if (!photo) { res.status(404).json({ error: "Photo not found" }); return; }
  res.json(GetPhotoResponse.parse(serializePhoto(photo)));
});

router.delete("/photos/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeletePhotoParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const photo = await db.transaction(async (tx) => {
    const [deleted] = await tx.delete(photosTable).where(eq(photosTable.id, params.data.id)).returning();
    if (!deleted) return null;

    if (deleted.tripId) {
      // Lock the trip row so concurrent deletes of photos in the same trip
      // (e.g. a bulk delete) are serialized instead of racing to read/write
      // photoCount, centerLat/Lng and coverPhotoId off stale data.
      const [trip] = await tx
        .select()
        .from(tripsTable)
        .where(eq(tripsTable.id, deleted.tripId))
        .for("update");

      const remaining = await tx
        .select()
        .from(photosTable)
        .where(eq(photosTable.tripId, deleted.tripId))
        .orderBy(asc(photosTable.takenAt));

      if (remaining.length === 0) {
        await tx.delete(tripsTable).where(eq(tripsTable.id, deleted.tripId));
      } else {
        // Recompute the center from the photos that are actually still in the trip,
        // so a deleted outlier photo no longer skews the map position.
        const geotagged = remaining.filter((p) => p.lat != null && p.lng != null);
        const centerLat = geotagged.length > 0
          ? geotagged.reduce((s, p) => s + (p.lat as number), 0) / geotagged.length
          : trip?.centerLat ?? null;
        const centerLng = geotagged.length > 0
          ? geotagged.reduce((s, p) => s + (p.lng as number), 0) / geotagged.length
          : trip?.centerLng ?? null;

        // If the deleted photo was the cover, promote the earliest remaining photo instead.
        const coverPhotoId = trip?.coverPhotoId === deleted.id ? remaining[0].id : trip?.coverPhotoId;

        await tx
          .update(tripsTable)
          .set({ photoCount: remaining.length, centerLat, centerLng, coverPhotoId })
          .where(eq(tripsTable.id, deleted.tripId));
      }
    }

    return deleted;
  });
  if (!photo) { res.status(404).json({ error: "Photo not found" }); return; }

  try { await deleteFromCloudinary(photo.cloudinaryPublicId); } catch (e) { logger.warn("Cloudinary delete failed"); }
  res.sendStatus(204);
});

export default router;