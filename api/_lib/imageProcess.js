import sharp from "sharp";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = resolve(__dirname, "fonts", "Roboto-Bold.ttf");

// Fallback teaser pool — different phrase per article (deterministic by title hash).
const TEASER_POOL = [
  "NIMENI NU S-A ASTEPTAT LA ASTA!",
  "A IESIT TOTUL LA IVEALA!",
  "BOMBA ZILEI!",
  "TOTUL S-A DAT PESTE CAP!",
  "SOC TOTAL!",
  "DEZVALUIRE EXPLOZIVA!",
  "NIMENI NU STIA!",
  "ADEVARUL A IESIT LA SUPRAFATA!",
  "INCREDIBIL CE S-A INTAMPLAT!",
  "TOATA LUMEA VORBESTE DESPRE ASTA!",
  "MARE SURPRIZA!",
  "SITUATIE FARA PRECEDENT!",
  "REACTIE NEASTEPTATA!",
  "DECIZIE DE ULTIMA ORA!",
  "S-A AFLAT TOTUL!",
  "LOVITURA ZILEI!",
  "SCHIMBARE MAJORA!",
  "NIMENI NU SE ASTEPTA!",
  "TOTUL A EXPLODAT!",
  "ANUNT BOMBA!",
];

export function pickFallbackTeaser(title) {
  const str = String(title || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return TEASER_POOL[hash % TEASER_POOL.length];
}

const DEFAULT_SIZE = 1080;
const FETCH_TIMEOUT_MS = 15000;
const BAR_HEIGHT = 110;
const FONT_SIZE = 48;

/**
 * Normalise text for overlay: strip diacritics, uppercase, trim.
 */
function normaliseText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
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
 * Renders a text line as a PNG buffer using sharp's built-in Pango text renderer.
 * Pango markup sets the foreground colour to white so no post-processing is needed.
 */
async function renderTextLine(line, width) {
  try {
    const safe = String(line)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return await sharp({
      text: {
        text: `<span foreground="white" font_desc="Bold ${FONT_SIZE}">${safe}</span>`,
        fontfile: FONT_PATH,
        rgba: true,
        width,
        height: FONT_SIZE + 24,
        align: "centre",
        dpi: 96,
      },
    })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Fetches an image from a URL, center-crops it to a square, overlays a red bar
 * with bold white text at the bottom, and returns a JPEG Buffer.
 * Falls back gracefully at each step so nothing blocks publishing.
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
    // 1. Crop to square.
    const cropped = await sharp(buffer)
      .resize(size, size, { fit: "cover", position: "centre" })
      .toBuffer();

    const composites = [];

    // 2. Red bar at bottom (plain SVG rect — always works, no fonts needed).
    const barTop = size - BAR_HEIGHT;
    const barSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect x="0" y="${barTop}" width="${size}" height="${BAR_HEIGHT}" fill="#c0161d" opacity="0.93"/>` +
      `</svg>`
    );
    composites.push({ input: barSvg, top: 0, left: 0 });

    // 3. Text lines rendered via Pango (sharp's native text input + TTF font).
    if (text) {
      const normalised = normaliseText(text);
      const lines = wrapText(normalised, 28, 2);
      const lineSpacing = FONT_SIZE + 12;
      const totalTextHeight = lines.length * lineSpacing;
      const startY = barTop + Math.floor((BAR_HEIGHT - totalTextHeight) / 2);

      for (let i = 0; i < lines.length; i++) {
        const textBuf = await renderTextLine(lines[i], size - 60);
        if (!textBuf) continue;
        const meta = await sharp(textBuf).metadata();
        const tw = meta.width || (size - 60);
        const tx = Math.max(0, Math.floor((size - tw) / 2));
        const ty = Math.max(0, startY + i * lineSpacing);

        composites.push({ input: textBuf, top: ty, left: tx });
      }
    }

    return await sharp(cropped)
      .composite(composites)
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    return null;
  }
}
