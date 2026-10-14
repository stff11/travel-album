import { logger } from "./logger";

export type GeocodeResult = {
  /** "Place, Country" in English, e.g. "Florence, Italy". */
  locationName: string | null;
  /** ISO 3166-1 alpha-2, upper case ("IT", "PL", "GB"). Same in every language. */
  countryCode: string | null;
  /** Just the city / town / area ("Alghero"), no country. For photo captions. */
  place: string | null;
};

/**
 * Reverse-geocode with OpenStreetMap Nominatim.
 *
 * We ask for English names (so new trips are named consistently — before this,
 * some came back as "Italia" / "Polska" / "España") and keep the ISO country
 * code, which is what the "countries visited" count is based on. A display name
 * is a bad thing to count by: "Italy"/"Italia", "UK"/"England"/"Scotland" and
 * "Κύπρος - Kıbrıs" are all the same country as far as a traveller is concerned.
 *
 * Returns null only when the lookup itself failed (network error, HTTP error).
 * When the service answered but has nothing for that spot (open sea), every
 * field of the result is null.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  zoom = 10,
): Promise<GeocodeResult | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}` +
      `&format=json&zoom=${zoom}&addressdetails=1&accept-language=en`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "WanderLens/1.0 travel-memory-app",
        "Accept-Language": "en",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
        suburb?: string;
        city_district?: string;
        county?: string;
        state?: string;
        country?: string;
        country_code?: string;
      };
    };
    const addr = data.address;
    // The service answered but knows nothing here (open sea, ...): not an error.
    if (!addr) return { locationName: null, countryCode: null, place: null };

    const place = addr.city ?? addr.town ?? addr.village ?? addr.county ?? addr.state;
    const country = addr.country;
    const countryCode = /^[a-z]{2}$/i.test(addr.country_code ?? "")
      ? addr.country_code!.toUpperCase()
      : null;

    const locationName =
      place && country ? `${place}, ${country}` : (country ?? null);

    // Most specific sensible "area": a city/town/village, else a municipality or
    // suburb, else the county/state.
    const area =
      addr.city ?? addr.town ?? addr.village ?? addr.municipality ??
      addr.suburb ?? addr.city_district ?? addr.county ?? addr.state ?? null;

    if (!locationName && !countryCode && !area) {
      return { locationName: null, countryCode: null, place: null };
    }
    return { locationName, countryCode, place: area };
  } catch (err) {
    logger.warn({ err }, "Reverse geocode failed");
    return null;
  }
}


// ---------------------------------------------------------------------------
// Polite, queued access for requests that come from visitors (photo captions).
//
// Nominatim's usage policy allows about one request per second. Every call made
// through this function is spaced out by at least MIN_GAP_MS, and when too many
// are already waiting the caller is told to try again later instead of piling up.
// (The gap is per server instance — on serverless that is a best effort.)
// ---------------------------------------------------------------------------
const MAX_WAITING = 4;
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;
let lastCallAt = 0;

export function geocodeQueueFull(): boolean {
  return waiting >= MAX_WAITING;
}

export function reverseGeocodeQueued(
  lat: number,
  lng: number,
  zoom = 12,
): Promise<GeocodeResult | null> {
  const gap = Number(process.env.NOMINATIM_DELAY_MS ?? 1100);
  waiting++;
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCallAt + gap - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return reverseGeocode(lat, lng, zoom);
  });
  const done = () => { waiting--; };
  run.then(done, done);
  chain = run.catch(() => undefined);
  return run;
}
