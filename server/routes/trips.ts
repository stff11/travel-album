import { Router, type IRouter } from "express";
import { db, photosTable, tripsTable } from "@workspace/db";
import { eq, and, asc, desc, inArray, type SQL } from "drizzle-orm";
import {
  GetTripParams,
  UpdateTripParams,
  UpdateTripBody,
  DeleteTripParams,
  GetTripPhotosParams,
  ListTripsResponse,
  GetTripResponse,
  GetTripsMapResponse,
  UpdateTripResponse,
  GetTripPhotosResponse,
  MergeTripsParams,
  MergeTripsBody,
  MergeTripsResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth";
import { deleteManyFromCloudinary } from "../lib/cloudinary";
import { lockTripAssignment } from "../lib/tripGrouping";
import { livePhotoCount, recomputeTrip, repairAllTrips } from "../lib/tripStats";

const router: IRouter = Router();

type DbPhoto = typeof photosTable.$inferSelect;
type DbTrip = typeof tripsTable.$inferSelect;

function serializePhoto(p: DbPhoto) {
  return {
    ...p,
    takenAt: p.takenAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

type TripRow = {
  trip: DbTrip;
  coverFilename: string | null;
  coverCloudinaryUrl: string | null;
  livePhotoCount: number;
};

/**
 * Trips + cover photo + live photo count in ONE query (previously: one extra
 * query per trip). The count is computed from the photos table on every read,
 * so the number shown can never be stale.
 */
async function loadTripRows(where?: SQL): Promise<TripRow[]> {
  const q = db
    .select({
      trip: tripsTable,
      coverFilename: photosTable.filename,
      coverCloudinaryUrl: photosTable.cloudinaryUrl,
      livePhotoCount,
    })
    .from(tripsTable)
    .leftJoin(photosTable, eq(photosTable.id, tripsTable.coverPhotoId));
  return where
    ? q.where(where).orderBy(desc(tripsTable.startDate))
    : q.orderBy(desc(tripsTable.startDate));
}

function serializeTrip(row: TripRow) {
  const { trip } = row;
  return {
    ...trip,
    photoCount: row.livePhotoCount,
    startDate: trip.startDate.toISOString(),
    endDate: trip.endDate.toISOString(),
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
    coverPhotoPath: row.coverFilename,
    coverCloudinaryUrl: row.coverCloudinaryUrl,
  };
}

async function loadTrip(id: number) {
  const [row] = await loadTripRows(eq(tripsTable.id, id));
  return row ? serializeTrip(row) : null;
}

router.get("/trips", async (_req, res): Promise<void> => {
  const rows = await loadTripRows();
  res.json(ListTripsResponse.parse(rows.map(serializeTrip)));
});

router.get("/trips/map", async (_req, res): Promise<void> => {
  const rows = await loadTripRows();
  const result = rows
    .map((row) => ({
      id: row.trip.id,
      name: row.trip.name,
      centerLat: row.trip.centerLat ?? 0,
      centerLng: row.trip.centerLng ?? 0,
      photoCount: row.livePhotoCount,
      startDate: row.trip.startDate.toISOString(),
      endDate: row.trip.endDate.toISOString(),
      coverPhotoPath: row.coverFilename,
      coverCloudinaryUrl: row.coverCloudinaryUrl,
      locationName: row.trip.locationName ?? null,
    }))
    .filter((t) => t.centerLat !== 0 || t.centerLng !== 0);
  res.json(GetTripsMapResponse.parse(result));
});

// ADMIN ONLY — recount photos / dates / centers / covers for every trip.
// (Declared before "/trips/:id" routes; it is a POST so there is no clash.)
router.post("/trips/repair", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await repairAllTrips());
});
// Old name kept so existing bookmarks/scripts keep working.
router.post("/trips/recompute-centers", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await repairAllTrips());
});

router.get("/trips/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetTripParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const trip = await loadTrip(params.data.id);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  res.json(GetTripResponse.parse(trip));
});

