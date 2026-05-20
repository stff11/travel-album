import { db, photosTable, tripsTable } from "@workspace/db";
import { isNull, eq, asc } from "drizzle-orm";
import { logger } from "./logger";

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

function generateTripName(centerLat: number, centerLng: number, startDate: Date): string {
  const month = startDate.toLocaleString("en-US", { month: "long" });
  const year = startDate.getFullYear();
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
      const lastDate = group.endDate;
      const timeOk = daysDiff(photo.takenAt, lastDate) <= MAX_DAYS_GAP;

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

export async function regroupAllPhotos(): Promise<{ tripsCreated: number; photosGrouped: number }> {
  const unassigned = await db
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

    const [trip] = await db
      .insert(tripsTable)
      .values({
        name: generateTripName(group.centerLat, group.centerLng, group.startDate),
        startDate: group.startDate,
        endDate: group.endDate,
        coverPhotoId: group.photos[0].id,
        centerLat: group.centerLat,
        centerLng: group.centerLng,
        photoCount: group.photos.length,
      })
      .returning();

    for (const photo of group.photos) {
      await db
        .update(photosTable)
        .set({ tripId: trip.id })
        .where(eq(photosTable.id, photo.id));
      photosGrouped++;
    }

    tripsCreated++;
    logger.info({ tripId: trip.id, photoCount: group.photos.length }, "Created trip");
  }

  return { tripsCreated, photosGrouped };
}

export async function assignPhotoToTrip(photo: PhotoRow): Promise<number | null> {
  if (photo.lat == null || photo.lng == null || photo.takenAt == null) return null;

  const existingTrips = await db.select().from(tripsTable).orderBy(asc(tripsTable.startDate));

  const photoDate = photo.takenAt as Date;
  const photoLat = photo.lat;
  const photoLng = photo.lng;

  for (const trip of existingTrips) {
    if (!trip.centerLat || !trip.centerLng) continue;
    const distOk = haversineKm(photoLat, photoLng, trip.centerLat, trip.centerLng) <= MAX_DISTANCE_KM;
    const timeOk =
      daysDiff(photoDate, trip.startDate) <= MAX_DAYS_GAP ||
      daysDiff(photoDate, trip.endDate) <= MAX_DAYS_GAP;

    if (distOk && timeOk) {
      const newCount = trip.photoCount + 1;
      const n = newCount;
      const newCenterLat = (trip.centerLat * (n - 1) + photoLat) / n;
      const newCenterLng = (trip.centerLng * (n - 1) + photoLng) / n;
      const newStart = photoDate < trip.startDate ? photoDate : trip.startDate;
      const newEnd = photoDate > trip.endDate ? photoDate : trip.endDate;

      await db
        .update(tripsTable)
        .set({
          photoCount: newCount,
          centerLat: newCenterLat,
          centerLng: newCenterLng,
          startDate: newStart,
          endDate: newEnd,
        })
        .where(eq(tripsTable.id, trip.id));

      return trip.id;
    }
  }

  const [newTrip] = await db
    .insert(tripsTable)
    .values({
      name: generateTripName(photoLat, photoLng, photoDate),
      startDate: photoDate,
      endDate: photoDate,
      coverPhotoId: photo.id,
      centerLat: photoLat,
      centerLng: photoLng,
      photoCount: 1,
    })
    .returning();

  return newTrip.id;
}
