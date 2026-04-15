import { getPool } from "./_lib/db.js";

const SITE_URL = "https://www.romaniadinsuflet.ro";

const STATIC_PAGES = [
  { url: "/", priority: "1.0", changefreq: "daily" },
  { url: "/despre-noi.html", priority: "0.6", changefreq: "monthly" },
  { url: "/contact.html", priority: "0.5", changefreq: "monthly" },
  { url: "/privacy.html", priority: "0.3", changefreq: "monthly" },
  { url: "/terms.html", priority: "0.3", changefreq: "monthly" },
];

export default async function handler(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT slug, published_at FROM articles
       WHERE status = 'published'
       ORDER BY published_at DESC
       LIMIT 1000`,
    );

    const now = new Date().toISOString().split("T")[0];

    const staticEntries = STATIC_PAGES.map(
      (p) => `
  <url>
    <loc>${SITE_URL}${p.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`,
    ).join("");

    const articleEntries = rows
      .map((r) => {
        const lastmod = r.published_at
          ? new Date(r.published_at).toISOString().split("T")[0]
          : now;
        const loc = `${SITE_URL}/article.html?slug=${encodeURIComponent(r.slug)}`;
        return `
  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>never</changefreq>
    <priority>0.8</priority>
  </url>`;
      })
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntries}
${articleEntries}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.status(200).send(xml);
  } catch (err) {
    res.status(500).send("<?xml version=\"1.0\"?><error>Sitemap generation failed</error>");
  }
}
