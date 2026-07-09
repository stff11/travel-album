import { v2 as cloudinary } from "cloudinary";
import { logger } from "./logger";
import { Readable } from "stream";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Used by photos.ts for uploads
export async function uploadToCloudinary(fileBuffer: Buffer, folder = "wanderlens") {
  return new Promise<{ publicId: string; secureUrl: string; width: number | null; height: number | null }>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) {
          logger.error({ error }, "Cloudinary upload failed");
          reject(error);
          return;
        }
        resolve({
          publicId: result!.public_id,
          secureUrl: result!.secure_url,
          width: result!.width ?? null,
          height: result!.height ?? null,
        });
      }
    );
    Readable.from(fileBuffer).pipe(uploadStream);
  });
}

// Used by photos.ts for deletes
export async function deleteFromCloudinary(publicId: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId);
    logger.info({ publicId }, "Deleted from Cloudinary");
  } catch (err) {
    logger.warn({ err, publicId }, "Failed to delete from Cloudinary");
  }
}

// /**
//  * Build an optimised Cloudinary URL for a given display width.
//  * Uses automatic format + quality, and crops to fill the requested size.
//  */
export function cloudinaryUrl(publicId: string, opts: {
  width?: number;
  height?: number;
  crop?: string;
  quality?: string | number;
} = {}): string {
  return cloudinary.url(publicId, {
    secure: true,
    fetch_format: "auto",
    quality: opts.quality ?? "auto",
    ...(opts.width ? { width: opts.width } : {}),
    ...(opts.height ? { height: opts.height } : {}),
    ...(opts.crop ? { crop: opts.crop } : {}),
  });
}