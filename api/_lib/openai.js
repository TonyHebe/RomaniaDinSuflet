const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function mustGetKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  return key;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function isTimeoutError(err) {
  const name = String(err?.name || "");
  const msg = String(err?.message || err || "");
  return name === "AbortError" || /timeout/i.test(msg);
}

function normalizeForCompare(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[„”"“”'’]/g, "")
    .replace(/\s*[–—-]\s*/g, "-")
    .trim();
}

export function isBadTitle(title) {
  const t = String(title || "").trim();
  if (!t) return true;
  const n = normalizeForCompare(t);
  if (!n) return true;
  if (n === "titlu" || n === "title") return true;
  if (/^(titlu|title)\s*[:\-]/i.test(t)) return true;
  if (t.length < 6) return true;
  return false;
}

export function titlesLookSame(a, b) {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // very small edits (e.g. adding a period) still count as "same"
  const min = Math.min(na.length, nb.length);
  if (min >= 18 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

export async function rewriteWithAI({
  title,
  content,
  category = "stiri",
  previousBadTitle,
} = {}) {
  const apiKey = mustGetKey();

  const sourceContent = String(content || "").trim().slice(0, 12000);
  const sourceCharCount = sourceContent.length;
  const minChars = Math.max(300, Math.floor(sourceCharCount * 0.9));
  const maxChars = Math.max(minChars + 50, Math.ceil(sourceCharCount * 1.1));
  // Rough heuristic: ~4 chars/token for Romanian prose.
  const maxTokens = Math.min(4096, Math.max(900, Math.ceil(maxChars / 3)));

  const prompt = [
    "Rescrie articolul în limba română, clar și complet, fără să copiezi fraze întregi.",
    "IMPORTANT: Nu rezuma și nu scurta textul. Păstrează toate ideile și detaliile din sursă.",
    `Țintește o lungime a conținutului (fără titlu) între ${minChars} și ${maxChars} caractere (aprox. aceeași lungime ca sursa).`,
    "Nu adăuga informații noi și nu inventa detalii; doar restructurează și parafrazează.",
    "Păstrează corect numele proprii, datele, cifrele și citatele (parafrazate) din sursă.",
    "Titlul trebuie să fie RESCRIS (parafrazat) și să NU fie identic cu titlul sursă.",
    "Nu folosi cuvântul „TITLU” ca text în răspuns.",
    "Returnează exact în acest format:",
    "Linia 1: (titlu rescris, max 12-14 cuvinte)",
    "Linia 2: (goală)",
    "Restul: conținutul articolului (paragrafe separate prin linii goale).",
    "",
    `Categorie: ${category}`,
    "",
    `Titlu sursă: ${title || ""}`.trim(),
    previousBadTitle ? `Titlu respins (nu-l folosi): ${previousBadTitle}` : null,
    "",
    "Conținut sursă:",
    sourceContent,
  ]
    .filter(Boolean)
    .join("\n");

  // Keep this below the serverless maxDuration and leave room for scraping/DB.
  const timeoutMs = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "45000", 10);
  const retries = Number.parseInt(process.env.OPENAI_RETRIES || "2", 10);
  const maxAttempts = Math.max(1, (Number.isFinite(retries) ? retries : 2) + 1);

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const t = setTimeout(
      () => controller.abort(new Error(`OpenAI timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0.4,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: "You are a helpful Romanian news editor." },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`OpenAI error (${res.status}): ${text.slice(0, 400)}`);
        err.status = res.status;
        lastErr = err;

        if (!isRetryableStatus(res.status) || attempt >= maxAttempts) throw err;
      } else {
        const data = await res.json();
        const out = data?.choices?.[0]?.message?.content;
        if (!out) throw new Error("OpenAI returned empty response");
        return String(out).trim();
      }
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status ?? NaN);
      const retryable = isTimeoutError(err) || isRetryableStatus(status);
      if (!retryable || attempt >= maxAttempts) throw err;
    } finally {
      clearTimeout(t);
    }

    // Exponential backoff w/ jitter (serverless-friendly, capped).
    const base = 800 * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    await sleep(Math.min(5000, base + jitter));
  }

  throw lastErr || new Error("OpenAI error");
}

function cleanSingleLineTitle(raw) {
  const s = String(raw || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => String(l || "").trim())
    .filter(Boolean)[0] || "";
  let t = s.replace(/^(titlu|title)\s*[:\-]\s*/i, "").trim();
  t = t.replace(/^["„”'’]+|["„”'’]+$/g, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function extractNumberTokens(text) {
  const matches = String(text || "").match(/\d+/g) || [];
  return Array.from(new Set(matches));
}

export async function rewriteFacebookTitleWithAI({
  title,
  content,
  sourceUrl,
  category = "stiri",
} = {}) {
  const apiKey = mustGetKey();
  const sourceTitle = String(title || "").trim();
  const sourceContent = String(content || "").trim().slice(0, 2500);
  const numbers = extractNumberTokens(sourceTitle);

  const maxChars = Number.parseInt(process.env.FB_TITLE_MAX_CHARS || "120", 10);
  const targetMax = Number.isFinite(maxChars) ? Math.max(60, Math.min(180, maxChars)) : 120;

  const prompt = [
    "Rescrie DOAR titlul pentru un POST pe Facebook în limba română.",
    "IMPORTANT: Păstrează ideea principală și faptele-cheie (cine/ce/unde). Nu inventa nimic și nu adăuga detalii noi.",
    "Păstrează numele proprii și toate cifrele (numerele) din titlul original, dacă există.",
    `Țintește maximum ${targetMax} caractere (fără „Vezi in comentarii”).`,
    "Stil: o propoziție scurtă, cu impact. Dacă se potrivește natural, creează curiozitate și termină cu „…” (ex: „înainte să…” / „după ce…” / „când…”).",
    "NU include: „Vezi in comentarii”, emoji-uri, hashtag-uri, ghilimele, rânduri multiple.",
    "Returnează exact o singură linie: titlul rescris.",
    "",
    `Categorie: ${category}`,
    sourceUrl ? `Sursă: ${String(sourceUrl).slice(0, 200)}` : null,
    "",
    `Titlu original: ${sourceTitle}`.trim(),
    "",
    "Context (fragment):",
    sourceContent,
  ]
    .filter(Boolean)
    .join("\n");

  const timeoutMs = Number.parseInt(process.env.FB_TITLE_OPENAI_TIMEOUT_MS || "12000", 10);
  const retries = Number.parseInt(process.env.FB_TITLE_OPENAI_RETRIES || "1", 10);
  const maxAttempts = Math.max(1, (Number.isFinite(retries) ? retries : 1) + 1);

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const t = setTimeout(
      () => controller.abort(new Error(`OpenAI timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.FB_TITLE_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0.6,
          max_tokens: 120,
          messages: [
            { role: "system", content: "You are a helpful Romanian social media editor." },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`OpenAI error (${res.status}): ${text.slice(0, 400)}`);
        err.status = res.status;
        lastErr = err;
        if (!isRetryableStatus(res.status) || attempt >= maxAttempts) throw err;
      } else {
        const data = await res.json();
        const out = data?.choices?.[0]?.message?.content;
        if (!out) throw new Error("OpenAI returned empty response");

        let fbTitle = cleanSingleLineTitle(out);
        // Ensure the model doesn't include our CTA.
        fbTitle = fbTitle.replace(/\s*(?:\.\.\.|…)?\s*vezi in comentarii[\s\S]*$/i, "").trim();
        fbTitle = fbTitle.replace(/\s+/g, " ").trim();

        if (!fbTitle) throw new Error("OpenAI returned empty title");
        if (isBadTitle(fbTitle)) throw new Error("OpenAI returned invalid title");

        // Hard guard: if the original title contains numbers, keep them.
        for (const n of numbers) {
          if (!fbTitle.includes(n)) throw new Error("OpenAI title removed important numbers");
        }

        // Keep a reasonable length (best-effort).
        if (fbTitle.length > 220) fbTitle = `${fbTitle.slice(0, 219).trimEnd()}…`;

        return fbTitle;
      }
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status ?? NaN);
      const retryable = isTimeoutError(err) || isRetryableStatus(status);
      if (!retryable || attempt >= maxAttempts) throw err;
    } finally {
      clearTimeout(t);
    }

    const base = 600 * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    await sleep(Math.min(2500, base + jitter));
  }

  throw lastErr || new Error("OpenAI error");
}

export function parseRewrite(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Invalid rewrite format");

  const lines = raw.split("\n");
  const firstNonEmptyIdx = lines.findIndex((l) => String(l).trim().length > 0);
  const firstLine =
    firstNonEmptyIdx >= 0 ? String(lines[firstNonEmptyIdx] || "").trim() : "";

  // Allow responses like "TITLU: ...." even though we don't ask for it.
  let title = firstLine.replace(/^(titlu|title)\s*[:\-]\s*/i, "").trim();
  title = title.replace(/^["„”'’]+|["„”'’]+$/g, "").trim();
  title = title.replace(/\s+/g, " ").trim();

  const bodyLines =
    firstNonEmptyIdx >= 0 ? lines.slice(firstNonEmptyIdx + 1) : [];
  const body = bodyLines.join("\n").trim();
  const content = body.replace(/^\s*\n/, "").trim();

  if (isBadTitle(title) || !content) throw new Error("Invalid rewrite format");
  return { title, content };
}

