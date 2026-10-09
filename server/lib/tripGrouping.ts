import { db, photosTable, tripsTable } from "@workspace/db";
import { isNull, eq, asc, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";
import { recomputeTrip, type DbOrTx } from "./tripStats";

const MAX_DISTANCE_KM = 100;
const MAX_DAYS_GAP = 5;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function daysDiff(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`;
    const res = await fetch(url, {
      headers: { "User-Agent": "WanderLens/1.0 travel-memory-app" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        county?: string;
        state?: string;
        country?: string;
        country_code?: string;
      };
    };
    const addr = data.address;
    if (!addr) return null;
    const place = addr.city ?? addr.town ?? addr.village ?? addr.county ?? addr.state;
    const country = addr.country;
    if (place && country) return `${place}, ${country}`;
    if (country) return country;
    return null;
  } catch (err) {
    logger.warn({ err }, "Reverse geocode failed");
    return null;
  }
}

function generateTripName(locationName: string | null, startDate: Date): string {
  const month = startDate.toLocaleString("en-US", { month: "long" });
  const year = startDate.getFullYear();
  if (locationName) return locationName;
  return `${month} ${year} Trip`;
}

export type PhotoRow = {
  id: number;
  lat: number | null;
  lng: number | null;
  takenAt: Date | null;
  filename: string;
};

export type TripGroup = {
  photos: PhotoRow[];
  centerLat: number;
  centerLng: number;
  startDate: Date;
  endDate: Date;
};

function groupPhotosIntoTrips(photos: PhotoRow[]): TripGroup[] {
  const withLocation = photos.filter(
    (p) => p.lat != null && p.lng != null && p.takenAt != null
  ) as (PhotoRow & { lat: number; lng: number; takenAt: Date })[];

  withLocation.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());

  const groups: TripGroup[] = [];

  for (const photo of withLocation) {
    let assigned = false;
    for (const group of groups) {
      const distOk = haversineKm(photo.lat, photo.lng, group.centerLat, group.centerLng) <= MAX_DISTANCE_KM;
      const timeOk = daysDiff(photo.takenAt, group.endDate) <= MAX_DAYS_GAP;

      if (distOk && timeOk) {
        group.photos.push(photo);
        if (photo.takenAt < group.startDate) group.startDate = photo.takenAt;
        if (photo.takenAt > group.endDate) group.endDate = photo.takenAt;
        const n = group.photos.length;
        group.centerLat = group.photos.reduce((s, p) => s + (p.lat ?? 0), 0) / n;
        group.centerLng = group.photos.reduce((s, p) => s + (p.lng ?? 0), 0) / n;
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      groups.push({
        photos: [photo],
        centerLat: photo.lat,
        centerLng: photo.lng,
        startDate: photo.takenAt,
        endDate: photo.takenAt,
      });
    }
  }

  return groups;
}

// Arbitrary constant: all trip creation / assignment runs under this advisory
// lock so that two uploads at the same time (e.g. from two different people)
// can neither create duplicate trips nor overwrite each other's counters.
const TRIP_ASSIGNMENT_LOCK = 727_001;

export async function lockTripAssignment(tx: DbOrTx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${TRIP_ASSIGNMENT_LOCK})`);
}

export async function regroupAllPhotos(): Promise<{ tripsCreated: number; photosGrouped: number }> {
  return db.transaction(async (tx) => {
    await lockTripAssignment(tx);

    const unassigned = await tx
      .select()
      .from(photosTable)
      .where(isNull(photosTable.tripId))
      .orderBy(asc(photosTable.takenAt));

    if (unassigned.length === 0) {
      return { tripsCreated: 0, photosGrouped: 0 };
    }

    const groups = groupPhotosIntoTrips(unassigned as PhotoRow[]);
    let tripsCreated = 0;
    let photosGrouped = 0;

    for (const group of groups) {
      if (group.photos.length === 0) continue;

      const locationName = await reverseGeocode(group.centerLat, group.centerLng);

      const [trip] = await tx
        .insert(tripsTable)
        .values({
          name: generateTripName(locationName, group.startDate),
          startDate: group.startDate,
          endDate: group.endDate,
          coverPhotoId: group.photos[0].id,
          centerLat: group.centerLat,
          centerLng: group.centerLng,
          locationName,
          photoCount: group.photos.length,
        })
        .returning();

      await tx
        .update(photosTable)
        .set({ tripId: trip.id })
        .where(inArray(photosTable.id, group.photos.map((p) => p.id)));
      photosGrouped += group.photos.length;

      await recomputeTrip(tx, trip.id);
      tripsCreated++;
      logger.info({ tripId: trip.id, photoCount: group.photos.length, locationName }, "Created trip");
    }

    return { tripsCreated, photosGrouped };
  });
}

/**
 * Put a freshly inserted photo into the best matching trip (or create one),
 * and update that trip's derived columns from the real photo rows.
 *
 * MUST be called inside a transaction (pass `tx`) that already holds the
 * lock from `lockTripAssignment`.
 */
export async function assignPhotoToTrip(tx: DbOrTx, photo: PhotoRow): Promise<number | null> {
  if (photo.lat == null || photo.lng == null || photo.takenAt == null) return null;

  const existingTrips = await tx.select().from(tripsTable).orderBy(asc(tripsTable.startDate));

  const photoDate = photo.takenAt as Date;
  const photoLat = photo.lat;
  const photoLng = photo.lng;

  // Pick the NEAREST matching trip, not just the first one in date order.
  let best: { id: number; dist: number } | null = null;
  for (const trip of existingTrips) {
    if (trip.centerLat == null || trip.centerLng == null) continue;
    const dist = haversineKm(photoLat, photoLng, trip.centerLat, trip.centerLng);
    const timeOk =
      daysDiff(photoDate, trip.startDate) <= MAX_DAYS_GAP ||
      daysDiff(photoDate, trip.endDate) <= MAX_DAYS_GAP ||
      (photoDate >= trip.startDate && photoDate <= trip.endDate);
    if (dist <= MAX_DISTANCE_KM && timeOk && (!best || dist < best.dist)) {
      best = { id: trip.id, dist };
    }
  }

  if (best) {
    await tx.update(photosTable).set({ tripId: best.id }).where(eq(photosTable.id, photo.id));
    await recomputeTrip(tx, best.id);
    return best.id;
  }

  // No matching trip — create a new one with reverse geocoding
  const locationName = await reverseGeocode(photoLat, photoLng);

  const [newTrip] = await tx
    .insert(tripsTable)
    .values({
      name: generateTripName(locationName, photoDate),
      startDate: photoDate,
      endDate: photoDate,
      coverPhotoId: photo.id,
      centerLat: photoLat,
      centerLng: photoLng,
      locationName,
      photoCount: 1,
    })
    .returning();

  await tx.update(photosTable).set({ tripId: newTrip.id }).where(eq(photosTable.id, photo.id));
  await recomputeTrip(tx, newTrip.id);

  logger.info({ tripId: newTrip.id, locationName }, "New trip created via reverse geocode");
  return newTrip.id;
}
