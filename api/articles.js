import { listArticles } from "./_lib/articles.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const { category, limit } = req.query || {};
    const items = await listArticles({ category, limit });
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
    res.status(200).json({ items });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}

