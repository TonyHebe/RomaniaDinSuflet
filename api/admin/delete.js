import {
  deleteArticlesBySlugs,
  deleteArticlesByTitleContains,
  deleteArticlesByTitles,
  selectArticlesBySlugs,
  selectArticlesByTitleContains,
  selectArticlesByTitles,
} from "../_lib/articles.js";

function getProvidedSecret(req) {
  return (
    req.headers["x-admin-secret"] ||
    req.headers["x-cron-secret"] ||
    req.query?.secret ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "")
  );
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function uniqBySlug(rows) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const slug = String(r?.slug || "").trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(r);
  }
  return out;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    // Protect this endpoint (recommended).
    const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
    if (secret) {
      const provided = getProvidedSecret(req);
      if (!provided || String(provided) !== String(secret)) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }
    }

    const body = await readJsonBody(req);
    const slugs = Array.isArray(body?.slugs) ? body.slugs : body?.slug ? [body.slug] : [];
    const titles = Array.isArray(body?.titles)
      ? body.titles
      : body?.title
        ? [body.title]
        : [];
    const titleContains = Array.isArray(body?.titleContains)
      ? body.titleContains
      : body?.titleContains
        ? [body.titleContains]
        : [];

    const dryRun = body?.dryRun !== undefined ? Boolean(body.dryRun) : true;

    if (!slugs.length && !titles.length && !titleContains.length) {
      res.status(400).json({
        ok: false,
        error: "Missing slugs/titles/titleContains",
      });
      return;
    }

    if (dryRun) {
      const [a, b, c] = await Promise.all([
        selectArticlesBySlugs(slugs),
        selectArticlesByTitles(titles),
        selectArticlesByTitleContains(titleContains),
      ]);
      const matches = uniqBySlug([...a, ...b, ...c]);
      res.status(200).json({ ok: true, dryRun: true, matches });
      return;
    }

    const deleted = uniqBySlug([
      ...(await deleteArticlesBySlugs(slugs)),
      ...(await deleteArticlesByTitles(titles)),
      ...(await deleteArticlesByTitleContains(titleContains)),
    ]);

    res.status(200).json({ ok: true, dryRun: false, deleted });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

