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
  if (/^(titlul?\s*rescris|titlu|title)[\s:\-]/i.test(t)) return true;
  if (t.length < 6) return true;
  if (t.length > 200) return true;
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

  // Target ~700 words for AdSense compliance (~4200 Romanian chars).
  // Kept under 1500 tokens so the rewrite finishes within Vercel Hobby 60s limit.
  const minChars = 3500;
  const maxChars = 5000;
  // ~3.5 chars/token for Romanian.
  const maxTokens = 1500;

  const prompt = [
    `Esti un redactor de stiri roman. Rescrie si EXTINDE articolul de mai jos in limba romana.

REGULI OBLIGATORII:
- Continutul final (fara titlu) trebuie sa aiba MINIM ${minChars} caractere (aprox. 700 de cuvinte). Daca sursa e scurta, extinde cu context, explicatii si analiza.
- Nu copia fraze intregi din sursa; parafraza si restructureaza.
- Pastreaza corect: nume proprii, date, cifre, citate parafrazate.
- Titlul trebuie RESCRIS; sa nu fie identic cu titlul sursa.
- Nu inventa fapte sau persoane care nu apar in text.

STRUCTURA OBLIGATORIE:
Linia 1: noul titlu (max 12-14 cuvinte, scrie DIRECT titlul fara niciun prefix ca "Titlul rescris:" sau "Titlu:")
Linia 2: goala
Paragrafe 1-N: corpul articolului extins si detaliat (paragrafe separate prin linii goale)
Ultimul paragraf: o sectiune care incepe cu 'De ce conteaza?' urmata de 2-3 propozitii despre relevanta stirii pentru cititorii din Romania (context, impact, ce urmeaza).

Categorie: ${category}

Titlu sursa: ${title || ""}${previousBadTitle ? "\nTitlu respins (nu-l folosi): " + previousBadTitle : ""}

Continut sursa:
${sourceContent}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Keep this below the serverless maxDuration and leave room for scraping/DB.
  const timeoutMs = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "40000", 10);
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
          temperature: 0.5,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: "Esti un redactor senior de stiri roman. Scrii articole clare, echilibrate si bine documentate, de minim 800 de cuvinte." },
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
  let t = s.replace(/^(titlul?\s*rescris|titlu|title)[\s:\-]+/i, "").trim();
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
    "",
    "TEHNICA OBLIGATORIE — curiozitate prin tăiere bruscă:",
    "Titlul trebuie să se oprească IMEDIAT ÎNAINTE de informația-cheie (revelația), lăsând cititorul suspendat.",
    "Folosește construcții ca: '[Subiect] tocmai a...', '[Subiect] o pune pe [Persoana] la...', '[Subiect] anunță eliminarea...', '[Subiect] a dezvăluit că...'.",
    "Termină ÎNTOTDEAUNA cu '…' — niciodată cu un enunț complet.",
    "",
    "EXEMPLE BUNE (imită exact acest stil):",
    "'Bolojan tocmai a anunțat ceva ce nimeni nu se aștepta…'",
    "'Surpriză de proporții! Bolojan o pune pe Oana Țoiu la…'",
    "'Breaking news! Bolojan anunță eliminarea impozitului pe…'",
    "'Grindeanu tocmai a făcut un pas care schimbă totul…'",
    "",
    "EXEMPLE GREȘITE (evita enunțul complet, fără suspans):",
    "'Bolojan a anunțat că impozitul pe venit va fi eliminat din iulie.'",
    "'Grindeanu a demisionat din funcție.'",
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
            { role: "system", content: "Tu ești un editor senior de social media în România. Creezi titluri de Facebook care opresc scrollul prin tehnica curiozității suspendate: te oprești ÎNAINTE de revelație și lași cititorul să vrea să afle mai mult." },
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

  // Strip any prefix the model might add (e.g. "Titlu:", "Titlul rescris:").
  let title = firstLine.replace(/^(titlul?\s*rescris|titlu|title)[\s:\-]+/i, "").trim();
  title = title.replace(/^["„”'’]+|["„”'’]+$/g, "").trim();
  title = title.replace(/\s+/g, " ").trim();

  const bodyLines =
    firstNonEmptyIdx >= 0 ? lines.slice(firstNonEmptyIdx + 1) : [];
  const body = bodyLines.join("\n").trim();
  const content = body.replace(/^\s*\n/, "").trim();

  if (isBadTitle(title) || !content) throw new Error("Invalid rewrite format");
  return { title, content };
}

/**
 * Generates a short (3-6 word) punchy Romanian teaser phrase for a Facebook image overlay.
 * Each call produces a unique intriguing phrase based on the article title.
 * Returns null on failure so callers can fall back to the pool.
 */
/**
 * Generates a two-part image overlay teaser from the article title.
 * Returns { hook, detail } where:
 *   hook   — short punchy category label (2-4 words, e.g. "ULTIMA ORA", "SOC TOTAL")
 *   detail — specific phrase about the article topic (5-9 words, e.g. "DIN PACATE E VORBA DE CRISTI CHIVU")
 * Returns null on failure so callers can build a fallback.
 */
export async function generateImageTeaser({ title } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !title) return null;

  const prompt = `Esti un editor de stiri roman. Genereaza un overlay de imagine pentru Facebook format din 2 randuri.

REGULI STRICTE pentru "hook" - alege DOAR pe baza continutului real al articolului:
- Moarte, accident, catastrofa → "TRAGEDIE" sau "DOLIU"
- Scandal politic, coruptie, dezvăluire → "SCANDAL TOTAL" sau "DEZVALUIRE BOMBA"
- Lege noua, amenda, regula, decizie → "ATENTIE!" sau "IMPORTANT!" sau "SOCANT!"
- Stire de ultima ora urgenta → "ULTIMA ORA!" sau "BREAKING NEWS!"
- Victorie, veste buna → "VESTE BUNA!" sau "VICTORIE!"
- Stire surprinzatoare/neasteptata → "INCREDIBIL!" sau "SOC TOTAL!" sau "RASTURNARE DE SITUATIE"
- NU folosi TRAGEDIE daca nimeni nu a murit sau nu s-a intamplat ceva grav

1. "hook" - 2-4 cuvinte care REFLECTA CORECT tonul articolului
2. "detail" - TEHNICA OBLIGATORIE: taierea brusca inainte de revelatie.
   - Scrie 4-7 cuvinte specifice despre subiect, dar OPRESTE-TE INAINTE de informatia-cheie.
   - Termina INTOTDEAUNA cu "..." sau "LA..." sau "PE..." sau "CA..." — niciodata un enunt complet.
   - EXEMPLE BUNE: "BOLOJAN O PUNE PE OANA TOIU LA...", "SORIN GRINDEANU TOCMAI A...", "ELIMINAREA IMPOZITULUI PE...", "SURPRIZA DE PROPORTII! BOLOJAN..."
   - EXEMPLE GRESITE: "BOLOJAN A ANUNTAT ELIMINAREA IMPOZITULUI PE VENIT" (complet, fara suspans)

Titlu: ${String(title).trim()}

Raspunde DOAR cu JSON valid, fara diacritice, totul majuscule: {"hook":"...","detail":"..."}`;

  const timeoutMs = 12000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 80,
        messages: [
          { role: "system", content: "Esti un editor de stiri roman. Raspunzi DOAR cu JSON valid." },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = String(data?.choices?.[0]?.message?.content || "").trim()
      .replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const json = JSON.parse(raw);
    if (!json.hook || !json.detail) return null;
    return {
      hook: String(json.hook).toUpperCase().trim(),
      detail: String(json.detail).toUpperCase().trim(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