// ADMIN ONLY
router.patch("/trips/:id", requireAdmin, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateTripParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateTripBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const patch = { ...body.data };
  if (typeof patch.name === "string") {
    patch.name = patch.name.trim();
    if (!patch.name) {
      res.status(400).json({ error: "Name cannot be empty" });
      return;
    }
  }

  // A cover must be a photo that actually belongs to this trip.
  if (patch.coverPhotoId != null) {
    const [cover] = await db
      .select({ id: photosTable.id })
      .from(photosTable)
      .where(and(eq(photosTable.id, patch.coverPhotoId), eq(photosTable.tripId, params.data.id)));
    if (!cover) {
      res.status(400).json({ error: "Cover photo must belong to this trip" });
      return;
    }
  }

  const [updated] = await db
    .update(tripsTable)
    .set(patch)
    .where(eq(tripsTable.id, params.data.id))
    .returning({ id: tripsTable.id });

  if (!updated) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  res.json(UpdateTripResponse.parse(await loadTrip(updated.id)));
});

// ADMIN ONLY — deletes the trip AND its photos (also from Cloudinary), which
// is what the confirmation dialog in the UI promises. Previously the photos
// were silently kept with no trip, so they could never be seen or counted.
router.delete("/trips/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteTripParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const publicIds = await db.transaction(async (tx) => {
    await lockTripAssignment(tx);

    const photos = await tx
      .select({ publicId: photosTable.cloudinaryPublicId })
      .from(photosTable)
      .where(eq(photosTable.tripId, params.data.id));

    await tx.delete(photosTable).where(eq(photosTable.tripId, params.data.id));
    const [trip] = await tx
      .delete(tripsTable)
      .where(eq(tripsTable.id, params.data.id))
      .returning({ id: tripsTable.id });

    return trip ? photos.map((p) => p.publicId) : null;
  });

  if (!publicIds) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  await deleteManyFromCloudinary(publicIds);
  res.sendStatus(204);
});

// ADMIN ONLY — moves every photo of `sourceId` into the trip in the URL.
router.post("/trips/:id/merge", requireAdmin, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = MergeTripsParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = MergeTripsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const targetId = params.data.id;
  const sourceId = body.data.sourceId;

  if (targetId === sourceId) {
    res.status(400).json({ error: "Cannot merge a trip into itself" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    await lockTripAssignment(tx);

    const found = await tx
      .select()
      .from(tripsTable)
      .where(inArray(tripsTable.id, [targetId, sourceId]));
    const target = found.find((t) => t.id === targetId);
    const source = found.find((t) => t.id === sourceId);
    if (!target) return "target-missing" as const;
    if (!source) return "source-missing" as const;

    await tx.update(photosTable).set({ tripId: targetId }).where(eq(photosTable.tripId, sourceId));

    if (target.coverPhotoId == null && source.coverPhotoId != null) {
      await tx.update(tripsTable).set({ coverPhotoId: source.coverPhotoId }).where(eq(tripsTable.id, targetId));
    }

    await tx.delete(tripsTable).where(eq(tripsTable.id, sourceId));
    await recomputeTrip(tx, targetId);
    return "ok" as const;
  });

  if (outcome === "target-missing") {
    res.status(404).json({ error: "Target trip not found" });
    return;
  }
  if (outcome === "source-missing") {
    res.status(404).json({ error: "Source trip not found" });
    return;
  }

  res.json(MergeTripsResponse.parse(await loadTrip(targetId)));
});

router.get("/trips/:id/photos", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetTripPhotosParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [trip] = await db
    .select({ id: tripsTable.id })
    .from(tripsTable)
    .where(eq(tripsTable.id, params.data.id));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const photos = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.tripId, params.data.id))
    .orderBy(asc(photosTable.takenAt), asc(photosTable.id));

  res.json(GetTripPhotosResponse.parse(photos.map(serializePhoto)));
});

export default router;
