import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import opentype from "opentype.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = resolve(__dirname, "fonts", "Roboto-Bold.ttf");

let _font = null;
function getFont() {
  if (!_font) {
    try {
      const buf = readFileSync(FONT_PATH);
      _font = opentype.parse(buf.buffer);
    } catch {
      _font = null;
    }
  }
  return _font;
}

// Fallback hook pool — deterministic per article title.
const HOOK_POOL = [
  "ULTIMA ORA!",
  "SOC TOTAL!",
  "BOMBA ZILEI!",
  "INCREDIBIL!",
  "BREAKING NEWS!",
  "ATENTIE!",
  "ALERTA!",
  "TRAGEDIE!",
  "VICTORIE!",
  "DECIZIE MAJORA!",
  "LOVITURA ZILEI!",
  "ANUNT BOMBA!",
  "SCHIMBARE MAJORA!",
  "REACTIE NEASTEPTATA!",
  "DECIZIE DE ULTIMA ORA!",
];

export function pickFallbackTeaser(title) {
  const str = String(title || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return HOOK_POOL[hash % HOOK_POOL.length];
}

/**
 * Builds a { hook, detail } teaser from the article title without OpenAI.
 * hook  — deterministic pick from the pool
 * detail — first 6 significant words of the title, normalised
 */
export function buildFallbackTeaser(title) {
  const hook = pickFallbackTeaser(title);
  const detail = String(title || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim()
    .split(" ").slice(0, 8).join(" ");
  return { hook, detail };
}

const DEFAULT_SIZE = 1080;
const FETCH_TIMEOUT_MS = 15000;
const TOP_BAR_H = 100;
const BOT_BAR_H = 185;
const HOOK_FONT_SIZE = 56;
const DETAIL_FONT_SIZE = 52;
const BORDER_W = 0; // side borders removed; kept as zero so text x-offset math still works

function normaliseText(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().trim();
}

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
      if (current) { lines.push(current); current = word.slice(0, maxChars); }
      else { lines.push(word.slice(0, maxChars)); current = ""; }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function textToSvgPath(text, x, y, fontSize, fill = "white") {
  const font = getFont();
  if (!font) return null;
  try {
    const path = font.getPath(text, x, y, fontSize);
    const d = path.toPathData(2);
    if (!d) return null;
    return `<path d="${d}" fill="${fill}" />`;
  } catch { return null; }
}

function measureTextWidth(text, fontSize) {
  const font = getFont();
  if (!font) return text.length * fontSize * 0.6;
  try { return font.getAdvanceWidth(text, fontSize); }
  catch { return text.length * fontSize * 0.6; }
}

/**
 * Builds an SVG with:
 *  - Top red bar with hook text (large, punchy)
 *  - Bottom dark bar with detail text (specific to article)
 */
function buildOverlaySvg(hook, detail, size) {
  let content = "";

  if (hook) {
    const norm = normaliseText(hook);
    const w = measureTextWidth(norm, HOOK_FONT_SIZE);
    const x = Math.max(10, (size - w) / 2);
    const y = Math.floor(TOP_BAR_H / 2) + Math.floor(HOOK_FONT_SIZE / 2) - 4;
    const pathEl = textToSvgPath(norm, x, y, HOOK_FONT_SIZE, "white");
    content += `<rect x="0" y="0" width="${size}" height="${TOP_BAR_H}" fill="#c0161d" opacity="0.95"/>`;
    if (pathEl) content += pathEl;
  }

  if (detail) {
    const barTop = size - BOT_BAR_H;
    const lines = wrapText(normaliseText(detail), 28, 3);
    const lineSpacing = DETAIL_FONT_SIZE + 10;
    const totalH = lines.length * lineSpacing;
    const startY = barTop + Math.floor((BOT_BAR_H - totalH) / 2) + DETAIL_FONT_SIZE;
    content += `<rect x="0" y="${barTop}" width="${size}" height="${BOT_BAR_H}" fill="#c0161d" opacity="0.95"/>`;
    for (let i = 0; i < lines.length; i++) {
      const lw = measureTextWidth(lines[i], DETAIL_FONT_SIZE);
      const x = Math.max(10, (size - lw) / 2);
      const y = startY + i * lineSpacing;
      const pathEl = textToSvgPath(lines[i], x, y, DETAIL_FONT_SIZE, "white");
      if (pathEl) content += pathEl;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${content}</svg>`;
}

// Browser-like User-Agents to retry image fetches with if the first one fails
// (some CDNs/publishers reject requests without a realistic UA / Referer).
const IMAGE_FETCH_UA_VARIANTS = [
  "Mozilla/5.0 (compatible; RDS-ImageProcess/1.0)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
];

async function fetchImageBuffer(imageUrl) {
  if (!imageUrl) return null;
  let lastError = null;

  for (const ua of IMAGE_FETCH_UA_VARIANTS) {
    const controller = new AbortController();
    const t = setTimeout(
      () => controller.abort(new Error("Image fetch timeout")),
      FETCH_TIMEOUT_MS,
    );
    try {
      let refererOrigin = "";
      try { refererOrigin = new URL(String(imageUrl)).origin; } catch { /* noop */ }

      const res = await fetch(String(imageUrl), {
        signal: controller.signal,
        headers: {
          "user-agent": ua,
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          ...(refererOrigin ? { referer: `${refererOrigin}/` } : {}),
        },
      });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 256) {
        lastError = new Error(`Image too small (${buf.byteLength} bytes)`);
        continue;
      }
      return buf;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(t);
    }
  }

  console.warn(
    `[imageProcess] all fetch attempts failed for ${String(imageUrl).slice(0, 120)}: ${String(lastError?.message || lastError)}`,
  );
  return null;
}

/**
 * Fetches an image, center-crops to square, overlays hook + detail bars,
 * and returns a JPEG Buffer. If the source image can't be fetched or
 * processed, falls back to a solid-color background so the overlay bars
 * (the whole point of this function) are ALWAYS applied.
 *
 * Returns null only in the worst case (sharp completely broken).
 *
 * @param {string} imageUrl
 * @param {number} size
 * @param {string|{hook:string,detail:string}|null} teaser
 */
export async function cropToSquare(imageUrl, size = DEFAULT_SIZE, teaser = null) {
  let hook = null;
  let detail = null;
  if (teaser) {
    if (typeof teaser === "string") {
      hook = teaser;
    } else if (typeof teaser === "object") {
      hook = teaser.hook || null;
      detail = teaser.detail || null;
    }
  }

  const svg = buildOverlaySvg(hook, detail, size);
  const svgBuf = Buffer.from(svg);

  let sourceBuffer = await fetchImageBuffer(imageUrl);

  // Reject images that look like site logos or banners (white background, flat aspect ratio).
  // These produce terrible-looking posts, so we use the dark fallback instead.
  if (sourceBuffer) {
    try {
      const [meta, stats] = await Promise.all([
        sharp(sourceBuffer).metadata(),
        sharp(sourceBuffer).stats(),
      ]);

      // 1. Aspect ratio check — logos are wide and flat (width >> height).
      const w = meta.width || 1;
      const h = meta.height || 1;
      const aspectRatio = w / h;
      if (aspectRatio > 2.5) {
        console.warn(
          `[imageProcess] image rejected — logo-like aspect ratio ${aspectRatio.toFixed(2)} (${w}x${h})`,
        );
        sourceBuffer = null;
      }

      // 2. Brightness check — white/light background (e.g. logo on white).
      if (sourceBuffer && stats.channels.length >= 3) {
        const meanBrightness =
          (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3;
        if (meanBrightness > 210) {
          console.warn(
            `[imageProcess] image rejected — too bright/white (mean=${meanBrightness.toFixed(0)}/255), likely a logo`,
          );
          sourceBuffer = null;
        }
      }
    } catch (err) {
      // If stats fail, proceed with the image anyway — don't penalise valid images.
      console.warn(`[imageProcess] image quality check failed (non-fatal): ${String(err?.message || err)}`);
    }
  }

  // Happy path: we have a usable source image — resize to square and overlay bars.
  if (sourceBuffer) {
    try {
      return await sharp(sourceBuffer)
        .resize(size, size, { fit: "cover", position: "centre" })
        .composite([{ input: svgBuf, top: 0, left: 0 }])
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch (err) {
      console.warn(
        `[imageProcess] sharp processing failed, falling back to solid background: ${String(err?.message || err)}`,
      );
    }
  }

  // Fallback path: source image unavailable/corrupt. Generate a solid dark
  // background with the overlay bars on top, so every post still has the
  // curiosity-gap bars visible. Much better than posting a raw unbranded image.
  try {
    return await sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: { r: 20, g: 20, b: 24 },
      },
    })
      .composite([{ input: svgBuf, top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (err) {
    console.error(
      `[imageProcess] even solid-background fallback failed: ${String(err?.message || err)}`,
    );
    return null;
  }
}
