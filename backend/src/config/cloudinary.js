import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// True only when all three Cloudinary credentials are present.
export function isCloudinaryConfigured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

// Uploads a base64 / data URI or remote URL to Cloudinary.
// resource_type "auto" lets Cloudinary accept images AND raw files (PDF, docs).
export async function uploadToCloudinary(fileStr, folder = "mystudyguide") {
  const result = await cloudinary.uploader.upload(fileStr, { folder, resource_type: "auto" });
  return { url: result.secure_url, format: result.format, bytes: result.bytes };
}

// Uploads an image (e.g. an SVG data URI) and returns a raster URL. `format`
// forces conversion (e.g. "png") so Facebook/Instagram get a real photo.
export async function uploadImage(fileStr, { folder = "mystudyguide/social", format } = {}) {
  const opts = { folder, resource_type: "image" };
  if (format) opts.format = format;
  const result = await cloudinary.uploader.upload(fileStr, opts);
  return { url: result.secure_url, format: result.format, bytes: result.bytes };
}

export default cloudinary;
