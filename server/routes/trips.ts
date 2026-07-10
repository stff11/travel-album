// import { Router, type IRouter } from "express";
// import { db, photosTable, tripsTable } from "@workspace/db";
// import { eq, asc, desc, min, max, avg } from "drizzle-orm";
// import {
//   GetTripParams,
//   UpdateTripParams,
//   UpdateTripBody,
//   DeleteTripParams,
//   GetTripPhotosParams,
//   ListTripsResponse,
//   GetTripResponse,
//   GetTripsMapResponse,
//   UpdateTripResponse,
//   GetTripPhotosResponse,
//   MergeTripsParams,
//   MergeTripsBody,
//   MergeTripsResponse,
// } from "@workspace/api-zod";
// import { logger } from "../lib/logger";

// const router: IRouter = Router();

// type DbPhoto = typeof photosTable.$inferSelect;
// type DbTrip = typeof tripsTable.$inferSelect;

// function serializePhoto(p: DbPhoto) {
//   return {
//     ...p,
//     takenAt: p.takenAt?.toISOString() ?? null,
//     createdAt: p.createdAt.toISOString(),
//   };
// }

// async function getCoverPhoto(coverPhotoId: number | null | undefined): Promise<{
//   filename: string | null;
//   cloudinaryUrl: string | null;
// }> {
//   if (!coverPhotoId) return { filename: null, cloudinaryUrl: null };
//   const [p] = await db.select().from(photosTable).where(eq(photosTable.id, coverPhotoId));
//   return {
//     filename: p?.filename ?? null,
//     cloudinaryUrl: p?.cloudinaryUrl ?? null,
//   };
// }

// function serializeTrip(trip: DbTrip, cover: { filename: string | null; cloudinaryUrl: string | null }) {
//   return {
//     ...trip,
//     startDate: trip.startDate.toISOString(),
//     endDate: trip.endDate.toISOString(),
//     createdAt: trip.createdAt.toISOString(),
//     updatedAt: trip.updatedAt.toISOString(),
//     coverPhotoPath: cover.filename,
//     coverCloudinaryUrl: cover.cloudinaryUrl,
//   };
// }

// router.get("/trips", async (req, res): Promise<void> => {
//   const trips = await db.select().from(tripsTable).orderBy(desc(tripsTable.startDate));

//   const result = await Promise.all(
//     trips.map(async (trip) => {
//       const cover = await getCoverPhoto(trip.coverPhotoId);
//       return serializeTrip(trip, cover);
//     })
//   );

//   res.json(ListTripsResponse.parse(result));
// });

// router.get("/trips/map", async (req, res): Promise<void> => {
//   const trips = await db.select().from(tripsTable).orderBy(desc(tripsTable.startDate));

//   const result = await Promise.all(
//     trips.map(async (trip) => {
//       const cover = await getCoverPhoto(trip.coverPhotoId);
//       return {
//         id: trip.id,
//         name: trip.name,
//         centerLat: trip.centerLat ?? 0,
//         centerLng: trip.centerLng ?? 0,
//         photoCount: trip.photoCount,
//         startDate: trip.startDate.toISOString(),
//         endDate: trip.endDate.toISOString(),
//         coverPhotoPath: cover.filename,
//         coverCloudinaryUrl: cover.cloudinaryUrl,
//         locationName: trip.locationName ?? null,
//       };
//     })
//   );

//   const withCoords = result.filter((t) => t.centerLat !== 0 || t.centerLng !== 0);
//   res.json(GetTripsMapResponse.parse(withCoords));
// });

// router.get("/trips/:id", async (req, res): Promise<void> => {
//   const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
//   const params = GetTripParams.safeParse({ id: parseInt(raw, 10) });
//   if (!params.success) {
//     res.status(400).json({ error: params.error.message });
//     return;
//   }

//   const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.id));
//   if (!trip) {
//     res.status(404).json({ error: "Trip not found" });
//     return;
//   }

//   const cover = await getCoverPhoto(trip.coverPhotoId);
//   res.json(GetTripResponse.parse(serializeTrip(trip, cover)));
// });

// router.patch("/trips/:id", async (req, res): Promise<void> => {
//   const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
//   const params = UpdateTripParams.safeParse({ id: parseInt(rawId, 10) });
//   if (!params.success) {
//     res.status(400).json({ error: params.error.message });
//     return;
//   }

//   const body = UpdateTripBody.safeParse(req.body);
//   if (!body.success) {
//     res.status(400).json({ error: body.error.message });
//     return;
//   }

//   const [trip] = await db
//     .update(tripsTable)
//     .set(body.data)
//     .where(eq(tripsTable.id, params.data.id))
//     .returning();

//   if (!trip) {
//     res.status(404).json({ error: "Trip not found" });
//     return;
//   }

//   const cover = await getCoverPhoto(trip.coverPhotoId);
//   res.json(UpdateTripResponse.parse(serializeTrip(trip, cover)));
// });

