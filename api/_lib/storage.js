import { put } from "@vercel/blob";

/**
 * Uploads an image buffer to Vercel Blob and returns the public URL.
 * Returns null if BLOB_READ_WRITE_TOKEN is not set or the upload fails.
 *
 * @param {Buffer} buffer   - JPEG image buffer
 * @param {string} filename - e.g. "articles/my-slug.jpg"
 * @returns {Promise<string|null>}
 */
export async function uploadImageBuffer(buffer, filename) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { url } = await put(filename, buffer, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
    });
    return url || null;
  } catch {
    return null;
  }
}
