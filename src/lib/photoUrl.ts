/**
 * Photo URL helpers (Cloudinary on-the-fly transformations).
 *
 * Caching rule of thumb: Cloudinary serves every distinct URL from its CDN
 * with long-lived cache headers, and the browser caches per exact URL. So we
 * deliberately use a SMALL, FIXED set of widths everywhere. The same photo
 * then hits the browser cache when you go from the trips grid -> album ->
 * lightbox, instead of downloading a slightly different size each time.
 */

type PhotoLike = {
  cloudinaryUrl?: string | null;
  cloudinaryPublicId?: string | null;
  filename: string;
};

/** Widths used for square grid thumbnails (responsive srcset). */
export const THUMB_WIDTHS = [200, 400, 600] as const;
/** Widths used for trip cards on /trips (responsive srcset). */
export const CARD_WIDTHS = [480, 800, 1200] as const;
/** Width of the full-screen lightbox image. Plenty for retina laptops. */
export const LIGHTBOX_WIDTH = 2000;
/** Width of the album hero banner. */
export const HERO_WIDTH = 1920;

function transform(photo: PhotoLike, transformation: string): string {
  if (photo.cloudinaryUrl) {
    return photo.cloudinaryUrl.replace(/\/upload\//, `/upload/${transformation}/`);
  }
  return `/api/photos/file/${photo.filename}`;
}

/** Full image, limited to `width` px wide (never upscaled, never the raw original). */
export function photoUrl(photo: PhotoLike, width: number = LIGHTBOX_WIDTH): string {
  return transform(photo, `f_auto,q_auto,w_${width},c_limit`);
}

/** Square crop, good for grids. */
export function thumbUrl(photo: PhotoLike, size = 400): string {
  return transform(photo, `f_auto,q_auto,w_${size},h_${size},c_fill,g_auto`);
}

/** `srcset` string of square crops at several widths. */
export function thumbSrcSet(photo: PhotoLike, widths: readonly number[] = THUMB_WIDTHS): string | undefined {
  if (!photo.cloudinaryUrl) return undefined;
  return widths.map((w) => `${thumbUrl(photo, w)} ${w}w`).join(", ");
}

/**
 * Cover image for trip cards: 4:5-ish crops so we don't download a 1:1 image
 * and then crop it again in CSS.
 */
export function cardUrl(photo: PhotoLike, width = 800): string {
  return transform(photo, `f_auto,q_auto,w_${width},h_${Math.round(width * 1.1)},c_fill,g_auto`);
}

export function cardSrcSet(photo: PhotoLike, widths: readonly number[] = CARD_WIDTHS): string | undefined {
  if (!photo.cloudinaryUrl) return undefined;
  return widths.map((w) => `${cardUrl(photo, w)} ${w}w`).join(", ");
}

/**
 * Tiny, heavily compressed preview with the original aspect ratio, shown
 * (CSS-blurred) while the full image loads.
 */
export function placeholderUrl(photo: PhotoLike, width = 48): string {
  return transform(photo, `f_auto,q_auto:low,w_${width},c_limit`);
}

/** Wide banner for the album hero. */
export function coverUrl(photo: PhotoLike | null | undefined, fallbackFilename?: string): string {
  const filename = fallbackFilename ?? (photo as PhotoLike | null)?.filename ?? "";
  if (!photo && !fallbackFilename) return "";
  return transform(
    { cloudinaryUrl: photo?.cloudinaryUrl ?? null, filename },
    `f_auto,q_auto,w_${HERO_WIDTH},c_limit`,
  );
}
