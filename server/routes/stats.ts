import { Router, type IRouter } from "express";
import { db, photosTable, tripsTable } from "@workspace/db";
import { count, min, max, isNotNull, sql } from "drizzle-orm";
import { GetStatsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Distinct ISO country codes across all trips. Trips whose country is not known
// yet (see POST /api/trips/backfill-countries) are simply not counted.
const countryCode = sql<string>`upper(${tripsTable.countryCode})`;

router.get("/stats", async (_req, res): Promise<void> => {
  const [photoStats] = await db
    .select({
      totalPhotos: count(),
      photosWithLocation: count(photosTable.lat),
      earliestDate: min(photosTable.takenAt),
      latestDate: max(photosTable.takenAt),
    })
    .from(photosTable);

  const [tripStats] = await db.select({ totalTrips: count() }).from(tripsTable);

  const [countryStats] = await db
    .select({ totalCountries: sql<number>`count(distinct ${countryCode})::int` })
    .from(tripsTable)
    .where(isNotNull(tripsTable.countryCode));

  res.json(
    GetStatsResponse.parse({
      totalPhotos: photoStats.totalPhotos,
      totalTrips: tripStats.totalTrips,
      photosWithLocation: photoStats.photosWithLocation,
      earliestDate: photoStats.earliestDate?.toISOString() ?? null,
      latestDate: photoStats.latestDate?.toISOString() ?? null,
      totalCountries: countryStats?.totalCountries ?? 0,
    }),
  );
});

// Which countries are being counted (and how many trips each has), plus how many
// trips still have no country. Read-only; handy for checking the number.
router.get("/stats/countries", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ code: countryCode, trips: count() })
    .from(tripsTable)
    .where(isNotNull(tripsTable.countryCode))
    .groupBy(countryCode)
    .orderBy(sql`count(*) desc`);

  const [unknown] = await db
    .select({ n: count() })
    .from(tripsTable)
    .where(sql`${tripsTable.countryCode} is null`);

  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    /* no ICU data — fall back to the bare code */
  }

  res.json({
    countries: rows.map((r) => ({
      code: r.code,
      country: names?.of(r.code) ?? r.code,
      trips: r.trips,
    })),
    tripsWithoutCountry: unknown?.n ?? 0,
  });
});

export default router;
