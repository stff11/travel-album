/**
 * Small image prefetch queue.
 *
 * Warms the browser's HTTP cache (and, as a side effect, Cloudinary's CDN —
 * the first request for a given transformed URL is the slow one) for images
 * the person is likely to look at next.
 *
 *  - "high" requests (the photos next to the one open in the lightbox) always
 *    go before "low" ones (background warming of the rest of the album).
 *  - Only a few downloads run at once, so prefetching never starves the
 *    thumbnails or the image the person is actually looking at.
 *  - Every URL is requested at most once per page load.
 *  - Does nothing on data-saver / 2G connections, and warms fewer full-size
 *    photos on 3G (see `fullSizeWarmCount`).
 */

type Priority = "high" | "low";

const MAX_CONCURRENT = 3;

const requested = new Set<string>(); // queued, loading or finished
const loaded = new Set<string>();
const waiters = new Map<string, Array<(loaded: boolean) => void>>();
const queues: Record<Priority, string[]> = { high: [], low: [] };
const inFlight = new Set<HTMLImageElement>(); // keep refs so loads aren't GC-cancelled
let running = 0;

export function prefetchAllowed(): boolean {
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!conn) return true;
  return !conn.saveData && !/(^|-)2g$/.test(conn.effectiveType ?? "");
}

/** How many full-size photos to warm in the background for one album. */
export function fullSizeWarmCount(max: number): number {
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!prefetchAllowed()) return 0;
  return conn?.effectiveType === "3g" ? Math.min(max, 8) : max;
}

/** Resolve everyone waiting on `url`. `ok` is true only if it really downloaded. */
function settle(url: string, ok: boolean) {
  for (const done of waiters.get(url) ?? []) done(ok);
  waiters.delete(url);
}

function pump() {
  while (running < MAX_CONCURRENT) {
    const highUrl = queues.high.shift();
    const url = highUrl ?? queues.low.shift();
    if (!url) return;
    const fromHigh = highUrl !== undefined;

    running++;
    const img = new Image();
    inFlight.add(img);
    // Background warming must never outrank what is on screen; photos the
    // person is about to step to (the "high" queue) get normal priority.
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = fromHigh ? "auto" : "low";
    img.decoding = "async";
    const finish = (ok: boolean) => {
      if (ok) loaded.add(url);
      inFlight.delete(img);
      running--;
      settle(url, ok);
      pump();
    };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
  }
}

/** True once the URL has finished downloading (so it's in the browser cache). */
export function isPrefetched(url: string): boolean {
  return loaded.has(url);
}

/**
 * Queue `url`. Resolves `true` once it has really downloaded, `false` if it
 * failed, was dropped from the queue, or prefetching is switched off — so
 * callers can tell "ready" from "gave up". A "high" request for a URL that is
 * only queued as "low" moves it to the front.
 */
export function prefetchImage(url: string, priority: Priority = "low"): Promise<boolean> {
  if (loaded.has(url)) return Promise.resolve(true);
  if (!prefetchAllowed()) return Promise.resolve(false);

  const promise = new Promise<boolean>((resolve) => {
    const list = waiters.get(url) ?? [];
    list.push(resolve);
    waiters.set(url, list);
  });

  if (!requested.has(url)) {
    requested.add(url);
    queues[priority].push(url);
  } else if (priority === "high") {
    const i = queues.low.indexOf(url);
    if (i !== -1) {
      queues.low.splice(i, 1);
      queues.high.push(url);
    }
  }

  pump();
  return promise;
}

/** Drop everything still waiting in the low-priority queue (e.g. album closed). */
export function cancelBackgroundPrefetch(): void {
  for (const url of queues.low.splice(0)) {
    requested.delete(url);
    settle(url, false);
  }
}

/**
 * Keep only these URLs in the high-priority queue; anything else still waiting
 * there (e.g. photos the person has already skipped past in the lightbox) is
 * dropped so it can't delay the ones that matter now.
 */
export function retainHighPriority(keep: Set<string>): void {
  queues.high = queues.high.filter((url) => {
    if (keep.has(url)) return true;
    requested.delete(url);
    settle(url, false);
    return false;
  });
}
