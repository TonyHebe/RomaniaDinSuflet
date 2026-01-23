import { getArticleBySlug } from "../_lib/articles.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const slug = String(req.query?.slug || "").trim();
    if (!slug) {
      res.status(400).json({ error: "Missing slug" });
      return;
    }

    const article = await getArticleBySlug(slug);
    if (!article) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");
    res.status(200).json(article);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}