// router.delete("/trips/:id", async (req, res): Promise<void> => {
//   const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
//   const params = DeleteTripParams.safeParse({ id: parseInt(raw, 10) });
//   if (!params.success) {
//     res.status(400).json({ error: params.error.message });
//     return;
//   }

//   await db.update(photosTable).set({ tripId: null }).where(eq(photosTable.tripId, params.data.id));

//   const [trip] = await db
//     .delete(tripsTable)
//     .where(eq(tripsTable.id, params.data.id))
//     .returning();

//   if (!trip) {
//     res.status(404).json({ error: "Trip not found" });
//     return;
//   }

//   res.sendStatus(204);
// });

// router.post("/trips/:id/merge", async (req, res): Promise<void> => {
//   const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
//   const params = MergeTripsParams.safeParse({ id: parseInt(rawId, 10) });
//   if (!params.success) {
//     res.status(400).json({ error: params.error.message });
//     return;
//   }

//   const body = MergeTripsBody.safeParse(req.body);
//   if (!body.success) {
//     res.status(400).json({ error: body.error.message });
//     return;
//   }

//   const targetId = params.data.id;
//   const sourceId = body.data.sourceId;

//   if (targetId === sourceId) {
//     res.status(400).json({ error: "Cannot merge a trip into itself" });
//     return;
//   }

//   const [[target], [source]] = await Promise.all([
//     db.select().from(tripsTable).where(eq(tripsTable.id, targetId)),
//     db.select().from(tripsTable).where(eq(tripsTable.id, sourceId)),
//   ]);

//   if (!target) {
//     res.status(404).json({ error: "Target trip not found" });
//     return;
//   }
//   if (!source) {
//     res.status(404).json({ error: "Source trip not found" });
//     return;
//   }

//   await db
//     .update(photosTable)
//     .set({ tripId: targetId })
//     .where(eq(photosTable.tripId, sourceId));

//   const [stats] = await db
//     .select({
//       count: min(photosTable.id),
//       earliest: min(photosTable.takenAt),
//       latest: max(photosTable.takenAt),
//       centerLat: avg(photosTable.lat),
//       centerLng: avg(photosTable.lng),
//     })
//     .from(photosTable)
//     .where(eq(photosTable.tripId, targetId));

//   const photoRows = await db
//     .select({ id: photosTable.id })
//     .from(photosTable)
//     .where(eq(photosTable.tripId, targetId));

//   const photoCount = photoRows.length;

//   const coverPhotoId =
//     target.coverPhotoId !== null ? target.coverPhotoId : source.coverPhotoId;

//   const startDate =
//     target.startDate <= source.startDate ? target.startDate : source.startDate;
//   const endDate =
//     target.endDate >= source.endDate ? target.endDate : source.endDate;

//   const [updated] = await db
//     .update(tripsTable)
//     .set({
//       photoCount,
//       startDate,
//       endDate,
//       coverPhotoId,
//       centerLat:
//         stats?.centerLat != null ? Number(stats.centerLat) : target.centerLat,
//       centerLng:
//         stats?.centerLng != null ? Number(stats.centerLng) : target.centerLng,
//       updatedAt: new Date(),
//     })
//     .where(eq(tripsTable.id, targetId))
//     .returning();

//   await db.delete(tripsTable).where(eq(tripsTable.id, sourceId));

//   const cover = await getCoverPhoto(updated!.coverPhotoId);
//   res.json(MergeTripsResponse.parse(serializeTrip(updated!, cover)));
// });

// router.get("/trips/:id/photos", async (req, res): Promise<void> => {
//   const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
//   const params = GetTripPhotosParams.safeParse({ id: parseInt(raw, 10) });
//   if (!params.success) {
//     res.status(400).json({ error: params.error.message });
//     return;
//   }

//   const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.id));
//   if (!trip) {
//     res.status(404).json({ error: "Trip not found" });
//     return;
//   }

//   const photos = await db
//     .select()
//     .from(photosTable)
//     .where(eq(photosTable.tripId, params.data.id))
//     .orderBy(asc(photosTable.takenAt));

//   res.json(GetTripPhotosResponse.parse(photos.map(serializePhoto)));
// });

// export default router;






import { Router, type IRouter } from "express";
import { db, photosTable, tripsTable } from "@workspace/db";
import { eq, asc, desc, min, max, avg } from "drizzle-orm";
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

async function getCoverPhoto(coverPhotoId: number | null | undefined): Promise<{
  filename: string | null;
  cloudinaryUrl: string | null;
}> {
  if (!coverPhotoId) return { filename: null, cloudinaryUrl: null };
  const [p] = await db.select().from(photosTable).where(eq(photosTable.id, coverPhotoId));
  return {
    filename: p?.filename ?? null,
    cloudinaryUrl: p?.cloudinaryUrl ?? null,
  };
}

