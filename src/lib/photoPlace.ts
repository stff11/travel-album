import { useEffect, useState } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";

/**
 * City / area for a single photo ("Alghero"), shown while a photo is viewed full
 * size. The server looks it up from the photo's GPS position the first time and
 * remembers it, so after that it is just a tiny cached response.
 */

export type PlacePhoto = { id: number; lat: number | null; lng: number | null };

type PlaceResponse = { placeName: string | null; retryable?: boolean };

export function photoHasGps(photo: PlacePhoto | undefined | null): photo is PlacePhoto {
  return !!photo && photo.lat != null && photo.lng != null;
}

async function fetchPlace(id: number): Promise<string | null> {
  const res = await fetch(`/api/photos/${id}/place`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as PlaceResponse;
  // "Busy / geocoder unavailable": throw so it is NOT cached as "no place" and
  // gets another chance next time the photo is shown.
  if (!body.placeName && body.retryable) throw new Error("place lookup busy");
  return body.placeName ?? null;
}

function placeQuery(id: number) {
  return {
    queryKey: ["photo-place", id] as const,
    queryFn: () => fetchPlace(id),
    staleTime: Infinity, // a photo's place never changes
    gcTime: 6 * 60 * 60 * 1000,
    retry: 0,
  };
}

/** Ask for a photo's place ahead of time (e.g. the next slide). */
export function prefetchPhotoPlace(queryClient: QueryClient, photo: PlacePhoto | undefined | null) {
  if (photoHasGps(photo)) void queryClient.prefetchQuery(placeQuery(photo.id));
}

/**
 * @param delayMs  wait this long on a photo before asking the server, so
 *                 flicking quickly through photos doesn't fire one request per
 *                 photo you merely passed. Photos already looked up show at once.
 */
export function usePhotoPlace(photo: PlacePhoto | undefined | null, delayMs = 400) {
  const hasGps = photoHasGps(photo);
  const id = photo?.id ?? 0;
  const [armedId, setArmedId] = useState<number | null>(null);

  useEffect(() => {
    if (!hasGps || delayMs <= 0) return;
    const timer = setTimeout(() => setArmedId(id), delayMs);
    return () => clearTimeout(timer);
  }, [id, hasGps, delayMs]);

  const armed = delayMs <= 0 || armedId === id;
  const query = useQuery({ ...placeQuery(id), enabled: hasGps && armed });

  return { place: hasGps ? (query.data ?? null) : null, hasGps };
}
