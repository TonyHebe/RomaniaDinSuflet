import { getPool } from "./_lib/db.js";

const SITE_URL = "https://www.romaniadinsuflet.ro";

const STATIC_PAGES = [
  { url: "/", priority: "1.0", changefreq: "daily" },
  { url: "/despre-noi.html", priority: "0.6", changefreq: "monthly" },
  { url: "/contact.html", priority: "0.5", changefreq: "monthly" },
  { url: "/privacy.html", priority: "0.3", changefreq: "monthly" },
  { url: "/terms.html", priority: "0.3", changefreq: "monthly" },
];

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT slug, published_at FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 1000"
    );

    const now = new Date().toISOString().split("T")[0];

    const staticEntries = STATIC_PAGES.map((p) =>
      `  <url>\n    <loc>${SITE_URL}${p.url}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
    ).join("\n");

    const articleEntries = (rows || []).map((r) => {
      const lastmod = r.published_at
        ? new Date(r.published_at).toISOString().split("T")[0]
        : now;
      const slug = escapeXml(r.slug || "");
      return `  <url>\n    <loc>${SITE_URL}/article.html?slug=${encodeURIComponent(slug)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>never</changefreq>\n    <priority>0.8</priority>\n  </url>`;
    }).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticEntries}\n${articleEntries}\n</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.status(200).send(xml);
  } catch (err) {
    console.error("Sitemap error:", err);
    res.status(500).send(`<?xml version="1.0"?><error>${String(err?.message || err)}</error>`);
  }
}
