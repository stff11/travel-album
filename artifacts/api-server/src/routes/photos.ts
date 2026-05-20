import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, photosTable, tripsTable } from "@workspace/db";
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
import { assignPhotoToTrip, regroupAllPhotos } from "../lib/tripGrouping";

const router: IRouter = Router();

type DbPhoto = typeof photosTable.$inferSelect;

function serializePhoto(p: DbPhoto) {
  return {
    ...p,
    takenAt: p.takenAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];
    const extOk = /\.(jpe?g|png|heic|heif|webp)$/i.test(file.originalname);
    if (allowed.includes(file.mimetype) || extOk) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

async function extractExif(filePath: string): Promise<{
  lat: number | null;
  lng: number | null;
  altitude: number | null;
  takenAt: Date | null;
  width: number | null;
  height: number | null;
}> {
  try {
    const exifr = await import("exifr");
    const data = await exifr.default.parse(filePath, {
      gps: true,
      tiff: true,
      exif: true,
      translateValues: true,
    });

    if (!data) return { lat: null, lng: null, altitude: null, takenAt: null, width: null, height: null };

    let lat: number | null = null;
    let lng: number | null = null;
    let altitude: number | null = null;
    let takenAt: Date | null = null;
    let width: number | null = null;
    let height: number | null = null;

    if (data.latitude != null && data.longitude != null) {
      lat = data.latitude;
      lng = data.longitude;
    }
    if (data.GPSAltitude != null) altitude = data.GPSAltitude;

    const dateVal = data.DateTimeOriginal ?? data.DateTime ?? data.CreateDate;
    if (dateVal instanceof Date) {
      takenAt = dateVal;
    } else if (typeof dateVal === "string") {
      const d = new Date(dateVal);
      if (!isNaN(d.getTime())) takenAt = d;
    }

    if (data.ImageWidth) width = data.ImageWidth;
    if (data.ImageHeight) height = data.ImageHeight;
    if (data.ExifImageWidth) width = data.ExifImageWidth;
    if (data.ExifImageHeight) height = data.ExifImageHeight;
    if (data.PixelXDimension) width = data.PixelXDimension;
    if (data.PixelYDimension) height = data.PixelYDimension;

    if (!width || !height) {
      try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(filePath).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
      } catch (_e) {}
    }

    return { lat, lng, altitude, takenAt, width, height };
  } catch (err) {
    logger.warn({ err }, "EXIF extraction failed, falling back to sharp");
    try {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(filePath).metadata();
      return {
        lat: null, lng: null, altitude: null, takenAt: null,
        width: meta.width ?? null,
        height: meta.height ?? null,
      };
    } catch (_e) {
      return { lat: null, lng: null, altitude: null, takenAt: null, width: null, height: null };
    }
  }
}

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

    const file = req.file;
    let actualPath = file.path;
    let actualMime = file.mimetype;

    const isHeic =
      actualMime === "image/heic" ||
      actualMime === "image/heif" ||
      /\.heic$/i.test(file.originalname) ||
      /\.heif$/i.test(file.originalname);

    if (isHeic) {
      try {
        const heicConvert = await import("heic-convert");
        const inputBuffer = fs.readFileSync(file.path);
        const outputBuffer = await heicConvert.default({
          buffer: inputBuffer,
          format: "JPEG",
          quality: 0.92,
        });
        const jpegPath = file.path.replace(/\.(heic|heif)$/i, ".jpg");
        const finalPath = jpegPath === file.path ? `${file.path}.jpg` : jpegPath;
        fs.writeFileSync(finalPath, Buffer.from(outputBuffer));
        fs.unlinkSync(file.path);
        actualPath = finalPath;
        actualMime = "image/jpeg";
        logger.info({ original: file.path, converted: finalPath }, "HEIC converted to JPEG");
      } catch (err) {
        logger.warn({ err }, "HEIC conversion failed, keeping original");
      }
    }

    const exif = await extractExif(actualPath);
    const filename = path.basename(actualPath);

    const [photo] = await db
      .insert(photosTable)
      .values({
        filename,
        originalName: file.originalname,
        filePath: actualPath,
        mimeType: actualMime,
        fileSize: fs.statSync(actualPath).size,
        width: exif.width,
        height: exif.height,
        lat: exif.lat,
        lng: exif.lng,
        altitude: exif.altitude,
        takenAt: exif.takenAt,
        tripId: null,
      })
      .returning();

    const tripId = await assignPhotoToTrip({
      id: photo.id,
      lat: photo.lat,
      lng: photo.lng,
      takenAt: photo.takenAt,
      filename: photo.filename,
    });

    if (tripId != null) {
      await db.update(photosTable).set({ tripId }).where(eq(photosTable.id, photo.id));
      photo.tripId = tripId;
    }

    req.log.info({ photoId: photo.id, tripId }, "Photo uploaded");
    res.status(201).json(GetPhotoResponse.parse(serializePhoto(photo)));
  }
);

router.get("/photos/file/:filename", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
  const filename = path.basename(raw);
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.sendFile(filePath);
});

router.get("/photos/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetPhotoParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [photo] = await db.select().from(photosTable).where(eq(photosTable.id, params.data.id));
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  res.json(GetPhotoResponse.parse(serializePhoto(photo)));
});

router.delete("/photos/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeletePhotoParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [photo] = await db
    .delete(photosTable)
    .where(eq(photosTable.id, params.data.id))
    .returning();

  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  if (photo.tripId) {
    const remaining = await db
      .select()
      .from(photosTable)
      .where(eq(photosTable.tripId, photo.tripId));
    if (remaining.length === 0) {
      await db.delete(tripsTable).where(eq(tripsTable.id, photo.tripId));
    } else {
      await db
        .update(tripsTable)
        .set({ photoCount: remaining.length })
        .where(eq(tripsTable.id, photo.tripId));
    }
  }

  try {
    if (photo.filePath && fs.existsSync(photo.filePath)) {
      fs.unlinkSync(photo.filePath);
    }
  } catch (err) {
    logger.warn({ err }, "Could not delete file");
  }

  res.sendStatus(204);
});

export default router;
