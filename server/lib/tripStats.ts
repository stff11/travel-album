import { and, asc, count, eq, isNull, min, max, avg, sql } from "drizzle-orm";
import { db, photosTable, tripsTable } from "@workspace/db";

/** A drizzle db handle or an open transaction. */
export type DbOrTx = Pick<typeof db, "select" | "update" | "delete" | "insert" | "execute">;

/**
 * Recompute everything about a trip that is derived from its photos:
 * photo_count, start/end date, map center and cover photo.
 *
 * This is the ONE place that writes those columns after a photo is added,
 * removed or moved. Always recomputing from the real rows (instead of
 * incrementing / decrementing a counter) is what keeps photo_count correct
 * even with concurrent uploads, failed requests, merges and deletes.
 *
 * If the trip has no photos left it is deleted and `null` is returned.
 */
export async function recomputeTrip(tx: DbOrTx, tripId: number): Promise<boolean> {
  const [stats] = await tx
    .select({
      photoCount: count(),
      earliest: min(photosTable.takenAt),
      latest: max(photosTable.takenAt),
      centerLat: avg(photosTable.lat),
      centerLng: avg(photosTable.lng),
    })
    .from(photosTable)
    .where(eq(photosTable.tripId, tripId));

  if (!stats || stats.photoCount === 0) {
    await tx.delete(tripsTable).where(eq(tripsTable.id, tripId));
    return false;
  }

  const [trip] = await tx.select().from(tripsTable).where(eq(tripsTable.id, tripId));
  if (!trip) return false;

  // Keep the current cover if it still belongs to this trip, otherwise
  // promote the earliest photo.
  let coverPhotoId = trip.coverPhotoId;
  if (coverPhotoId != null) {
    const [cover] = await tx
      .select({ id: photosTable.id })
      .from(photosTable)
      .where(and(eq(photosTable.id, coverPhotoId), eq(photosTable.tripId, tripId)));
    if (!cover) coverPhotoId = null;
  }
  if (coverPhotoId == null) {
    const [first] = await tx
      .select({ id: photosTable.id })
      .from(photosTable)
      .where(eq(photosTable.tripId, tripId))
      .orderBy(asc(photosTable.takenAt), asc(photosTable.id))
      .limit(1);
    coverPhotoId = first?.id ?? null;
  }

  await tx
    .update(tripsTable)
    .set({
      photoCount: stats.photoCount,
      startDate: stats.earliest ?? trip.startDate,
      endDate: stats.latest ?? trip.endDate,
      centerLat: stats.centerLat != null ? Number(stats.centerLat) : trip.centerLat,
      centerLng: stats.centerLng != null ? Number(stats.centerLng) : trip.centerLng,
      coverPhotoId,
    })
    .where(eq(tripsTable.id, tripId));

  return true;
}

/** Repair every trip. Used by the admin "repair" endpoint. */
export async function repairAllTrips(): Promise<{
  tripsChecked: number;
  tripsFixed: number;
  emptyTripsRemoved: number;
  orphanPhotos: number;
}> {
  return db.transaction(async (tx) => {
    const before = await tx.select().from(tripsTable);
    let fixed = 0;
    let removed = 0;

    for (const trip of before) {
      const kept = await recomputeTrip(tx, trip.id);
      if (!kept) {
        removed++;
        continue;
      }
      const [after] = await tx.select().from(tripsTable).where(eq(tripsTable.id, trip.id));
      if (
        after &&
        (after.photoCount !== trip.photoCount ||
          after.coverPhotoId !== trip.coverPhotoId ||
          after.startDate.getTime() !== trip.startDate.getTime() ||
          after.endDate.getTime() !== trip.endDate.getTime() ||
          Math.abs((after.centerLat ?? 0) - (trip.centerLat ?? 0)) > 0.0001 ||
          Math.abs((after.centerLng ?? 0) - (trip.centerLng ?? 0)) > 0.0001)
      ) {
        fixed++;
      }
    }

    const [orphans] = await tx
      .select({ n: count() })
      .from(photosTable)
      .where(isNull(photosTable.tripId));

    return {
      tripsChecked: before.length,
      tripsFixed: fixed,
      emptyTripsRemoved: removed,
      orphanPhotos: orphans?.n ?? 0,
    };
  });
}

/** SQL fragment: live photo count for the trip row currently being selected. */
export const livePhotoCount = sql<number>`(select count(*)::int from photos p where p.trip_id = ${tripsTable.id})`;
