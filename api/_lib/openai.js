const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function mustGetKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  return key;
}

export async function rewriteWithAI({ title, content, category = "stiri" } = {}) {
  const apiKey = mustGetKey();

  const prompt = [
    "Rescrie articolul în limba română, clar și concis, fără să copiezi fraze întregi.",
    "Returnează exact în acest format:",
    "Linia 1: TITLU",
    "Linia 2: (goală)",
    "Restul: conținutul articolului (paragrafe separate prin linii goale).",
    "",
    `Categorie: ${category}`,
    "",
    `Titlu sursă: ${title || ""}`.trim(),
    "",
    "Conținut sursă:",
    String(content || "").slice(0, 12000),
  ].join("\n");

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "You are a helpful Romanian news editor." },
        { role: "user", content: prompt },
      ],
    }),
  });

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
  const lines = String(text || "").split("\n");
  const title = String(lines[0] || "").trim();
  const body = lines.slice(1).join("\n").trim();
  const content = body.replace(/^\s*\n/, "").trim();
  if (!title || !content) throw new Error("Invalid rewrite format");
  return { title, content };
}

