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

/**
 * Repair every trip: recount photos, dates, map center and cover, and remove
 * trips that have no photos.
 *
 * Done with a fixed number of set-based SQL statements (NOT one round trip per
 * trip), so it takes about the same time for 5 trips or 5,000. The previous
 * per-trip loop needed ~6 queries per trip and hit Netlify's 30 s function
 * limit against a remote database.
 */
export async function repairAllTrips(): Promise<{
  tripsChecked: number;
  tripsFixed: number;
  emptyTripsRemoved: number;
  orphanPhotos: number;
}> {
  return db.transaction(async (tx) => {
    // Same lock as uploads / merges / deletes, so we never recount in the
    // middle of someone else's change.
    await tx.execute(sql`select pg_advisory_xact_lock(727001)`);

    const rowsOf = (r: { rows: Array<Record<string, unknown>> }) => r.rows;

    const [{ n: tripsChecked }] = rowsOf(
      await tx.execute(sql`select count(*)::int as n from trips`),
    ) as Array<{ n: number }>;

    // 1) Trips with no photos left.
    const removed = rowsOf(
      await tx.execute(sql`
        delete from trips t
        where not exists (select 1 from photos p where p.trip_id = t.id)
        returning t.id`),
    );

    // 2) Count / dates / center, from the real photo rows. Only rows that are
    //    actually wrong are written (tiny tolerance on the coordinates).
    const statFixed = rowsOf(
      await tx.execute(sql`
        with agg as (
          select trip_id,
                 count(*)::int  as cnt,
                 min(taken_at)  as first_at,
                 max(taken_at)  as last_at,
                 avg(lat)       as clat,
                 avg(lng)       as clng
          from photos
          where trip_id is not null
          group by trip_id
        )
        update trips t set
          photo_count = agg.cnt,
          start_date  = coalesce(agg.first_at, t.start_date),
          end_date    = coalesce(agg.last_at,  t.end_date),
          center_lat  = coalesce(agg.clat, t.center_lat),
          center_lng  = coalesce(agg.clng, t.center_lng),
          updated_at  = now()
        from agg
        where agg.trip_id = t.id
          and (
            t.photo_count is distinct from agg.cnt
            or t.start_date is distinct from coalesce(agg.first_at, t.start_date)
            or t.end_date   is distinct from coalesce(agg.last_at,  t.end_date)
            or abs(coalesce(t.center_lat, 0) - coalesce(agg.clat, t.center_lat, 0)) > 0.0001
            or abs(coalesce(t.center_lng, 0) - coalesce(agg.clng, t.center_lng, 0)) > 0.0001
          )
        returning t.id`),
    );

    // 3) Cover photo: must exist and belong to the trip; otherwise use the
    //    earliest photo.
    const coverFixed = rowsOf(
      await tx.execute(sql`
        update trips t set
          cover_photo_id = (
            select p.id from photos p
            where p.trip_id = t.id
            order by p.taken_at asc nulls last, p.id asc
            limit 1
          ),
          updated_at = now()
        where t.cover_photo_id is null
           or not exists (
             select 1 from photos p
             where p.id = t.cover_photo_id and p.trip_id = t.id
           )
        returning t.id`),
    );

    const [{ n: orphanPhotos }] = rowsOf(
      await tx.execute(sql`select count(*)::int as n from photos where trip_id is null`),
    ) as Array<{ n: number }>;

    const fixedIds = new Set<number>([
      ...statFixed.map((r) => Number(r.id)),
      ...coverFixed.map((r) => Number(r.id)),
    ]);

    return {
      tripsChecked,
      tripsFixed: fixedIds.size,
      emptyTripsRemoved: removed.length,
      orphanPhotos,
    };
  });
}

/** SQL fragment: live photo count for the trip row currently being selected. */
export const livePhotoCount = sql<number>`(select count(*)::int from photos p where p.trip_id = ${tripsTable.id})`;
