import sharp from "sharp";

// Fallback teaser pool used when OpenAI is unavailable.
// Keywords map to more targeted phrases; unmatched falls back to generic pool.
const TEASER_POOL = [
  "NIMENI NU S-A AȘTEPTAT LA ASTA!",
  "A IEȘIT TOTUL LA IVEALĂ!",
  "BOMBA ZILEI!",
  "TOTUL S-A DAT PESTE CAP!",
  "ȘOC TOTAL!",
  "DEZVĂLUIRE EXPLOZIVĂ!",
  "NIMENI NU ȘTIA!",
  "ADEVĂRUL A IEȘIT LA SUPRAFAȚĂ!",
  "INCREDIBIL CE S-A ÎNTÂMPLAT!",
  "TOATĂ LUMEA VORBEȘTE DESPRE ASTA!",
  "MARE SURPRIZĂ!",
  "SITUAȚIE FĂRĂ PRECEDENT!",
  "REACȚIE NEAȘTEPTATĂ!",
  "DECIZIE DE ULTIMĂ ORĂ!",
  "S-A AFLAT TOTUL!",
  "LOVITURA ZILEI!",
  "SCHIMBARE MAJORĂ!",
  "NIMENI NU SE AȘTEPTA!",
  "TOTUL A EXPLODAT!",
  "ANUNȚ BOMBĂ!",
];

/**
 * Picks a teaser from the fallback pool.
 * Uses a hash of the title so the same article always gets the same phrase,
 * but different articles get different phrases.
 */
export function pickFallbackTeaser(title) {
  const str = String(title || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return TEASER_POOL[hash % TEASER_POOL.length];
}

const DEFAULT_SIZE = 1080;
const FETCH_TIMEOUT_MS = 15000;

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Simple word-wrap: splits text into at most `maxLines` lines,
 * each no longer than `maxChars` characters.
 */
function wrapText(text, maxChars, maxLines) {
  const words = String(text || "").trim().split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (lines.length >= maxLines) break;
    const test = current ? `${current} ${word}` : word;
    if (test.length <= maxChars) {
      current = test;
    } else {
      if (current) {
        lines.push(current);
        current = word.slice(0, maxChars);
      } else {
        lines.push(word.slice(0, maxChars));
        current = "";
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

/**
 * Builds an SVG overlay with a colored bar at the bottom.
 * Text is intentionally omitted: Vercel Lambda (Amazon Linux) has no fonts
 * installed so SVG text renders as squares. The bar alone gives the image
 * a distinctive news-card look; the title appears in the post caption.
 */
function buildTextOverlaySvg(text, size, {
  barColor = "#c0161d",
} = {}) {
  const barHeight = 80;
  const barTop = size - barHeight;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect x="0" y="${barTop}" width="${size}" height="${barHeight}" fill="${barColor}" opacity="0.93"/>
</svg>`;
}

/**
 * Fetches an image from a URL, center-crops it to a square, optionally
 * composites a bold title bar at the bottom, and returns a JPEG Buffer.
 * Falls back gracefully: if anything fails, returns null so the caller
 * can use the original URL.
 *
 * @param {string} imageUrl       - The source image URL.
 * @param {number} [size=1080]    - Output width and height in pixels.
 * @param {string|null} [text]    - Optional title text to overlay on the bottom bar.
 * @returns {Promise<Buffer|null>}
 */
export async function cropToSquare(imageUrl, size = DEFAULT_SIZE, text = null) {
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
    let pipeline = sharp(buffer).resize(size, size, {
      fit: "cover",
      position: "centre",
    });

    if (text) {
      const svg = buildTextOverlaySvg(text, size);
      pipeline = pipeline.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
    }

    return await pipeline.jpeg({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}
