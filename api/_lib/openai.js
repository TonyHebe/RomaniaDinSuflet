const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function mustGetKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  return key;
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

  const timeoutMs = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "30000", 10);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error("OpenAI timeout")), timeoutMs);
  let res;
  try {
    res = await fetch(OPENAI_URL, {
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
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI error (${res.status}): ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error("OpenAI returned empty response");
  return String(out).trim();
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

