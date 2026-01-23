import { getPool } from "./db.js";

export function toExcerpt(text, maxLen = 160) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

export async function listArticles({ category = "stiri", limit = 9 } = {}) {
  const pool = getPool();
  const lim = Math.max(1, Math.min(50, Number(limit) || 9));
  const cat = String(category || "stiri");

  const { rows } = await pool.query(
    `
      select
        slug,
        title,
        image_url as "imageUrl",
        excerpt,
        published_at as "publishedAt"
      from articles
      where category = $1 and status = 'published'
      order by published_at desc
      limit $2
    `,
    [cat, lim],
  );
  return rows;
}

export async function getArticleBySlug(slug) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
      select
        slug,
        title,
        content,
        image_url as "imageUrl",
        excerpt,
        published_at as "publishedAt",
        category
      from articles
      where slug = $1 and status = 'published'
      limit 1
    `,
    [slug],
  );
  return rows[0] ?? null;
}

