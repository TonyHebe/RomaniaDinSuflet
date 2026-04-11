import sharp from "sharp";

const DEFAULT_SIZE = 1080;
const FETCH_TIMEOUT_MS = 15000;

/**
 * Fetches an image from a URL, center-crops it to a square, and returns a JPEG Buffer.
 * Falls back gracefully: if anything fails, returns null so the caller can use the original URL.
 *
 * @param {string} imageUrl  - The source image URL.
 * @param {number} [size=1080] - Output width and height in pixels.
 * @returns {Promise<Buffer|null>}
 */
export async function cropToSquare(imageUrl, size = DEFAULT_SIZE) {
  if (!imageUrl) return null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error("Image fetch timeout")), FETCH_TIMEOUT_MS);

  let buffer;
  try {
    const res = await fetch(String(imageUrl), {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; RDS-ImageProcess/1.0)" },
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    buffer = Buffer.from(ab);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }

  try {
    const processed = await sharp(buffer)
      .resize(size, size, {
        fit: "cover",       // center-crop (fills the square, no letterbox)
        position: "centre",
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    return processed;
  } catch {
    return null;
  }
}
