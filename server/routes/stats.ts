import { Router, type IRouter } from "express";
import { db, photosTable, tripsTable } from "@workspace/db";
import { count, min, max, isNotNull } from "drizzle-orm";
import { GetStatsResponse } from "@workspace/api-zod";
import { countCountries } from "../lib/countries";

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

  // Countries come from the trips' location names ("City, Country").
  const locations = await db
    .selectDistinct({ locationName: tripsTable.locationName })
    .from(tripsTable)
    .where(isNotNull(tripsTable.locationName));

  res.json(
    GetStatsResponse.parse({
      totalPhotos: photoStats.totalPhotos,
      totalTrips: tripStats.totalTrips,
      photosWithLocation: photoStats.photosWithLocation,
      earliestDate: photoStats.earliestDate?.toISOString() ?? null,
      latestDate: photoStats.latestDate?.toISOString() ?? null,
      totalCountries: countCountries(locations.map((l) => l.locationName)),
    })
  );
});

export default router;
