import { Router, type IRouter } from "express";
import { db, photosTable, tripsTable } from "@workspace/db";
import { isNotNull, count, min, max, sql } from "drizzle-orm";
import { GetStatsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stats", async (req, res): Promise<void> => {
  const [photoStats] = await db
    .select({
      totalPhotos: count(),
      photosWithLocation: count(photosTable.lat),
      earliestDate: min(photosTable.takenAt),
      latestDate: max(photosTable.takenAt),
    })
    .from(photosTable);

  const [tripStats] = await db
    .select({
      totalTrips: count(),
    })
    .from(tripsTable);

  res.json(
    GetStatsResponse.parse({
      totalPhotos: photoStats.totalPhotos,
      totalTrips: tripStats.totalTrips,
      photosWithLocation: photoStats.photosWithLocation,
      earliestDate: photoStats.earliestDate?.toISOString() ?? null,
      latestDate: photoStats.latestDate?.toISOString() ?? null,
      totalCountries: 0,
    })
  );
});

export default router;
