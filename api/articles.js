import { listArticles, listArticlesPage } from "./_lib/articles.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const { category, limit, page, pageSize } = req.query || {};

    // Backwards compatible behavior:
    // - old callers: /api/articles?limit=9 => pageSize=9, page=1
    // - new callers: /api/articles?page=2&pageSize=9
    const hasPagingParams =
      page !== undefined || pageSize !== undefined || req.query?.page !== undefined;

    if (hasPagingParams) {
      const result = await listArticlesPage({
        category,
        page: page ?? 1,
        pageSize: pageSize ?? limit ?? 9,
      });
      res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
      res.status(200).json(result);
      return;
    }

    const items = await listArticles({ category, limit });
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
    res.status(200).json({ items });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}

