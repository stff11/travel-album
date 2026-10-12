/**
 * Trips get a `locationName` like "Florence, Italy" (or just "Italy" when the
 * geocoder found no city). The country is always the last comma-separated part.
 */
export function countryFromLocationName(locationName: string | null | undefined): string | null {
  if (!locationName) return null;
  const parts = locationName.split(",");
  const last = parts[parts.length - 1]?.trim();
  return last ? last : null;
}

/** Case- and accent-insensitive key, so "España" and "espana" count once. */
export function countryKey(country: string): string {
  return country
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Number of distinct countries across a list of trip location names. */
export function countCountries(locationNames: Array<string | null | undefined>): number {
  const seen = new Set<string>();
  for (const name of locationNames) {
    const country = countryFromLocationName(name);
    if (country) seen.add(countryKey(country));
  }
  console.log(seen);
  return seen.size;
}
