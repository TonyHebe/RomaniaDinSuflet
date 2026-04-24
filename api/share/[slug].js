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

function normalizeOgImageUrl(raw, siteUrl) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^data:/i.test(s)) return "";
  try {
    return new URL(s, siteUrl).toString();
  } catch {
    return "";
  }
}

function isHumanBrowser(req) {
  const ua = String(req?.headers?.["user-agent"] || "").toLowerCase();
  if (!ua) return false;
  // If it looks like a real browser (has Mozilla and no known bot markers), treat as human.
  return /mozilla/.test(ua) && !/bot|crawler|spider|crawling|preview|facebookexternalhit|facebot|twitterbot|slackbot|discordbot|whatsapp|telegrambot|linkedinbot|pinterest|embedly|google|adsbot|mediapartners|inspection/i.test(ua);
}

function buildArticleHtml({ title, description, imageUrl, content, articleUrl, shareUrl, publishedAt, siteUrl }) {
  const paragraphs = String(content || "")
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `      <p>${escapeHtml(p)}</p>`)
    .join("\n");

  const dateStr = publishedAt
    ? new Date(publishedAt).toLocaleDateString("ro-RO", { year: "numeric", month: "long", day: "numeric" })
    : "";

  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": title,
    "description": description,
    "url": articleUrl,
    "mainEntityOfPage": { "@type": "WebPage", "@id": articleUrl },
    "datePublished": publishedAt || null,
    "dateModified": publishedAt || null,
    "author": { "@type": "Organization", "name": "Romania Din Suflet", "url": siteUrl },
    "publisher": {
      "@type": "Organization",
      "name": "Romania Din Suflet",
      "url": siteUrl,
      "logo": { "@type": "ImageObject", "url": `${siteUrl}/assets/logo.svg` }
    },
    "image": imageUrl ? [imageUrl] : undefined,
    "inLanguage": "ro-RO"
  });

  return `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — Romania Din Suflet</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(articleUrl)}" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Romania Din Suflet" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(shareUrl)}" />
  ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : ""}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />` : ""}
  ${imageUrl ? `<meta property="og:image:alt" content="${escapeHtml(title)}" />` : ""}
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />` : ""}

  <meta name="google-adsense-account" content="ca-pub-9846184063862431" />
  <link rel="icon" href="${escapeHtml(siteUrl)}/assets/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="${escapeHtml(siteUrl)}/styles.css" />
  <script type="application/ld+json">${schema}</script>
  <script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Sari la conținut</a>

  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="${escapeHtml(siteUrl)}/" aria-label="Romania Din Suflet - Acasă">
        <img class="brand-mark" src="${escapeHtml(siteUrl)}/assets/logo.svg" width="40" height="40" alt="" aria-hidden="true" />
        <div class="brand-text">
          <span class="brand-name">Romania</span>
          <span class="brand-sub">Din Suflet</span>
        </div>
      </a>
      <nav class="site-nav" aria-label="Navigație principală">
        <a href="${escapeHtml(siteUrl)}/#stiri">Știri</a>
        <a href="${escapeHtml(siteUrl)}/despre-noi.html">Despre noi</a>
        <a href="${escapeHtml(siteUrl)}/contact.html">Contact</a>
      </nav>
    </div>
  </header>

  <main id="main" class="site-main">
    <section class="section" aria-labelledby="article-title">
      <div class="container">
        <div class="section-head">
          <h1 class="section-title" id="article-title">${escapeHtml(title)}</h1>
          ${dateStr ? `<p class="section-muted">${escapeHtml(dateStr)}</p>` : ""}
        </div>

        ${imageUrl ? `<img class="article-hero" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />` : ""}

        <div class="article-content">
${paragraphs}
        </div>

        <p style="margin-top:2rem;">
          <a href="${escapeHtml(siteUrl)}/" style="text-decoration:underline;">← Înapoi la știri</a>
        </p>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p class="footer-brand">Romania Din Suflet</p>
      <p class="footer-muted">
        © ${new Date().getFullYear()} Toate drepturile rezervate. |
        <a href="${escapeHtml(siteUrl)}/privacy.html" style="color:inherit;text-decoration:underline;">Politica de Confidențialitate</a> |
        <a href="${escapeHtml(siteUrl)}/terms.html" style="color:inherit;text-decoration:underline;">Termeni și Condiții</a>
      </p>
    </div>
  </footer>
</body>
</html>`;
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
    const articleUrl = `${siteUrl}/s/${encodeURIComponent(slug)}`;
    const shareUrl = articleUrl;

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
    const imageUrl = normalizeOgImageUrl(article.imageUrl, siteUrl);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Cache at edge for 1h, stale-while-revalidate for 24h.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

    // Human browsers with no JS-rendering concerns get redirected to the SPA
    // for the full interactive experience (ads, cookie banner, etc.).
    // Everyone else — bots, crawlers, Google AdSense, social preview crawlers —
    // gets the full server-rendered HTML with real article content so Google
    // can index and evaluate the page properly.
    if (isHumanBrowser(req)) {
      // Redirect humans to the SPA article page for the full experience.
      res.setHeader("Location", `${siteUrl}/article.html?slug=${encodeURIComponent(slug)}`);
      res.status(302).end();
      return;
    }

    // Serve full SSR HTML for all crawlers (Google, AdSense, social, etc.)
    res.status(200).send(buildArticleHtml({
      title,
      description,
      imageUrl,
      content: article.content,
      articleUrl,
      shareUrl,
      publishedAt: article.publishedAt,
      siteUrl,
    }));
  } catch (err) {
    res.status(500).send(String(err?.message || err));
  }
}
