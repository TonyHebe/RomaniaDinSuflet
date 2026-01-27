import { getArticleBySlug, toExcerpt } from "../_lib/articles.js";

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildSiteUrl(req) {
  const siteUrlRaw =
    process.env.SITE_URL ||
    `https://${req?.headers?.["x-forwarded-host"] || req?.headers?.host || "localhost"}`;
  return String(siteUrlRaw).replace(/\/$/, "");
}

export const config = {
  maxDuration: 10,
};

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const slug = String(req.query?.slug || "").trim();
    if (!slug) {
      res.status(400).send("Missing slug");
      return;
    }

    const siteUrl = buildSiteUrl(req);
    const articleUrl = `${siteUrl}/article.html?slug=${encodeURIComponent(slug)}`;
    // Prefer the pretty share URL (rewritten to this API route on Vercel).
    const shareUrl = `${siteUrl}/s/${encodeURIComponent(slug)}`;

    const article = await getArticleBySlug(slug);
    if (!article) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(404).send(`<!doctype html>
<html lang="ro">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Articol inexistent — Romania Din Suflet</title>
  </head>
  <body>
    <p>Articol inexistent.</p>
    <p><a href="${escapeHtml(siteUrl)}/">Înapoi la prima pagină</a></p>
  </body>
</html>`);
      return;
    }

    const title = String(article.title || "Articol — Romania Din Suflet").trim();
    const description = String(article.excerpt || toExcerpt(article.content, 180) || "")
      .replace(/\s+/g, " ")
      .trim();
    const imageUrl = article.imageUrl ? String(article.imageUrl).trim() : "";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Cache for crawlers + edge; articles rarely change after publish.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

    res.status(200).send(`<!doctype html>
<html lang="ro">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(articleUrl)}" />

    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Romania Din Suflet" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : ""}
    ${imageUrl ? `<meta property="og:image:alt" content="${escapeHtml(title)}" />` : ""}

    <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />` : ""}

    <meta http-equiv="refresh" content="0;url=${escapeHtml(articleUrl)}" />
  </head>
  <body>
    <noscript>
      <p>
        <a href="${escapeHtml(articleUrl)}">Deschide articolul</a>
      </p>
    </noscript>
    <script>
      // Redirect humans quickly; crawlers will still read OG tags.
      location.replace(${JSON.stringify(articleUrl)});
    </script>
  </body>
</html>`);
  } catch (err) {
    res.status(500).send(String(err?.message || err));
  }
}

