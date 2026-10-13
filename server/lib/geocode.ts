import { logger } from "./logger";

export type GeocodeResult = {
  /** "Place, Country" in English, e.g. "Florence, Italy". */
  locationName: string | null;
  /** ISO 3166-1 alpha-2, upper case ("IT", "PL", "GB"). Same in every language. */
  countryCode: string | null;
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
 * Returns null when nothing could be resolved (open sea, network error, ...).
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}` +
      `&format=json&zoom=10&addressdetails=1&accept-language=en`;
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
    const countryCode = /^[a-z]{2}$/i.test(addr.country_code ?? "")
      ? addr.country_code!.toUpperCase()
      : null;

    const locationName =
      place && country ? `${place}, ${country}` : (country ?? null);

    if (!locationName && !countryCode) return null;
    return { locationName, countryCode };
  } catch (err) {
    logger.warn({ err }, "Reverse geocode failed");
    return null;
  }
}
