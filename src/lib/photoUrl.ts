/**
 * Resolve the best URL for a photo.
 *
 * - If the photo has a Cloudinary URL, build an optimised delivery URL via
 *   Cloudinary's on-the-fly transformations (auto format + quality, optional resize).
 * - Otherwise fall back to the local `/api/photos/file/:filename` endpoint.
 *
 * Cloudinary transformation docs:
 *   https://cloudinary.com/documentation/image_transformations
 */

type PhotoLike = {
  cloudinaryUrl?: string | null;
  cloudinaryPublicId?: string | null;
  filename: string;
};

/**
 * Returns an optimised Cloudinary URL or a local fallback URL.
 *
 * @param photo   Photo record (needs cloudinaryUrl / cloudinaryPublicId / filename)
 * @param width   Optional target width (pixels). Cloudinary will also downscale for smaller screens.
 */
export function photoUrl(photo: PhotoLike, width?: number): string {
  if (photo.cloudinaryUrl) {
    // Re-write the Cloudinary URL to inject transformation parameters.
    // The raw URL looks like:
    //   https://res.cloudinary.com/<cloud>/image/upload/<public_id>.ext
    // We insert `/f_auto,q_auto[,w_<width>]` after `/upload/`.
    const transforms = width
      ? `f_auto,q_auto,w_${width},c_limit`
      : `f_auto,q_auto`;
    return photo.cloudinaryUrl.replace(
      /\/upload\//,
      `/upload/${transforms}/`
    );
  }

  // Fallback: served locally
  return `/api/photos/file/${photo.filename}`;
}

/**
 * Convenience: thumbnail URL — small square crop, good for grids.
 */
export function thumbUrl(photo: PhotoLike, size = 400): string {
  if (photo.cloudinaryUrl) {
    return photo.cloudinaryUrl.replace(
      /\/upload\//,
      `/upload/f_auto,q_auto,w_${size},h_${size},c_fill/`
    );
  }
  return `/api/photos/file/${photo.filename}`;
}

/**
 * Tiny, heavily-compressed preview — same aspect ratio as the original,
 * meant to be shown (CSS-blurred) as a placeholder while the full image loads.
 */
export function placeholderUrl(photo: PhotoLike, width = 48): string {
  if (photo.cloudinaryUrl) {
    return photo.cloudinaryUrl.replace(
      /\/upload\//,
      `/upload/f_auto,q_auto:low,w_${width},c_limit/`
    );
  }
  return `/api/photos/file/${photo.filename}`;
}

/**
 * Cover/hero URL — wide crop optimised for banners.
 */
export function coverUrl(photo: PhotoLike | null | undefined, fallbackFilename?: string): string {
  const filename = fallbackFilename ?? (photo as PhotoLike | null)?.filename ?? "";
  if (!photo && !fallbackFilename) return "";

  if (photo?.cloudinaryUrl) {
    return photo.cloudinaryUrl.replace(
      /\/upload\//,
      `/upload/f_auto,q_auto,w_1600,c_limit/`
    );
  }
  return `/api/photos/file/${filename}`;
}
