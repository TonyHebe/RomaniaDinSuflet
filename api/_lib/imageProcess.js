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

/**
 * Fetches an image, center-crops to square, overlays hook + detail bars,
 * and returns a JPEG Buffer. Returns null on any failure.
 *
 * @param {string} imageUrl
 * @param {number} size
 * @param {string|{hook:string,detail:string}|null} teaser
 */
export async function cropToSquare(imageUrl, size = DEFAULT_SIZE, teaser = null) {
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
    buffer = Buffer.from(await res.arrayBuffer());
  } catch { return null; }
  finally { clearTimeout(t); }

  try {
    let hook = null;
    let detail = null;

    if (teaser) {
      if (typeof teaser === "string") {
        // Legacy string — treat as hook only
        hook = teaser;
      } else if (typeof teaser === "object") {
        hook = teaser.hook || null;
        detail = teaser.detail || null;
      }
    }

    const svg = buildOverlaySvg(hook, detail, size);

    return await sharp(buffer)
      .resize(size, size, { fit: "cover", position: "centre" })
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch { return null; }
}