function serializeTrip(trip: DbTrip, cover: { filename: string | null; cloudinaryUrl: string | null }) {
  return {
    ...trip,
    startDate: trip.startDate.toISOString(),
    endDate: trip.endDate.toISOString(),
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
    coverPhotoPath: cover.filename,
    coverCloudinaryUrl: cover.cloudinaryUrl,
  };
}

router.get("/trips", async (req, res): Promise<void> => {
  const trips = await db.select().from(tripsTable).orderBy(desc(tripsTable.startDate));

  const result = await Promise.all(
    trips.map(async (trip) => {
      const cover = await getCoverPhoto(trip.coverPhotoId);
      return serializeTrip(trip, cover);
    })
  );

  res.json(ListTripsResponse.parse(result));
});

router.get("/trips/map", async (req, res): Promise<void> => {
  const trips = await db.select().from(tripsTable).orderBy(desc(tripsTable.startDate));

  const result = await Promise.all(
    trips.map(async (trip) => {
      const cover = await getCoverPhoto(trip.coverPhotoId);
      return {
        id: trip.id,
        name: trip.name,
        centerLat: trip.centerLat ?? 0,
        centerLng: trip.centerLng ?? 0,
        photoCount: trip.photoCount,
        startDate: trip.startDate.toISOString(),
        endDate: trip.endDate.toISOString(),
        coverPhotoPath: cover.filename,
        coverCloudinaryUrl: cover.cloudinaryUrl,
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

  const cover = await getCoverPhoto(trip.coverPhotoId);
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

  const cover = await getCoverPhoto(trip.coverPhotoId);
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

router.post("/trips/:id/merge", async (req, res): Promise<void> => {
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

  const [[target], [source]] = await Promise.all([
    db.select().from(tripsTable).where(eq(tripsTable.id, targetId)),
    db.select().from(tripsTable).where(eq(tripsTable.id, sourceId)),
  ]);

  if (!target) {
    res.status(404).json({ error: "Target trip not found" });
    return;
  }
  if (!source) {
    res.status(404).json({ error: "Source trip not found" });
    return;
  }

  await db
    .update(photosTable)
    .set({ tripId: targetId })
    .where(eq(photosTable.tripId, sourceId));

  const [stats] = await db
    .select({
      count: min(photosTable.id),
      earliest: min(photosTable.takenAt),
      latest: max(photosTable.takenAt),
      centerLat: avg(photosTable.lat),
      centerLng: avg(photosTable.lng),
    })
    .from(photosTable)
    .where(eq(photosTable.tripId, targetId));

  const photoRows = await db
    .select({ id: photosTable.id })
    .from(photosTable)
    .where(eq(photosTable.tripId, targetId));

  const photoCount = photoRows.length;

  const coverPhotoId =
    target.coverPhotoId !== null ? target.coverPhotoId : source.coverPhotoId;

  const startDate =
    target.startDate <= source.startDate ? target.startDate : source.startDate;
  const endDate =
    target.endDate >= source.endDate ? target.endDate : source.endDate;

  const [updated] = await db
    .update(tripsTable)
    .set({
      photoCount,
      startDate,
      endDate,
      coverPhotoId,
      centerLat:
        stats?.centerLat != null ? Number(stats.centerLat) : target.centerLat,
      centerLng:
        stats?.centerLng != null ? Number(stats.centerLng) : target.centerLng,
      updatedAt: new Date(),
    })
    .where(eq(tripsTable.id, targetId))
    .returning();

  await db.delete(tripsTable).where(eq(tripsTable.id, sourceId));

  const cover = await getCoverPhoto(updated!.coverPhotoId);
  res.json(MergeTripsResponse.parse(serializeTrip(updated!, cover)));
});

// Repairs trips whose stored centerLat/centerLng no longer match their actual
// photos (e.g. left stale after a photo was deleted before that recalculated
// the center). Recomputes from the photos currently in the trip.
router.post("/trips/recompute-centers", async (_req, res): Promise<void> => {
  const trips = await db.select().from(tripsTable);
  let updated = 0;

  for (const trip of trips) {
    const photos = await db.select().from(photosTable).where(eq(photosTable.tripId, trip.id));
    const geotagged = photos.filter((p) => p.lat != null && p.lng != null);
    if (geotagged.length === 0) continue;

    const centerLat = geotagged.reduce((s, p) => s + (p.lat as number), 0) / geotagged.length;
    const centerLng = geotagged.reduce((s, p) => s + (p.lng as number), 0) / geotagged.length;

    const changed =
      trip.centerLat == null ||
      trip.centerLng == null ||
      Math.abs(trip.centerLat - centerLat) > 0.0001 ||
      Math.abs(trip.centerLng - centerLng) > 0.0001;

    if (changed) {
      await db.update(tripsTable).set({ centerLat, centerLng }).where(eq(tripsTable.id, trip.id));
      updated++;
    }
  }

  res.json({ tripsChecked: trips.length, tripsUpdated: updated });
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