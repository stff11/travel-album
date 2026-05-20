import { Router, type IRouter } from "express";
import { db, photosTable, tripsTable } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
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
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

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

function serializeTrip(trip: DbTrip, coverPhotoFilename: string | null) {
  return {
    ...trip,
    startDate: trip.startDate.toISOString(),
    endDate: trip.endDate.toISOString(),
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
    coverPhotoPath: coverPhotoFilename,
  };
}

async function getCoverFilename(tripId: number | null | undefined, coverPhotoId: number | null | undefined): Promise<string | null> {
  if (!coverPhotoId) return null;
  const [p] = await db.select().from(photosTable).where(eq(photosTable.id, coverPhotoId));
  return p?.filename ?? null;
}

router.get("/trips", async (req, res): Promise<void> => {
  const trips = await db.select().from(tripsTable).orderBy(desc(tripsTable.startDate));

  const result = await Promise.all(
    trips.map(async (trip) => {
      const cover = await getCoverFilename(trip.id, trip.coverPhotoId);
      return serializeTrip(trip, cover);
    })
  );

  res.json(ListTripsResponse.parse(result));
});

router.get("/trips/map", async (req, res): Promise<void> => {
  const trips = await db.select().from(tripsTable).orderBy(desc(tripsTable.startDate));

  const result = await Promise.all(
    trips.map(async (trip) => {
      const cover = await getCoverFilename(trip.id, trip.coverPhotoId);
      return {
        id: trip.id,
        name: trip.name,
        centerLat: trip.centerLat ?? 0,
        centerLng: trip.centerLng ?? 0,
        photoCount: trip.photoCount,
        startDate: trip.startDate.toISOString(),
        endDate: trip.endDate.toISOString(),
        coverPhotoPath: cover,
        locationName: trip.locationName ?? null,
      };
    })
  );

  const withCoords = result.filter((t) => t.centerLat !== 0 || t.centerLng !== 0);
  res.json(GetTripsMapResponse.parse(withCoords));
});

router.get("/trips/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetTripParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.id));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const cover = await getCoverFilename(trip.id, trip.coverPhotoId);
  res.json(GetTripResponse.parse(serializeTrip(trip, cover)));
});

router.patch("/trips/:id", async (req, res): Promise<void> => {
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

  const [trip] = await db
    .update(tripsTable)
    .set(body.data)
    .where(eq(tripsTable.id, params.data.id))
    .returning();

  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const cover = await getCoverFilename(trip.id, trip.coverPhotoId);
  res.json(UpdateTripResponse.parse(serializeTrip(trip, cover)));
});

router.delete("/trips/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteTripParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.update(photosTable).set({ tripId: null }).where(eq(photosTable.tripId, params.data.id));

  const [trip] = await db
    .delete(tripsTable)
    .where(eq(tripsTable.id, params.data.id))
    .returning();

  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/trips/:id/photos", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetTripPhotosParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.id));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const photos = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.tripId, params.data.id))
    .orderBy(asc(photosTable.takenAt));

  res.json(GetTripPhotosResponse.parse(photos.map(serializePhoto)));
});

export default router;
