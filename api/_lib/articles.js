import { getPool } from "./db.js";
import { slugify } from "./slug.js";

export function toExcerpt(text, maxLen = 160) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

export async function getSecondsSinceLastPublish({ category = "stiri" } = {}) {
  const pool = getPool();
  const cat = String(category || "stiri");
  const { rows } = await pool.query(
    `
      select extract(epoch from (now() - max(published_at))) as "seconds"
      from articles
      where category = $1 and status = 'published'
    `,
    [cat],
  );

  const seconds = rows?.[0]?.seconds;
  if (seconds === null || seconds === undefined) return null;
  const n = Number(seconds);
  return Number.isFinite(n) ? n : null;
}

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
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

export async function listArticlesPage({
  category = "stiri",
  page = 1,
  pageSize = 9,
} = {}) {
  const pool = getPool();
  const cat = String(category || "stiri");
  const size = clampInt(pageSize, { min: 1, max: 50, fallback: 9 });
  const p = clampInt(page, { min: 1, max: 1_000_000, fallback: 1 });
  const offset = (p - 1) * size;

  const [{ rows: countRows }, { rows: itemRows }] = await Promise.all([
    pool.query(
      `
        select count(*)::int as total
        from articles
        where category = $1 and status = 'published'
      `,
      [cat],
    ),
    pool.query(
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
        offset $3
      `,
      [cat, size, offset],
    ),
  ]);

  const total = Number(countRows?.[0]?.total || 0);
  const totalPages = total > 0 ? Math.ceil(total / size) : 0;

  return {
    items: itemRows,
    page: p,
    pageSize: size,
    total,
    totalPages,
  };
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

export async function insertArticle({
  title,
  content,
  excerpt = null,
  imageUrl = null,
  category = "stiri",
} = {}) {
  const pool = getPool();
  const t = String(title || "").trim();
  const c = String(content || "").trim();
  if (!t) throw new Error("Missing title");
  if (!c) throw new Error("Missing content");

  const base = slugify(t);
  let lastErr;
  for (let i = 0; i < 10; i += 1) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    try {
      const { rows } = await pool.query(
        `
          insert into articles (slug, title, content, excerpt, image_url, category, status, published_at, created_at)
          values ($1, $2, $3, $4, $5, $6, 'published', now(), now())
          returning slug
        `,
        [
          slug,
          t,
          c,
          excerpt ?? toExcerpt(c),
          imageUrl ? String(imageUrl) : null,
          String(category || "stiri"),
        ],
      );
      return rows[0]?.slug || slug;
    } catch (err) {
      // 23505: unique_violation
      if (err?.code === "23505") {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Failed to generate unique slug");
}

function normalizeStringArray(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((v) => String(v || "").trim())
        .filter(Boolean),
    ),
  );
}

export async function selectArticlesBySlugs(slugs) {
  const pool = getPool();
  const s = normalizeStringArray(slugs);
  if (!s.length) return [];
  const { rows } = await pool.query(
    `
      select slug, title, published_at as "publishedAt", category, status
      from articles
      where slug = any($1::text[])
      order by published_at desc
    `,
    [s],
  );
  return rows;
}

export async function selectArticlesByTitles(titles) {
  const pool = getPool();
  const t = normalizeStringArray(titles);
  if (!t.length) return [];
  const { rows } = await pool.query(
    `
      select slug, title, published_at as "publishedAt", category, status
      from articles
      where title = any($1::text[])
      order by published_at desc
    `,
    [t],
  );
  return rows;
}

export async function selectArticlesByTitleContains(substrings) {
  const pool = getPool();
  const parts = normalizeStringArray(substrings);
  if (!parts.length) return [];
  const patterns = parts.map((p) => `%${p}%`);
  const { rows } = await pool.query(
    `
      select slug, title, published_at as "publishedAt", category, status
      from articles
      where title ilike any($1::text[])
      order by published_at desc
    `,
    [patterns],
  );
  return rows;
}

export async function deleteArticlesBySlugs(slugs) {
  const pool = getPool();
  const s = normalizeStringArray(slugs);
  if (!s.length) return [];
  const { rows } = await pool.query(
    `
      delete from articles
      where slug = any($1::text[])
      returning slug, title
    `,
    [s],
  );
  return rows;
}

export async function deleteArticlesByTitles(titles) {
  const pool = getPool();
  const t = normalizeStringArray(titles);
  if (!t.length) return [];
  const { rows } = await pool.query(
    `
      delete from articles
      where title = any($1::text[])
      returning slug, title
    `,
    [t],
  );
  return rows;
}

export async function deleteArticlesByTitleContains(substrings) {
  const pool = getPool();
  const parts = normalizeStringArray(substrings);
  if (!parts.length) return [];
  const patterns = parts.map((p) => `%${p}%`);
  const { rows } = await pool.query(
    `
      delete from articles
      where title ilike any($1::text[])
      returning slug, title
    `,
    [patterns],
  );
  return rows;
}

