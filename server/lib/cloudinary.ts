// import { v2 as cloudinary } from "cloudinary";
// import { logger } from "./logger";

// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
//   secure: true,
// });

// export async function uploadToCloudinary(filePath: string, folder = "wanderlens"): Promise<{
//   publicId: string;
//   secureUrl: string;
//   width: number | null;
//   height: number | null;
// }> {
//   const result = await cloudinary.uploader.upload(filePath, {
//     folder,
//     resource_type: "image",
//     use_filename: false,
//     unique_filename: true,
//     overwrite: false,
//     // REMOVE quality and fetch_format from the UPLOAD step
//     // This ensures Cloudinary stores the file exactly as it is sent.
//     // quality: "auto",
//     // fetch_format: "auto",
//   });

//   logger.info({ publicId: result.public_id, url: result.secure_url }, "Uploaded to Cloudinary");

//   return {
//     publicId: result.public_id,
//     secureUrl: result.secure_url,
//     width: result.width ?? null,
//     height: result.height ?? null,
//   };
// }

// export async function deleteFromCloudinary(publicId: string): Promise<void> {
//   try {
//     await cloudinary.uploader.destroy(publicId);
//     logger.info({ publicId }, "Deleted from Cloudinary");
//   } catch (err) {
//     logger.warn({ err, publicId }, "Failed to delete from Cloudinary");
//   }
// }

// /**
//  * Build an optimised Cloudinary URL for a given display width.
//  * Uses automatic format + quality, and crops to fill the requested size.
//  */
// export function cloudinaryUrl(publicId: string, opts: {
//   width?: number;
//   height?: number;
//   crop?: string;
//   quality?: string | number;
// } = {}): string {
//   return cloudinary.url(publicId, {
//     secure: true,
//     fetch_format: "auto",
//     quality: opts.quality ?? "auto",
//     ...(opts.width ? { width: opts.width } : {}),
//     ...(opts.height ? { height: opts.height } : {}),
//     ...(opts.crop ? { crop: opts.crop } : {}),
//   });
// }



import { v2 as cloudinary } from "cloudinary";
import { logger } from "./logger";
import { Readable } from "stream";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export async function uploadToCloudinary(fileBuffer: Buffer, folder = "wanderlens"): Promise<{
  publicId: string;
  secureUrl: string;
  width: number | null;
  height: number | null;
}> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { 
        folder, 
        resource_type: "image",
        // We removed quality: "auto" so we store the original master file
      },
      (error, result) => {
        if (error) {
          logger.error({ error }, "Cloudinary upload failed");
          reject(error);
          return;
        }
        
        logger.info({ publicId: result?.public_id }, "Uploaded to Cloudinary");
        
        resolve({
          publicId: result!.public_id,
          secureUrl: result!.secure_url,
          width: result!.width ?? null,
          height: result!.height ?? null,
        });
      }
    );

    // Convert Buffer to a readable stream and pipe it to Cloudinary
    Readable.from(fileBuffer).pipe(uploadStream);
  });
}