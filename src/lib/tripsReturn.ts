/**
 * Remembers where the user was in the trips list (search text + scroll
 * position) so that opening an album and pressing "back" returns to the same
 * filtered view, not a fresh unfiltered /trips.
 *
 * sessionStorage is per-tab and cleared when the tab closes — exactly the
 * lifetime we want.
 */
const URL_KEY = "wl:tripsUrl";
const SCROLL_KEY = "wl:tripsScroll";

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode / quota — non-critical */
  }
}

/** Build "/trips" or "/trips?q=paris". */
export function tripsUrl(query: string): string {
  const q = query.trim();
  return q ? `/trips?q=${encodeURIComponent(q)}` : "/trips";
}

export function rememberTripsUrl(url: string) {
  safeSet(URL_KEY, url);
}

/** Where the "back to trips" arrow should go. */
export function getTripsReturnUrl(): string {
  const url = safeGet(URL_KEY);
  return url && url.startsWith("/trips") ? url : "/trips";
}

export function saveTripsScroll(url: string, top: number) {
  safeSet(SCROLL_KEY, JSON.stringify({ url, top }));
}

export function readTripsScroll(url: string): number | null {
  const raw = safeGet(SCROLL_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { url: string; top: number };
    return parsed.url === url ? parsed.top : null;
  } catch {
    return null;
  }
}
