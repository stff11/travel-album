import { Router, type IRouter } from "express";
import multer from "multer";
import crypto from "crypto";
import { db, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListPhotosQueryParams,
  GetPhotoParams,
  DeletePhotoParams,
  ListPhotosResponse,
  GetPhotoResponse,
  RegroupPhotosResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { assignPhotoToTrip, lockTripAssignment, regroupAllPhotos } from "../lib/tripGrouping";
import { recomputeTrip } from "../lib/tripStats";
import { uploadToCloudinary, deleteFromCloudinary } from "../lib/cloudinary";
import { requireAdmin } from "../lib/auth";
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

// ADMIN ONLY
router.post("/photos/regroup", requireAdmin, async (_req, res): Promise<void> => {
  const result = await regroupAllPhotos();
  res.json(RegroupPhotosResponse.parse(result));
});

// Anyone may upload.
router.post(
  "/photos/upload",
  upload.single("file"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const { buffer, originalname, mimetype } = req.file;

    // 1. Deduplication (hash raw buffer)
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const [existing] = await db.select().from(photosTable).where(eq(photosTable.fileHash, fileHash));
    if (existing) {
      // An earlier upload may have been left without a trip (e.g. its trip was
      // deleted or assignment failed). Give it another chance to be placed.
      if (existing.tripId == null && existing.lat != null && existing.lng != null) {
        await placePhotoInTrip(existing);
        const [fresh] = await db.select().from(photosTable).where(eq(photosTable.id, existing.id));
        res.status(201).json(GetPhotoResponse.parse(serializePhoto(fresh ?? existing)));
        return;
      }
      res.status(201).json(GetPhotoResponse.parse(serializePhoto(existing)));
      return;
    }

    // 2. Metadata extraction (from memory buffer)
    let lat: number | null = null;
    let lng: number | null = null;
    let takenAt = new Date();
    try {
      const data = await exifr.parse(buffer, { gps: true, tiff: true, exif: true });
      if (data?.latitude != null && data?.longitude != null) {
        lat = data.latitude;
        lng = data.longitude;
      }
      if (data?.DateTimeOriginal) takenAt = data.DateTimeOriginal;
    } catch (err) {
      logger.warn({ err }, "EXIF extraction failed");
    }

    // 3. Upload to Cloudinary
    let cdn: Awaited<ReturnType<typeof uploadToCloudinary>>;
    try {
      cdn = await uploadToCloudinary(buffer);
    } catch (err) {
      logger.error({ err }, "Cloudinary upload failed");
      res.status(500).json({ error: "Failed to upload image" });
      return;
    }

    // 4. Insert + assign to a trip + update the trip's totals, atomically.
    //    Either everything is saved or nothing is, so photo_count can't drift.
    try {
      const photo = await db.transaction(async (tx) => {
        await lockTripAssignment(tx);

        const [inserted] = await tx
          .insert(photosTable)
          .values({
            filename: originalname,
            originalName: originalname,
            mimeType: mimetype,
            fileHash,
            cloudinaryPublicId: cdn.publicId,
            cloudinaryUrl: cdn.secureUrl,
            lat,
            lng,
            takenAt,
            tripId: null,
          })
          .returning();

        await assignPhotoToTrip(tx, { ...inserted, lat, lng, takenAt });
        const [final] = await tx.select().from(photosTable).where(eq(photosTable.id, inserted.id));
        return final ?? inserted;
      });

      res.status(201).json(GetPhotoResponse.parse(serializePhoto(photo)));
    } catch (err) {
      // Roll back the CDN copy so we don't leak an unreferenced file.
      await deleteFromCloudinary(cdn.publicId);

      // Two people uploaded the identical file at the same moment: the unique
      // hash index rejected the second one. Return the winner.
      if ((err as { code?: string })?.code === "23505") {
        const [winner] = await db.select().from(photosTable).where(eq(photosTable.fileHash, fileHash));
        if (winner) {
          res.status(201).json(GetPhotoResponse.parse(serializePhoto(winner)));
          return;
        }
      }
      logger.error({ err }, "Saving photo failed");
      res.status(500).json({ error: "Failed to save photo" });
    }
  },
);

async function placePhotoInTrip(photo: DbPhoto): Promise<void> {
  await db.transaction(async (tx) => {
    await lockTripAssignment(tx);
    await assignPhotoToTrip(tx, photo);
  });
}

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

// ADMIN ONLY
router.delete("/photos/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeletePhotoParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const photo = await db.transaction(async (tx) => {
    // Same lock as uploads/merges so trip totals are never computed from a
    // half-finished change.
    await lockTripAssignment(tx);

    const [deleted] = await tx.delete(photosTable).where(eq(photosTable.id, params.data.id)).returning();
    if (!deleted) return null;

    if (deleted.tripId) {
      // Recounts photos, dates, map center and cover from what is really
      // left, and removes the trip if it is now empty.
      await recomputeTrip(tx, deleted.tripId);
    }
    return deleted;
  });
  if (!photo) { res.status(404).json({ error: "Photo not found" }); return; }

  await deleteFromCloudinary(photo.cloudinaryPublicId);
  res.sendStatus(204);
});

export default router;
