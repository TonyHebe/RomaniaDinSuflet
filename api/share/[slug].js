import { getArticleBySlug, listArticles, toExcerpt } from "../_lib/articles.js";

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

function buildArticleHtml({ title, description, imageUrl, content, articleUrl, shareUrl, publishedAt, siteUrl, relatedArticles }) {
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
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9846184063862431" crossorigin="anonymous"></script>
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
          <p class="section-muted">
            De <strong>Redacția Romania Din Suflet</strong>${dateStr ? ` &nbsp;·&nbsp; ${escapeHtml(dateStr)}` : ""}
          </p>
        </div>

        ${imageUrl ? `<img class="article-hero" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />` : ""}

        <div class="article-content">
${paragraphs}
        </div>

        <p style="margin-top:2rem;">
          <a href="${escapeHtml(siteUrl)}/" style="text-decoration:underline;">← Înapoi la știri</a>
        </p>

        ${relatedArticles && relatedArticles.length > 0 ? `
        <div style="margin-top:3rem;padding-top:2rem;border-top:1px solid #e5e7eb;">
          <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:1.2rem;">Citește și:</h2>
          <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.9rem;">
            ${relatedArticles.map(a => `
            <li>
              <a href="${escapeHtml(siteUrl)}/s/${encodeURIComponent(a.slug)}" style="text-decoration:underline;font-weight:500;color:#1a1a2e;">
                ${escapeHtml(a.title)}
              </a>
              ${a.publishedAt ? `<span style="color:#888;font-size:0.85rem;margin-left:0.5rem;">${new Date(a.publishedAt).toLocaleDateString("ro-RO",{day:"numeric",month:"long",year:"numeric"})}</span>` : ""}
            </li>`).join("")}
          </ul>
        </div>` : ""}
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

  <div class="cookie-banner" id="cookie-banner" role="dialog" aria-label="Consimțământ cookie-uri" hidden>
    <div class="cookie-inner">
      <p>Folosim cookie-uri pentru a îmbunătăți experiența ta și pentru reclame relevante (Google AdSense).
        <a href="${escapeHtml(siteUrl)}/privacy.html">Află mai multe</a>
      </p>
      <div class="cookie-actions">
        <button class="cookie-btn-accept" onclick="acceptCookies()">Accept</button>
        <button class="cookie-btn-decline" onclick="declineCookies()">Refuz</button>
      </div>
    </div>
  </div>
  <script src="${escapeHtml(siteUrl)}/script.js" defer></script>
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
    // /s/:slug is the canonical, indexable URL for every article.
    const articleUrl = `${siteUrl}/s/${encodeURIComponent(slug)}`;
    const shareUrl = articleUrl;

    const [article, recentArticles] = await Promise.all([
      getArticleBySlug(slug),
      listArticles({ category: "stiri", limit: 7 }).catch(() => []),
    ]);
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
    // Cache at edge — same response served to everyone (bots + humans).
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

    // Pick up to 4 related articles — exclude the current one
    const relatedArticles = recentArticles
      .filter(a => a.slug !== slug)
      .slice(0, 4);

    res.status(200).send(buildArticleHtml({
      title,
      description,
      imageUrl,
      content: article.content,
      articleUrl,
      shareUrl,
      publishedAt: article.publishedAt,
      siteUrl,
      relatedArticles,
    }));
  } catch (err) {
    res.status(500).send(String(err?.message || err));
  }
}
