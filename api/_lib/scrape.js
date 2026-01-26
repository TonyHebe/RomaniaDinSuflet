function decodeEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|br|li|h1|h2|h3|h4|h5|h6|article|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function getMeta(html, propOrName) {
  const re = new RegExp(
    `<meta\\s+(?:property|name)=["']${propOrName}["']\\s+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const m = String(html || "").match(re);
  return m?.[1] ? decodeEntities(m[1]).trim() : null;
}

function getTitle(html) {
  const og = getMeta(html, "og:title");
  if (og) return og;
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : null;
}

function extractBestContentHtml(html) {
  const h = String(html || "");
  const article = h.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (article?.[1]) return article[1];
  const main = h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main?.[1]) return main[1];
  const body = h.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return body?.[1] || h;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetries(url, options, { retries = 3 } = {}) {
  let lastRes = null;
  let lastText = "";

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(url, options);
    lastRes = res;

    if (res.ok) return res;

    // Retry only on throttling / transient gateway errors.
    const retryable = [429, 500, 502, 503, 504].includes(res.status);
    if (!retryable || attempt >= retries) return res;

    // Respect Retry-After if present (seconds).
    const ra = Number.parseInt(res.headers?.get?.("retry-after") || "", 10);
    const retryAfterMs = Number.isFinite(ra) ? ra * 1000 : null;

    // Short capped backoff with jitter (serverless-friendly).
    const base = 600 * 2 ** attempt;
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(2500, retryAfterMs ?? base + jitter);

    // Drain body to avoid leaking resources on some runtimes.
    try {
      lastText = await res.text();
    } catch {
      lastText = "";
    }

    await sleep(delay);
  }

  // Should be unreachable, but return something sensible.
  if (lastRes) return lastRes;
  throw new Error(`Fetch failed for ${url.toString()}${lastText ? `: ${lastText.slice(0, 120)}` : ""}`);
}

export async function scrapeSourceUrl(sourceUrl, { userAgent } = {}) {
  const url = new URL(String(sourceUrl));
  const res = await fetchWithRetries(
    url,
    {
    redirect: "follow",
    headers: {
      "user-agent":
        userAgent ||
        "Mozilla/5.0 (compatible; RomaniaDinSufletBot/1.0; +https://www.romaniadinsuflet.ro)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ro-RO,ro;q=0.9,en-US;q=0.7,en;q=0.5",
    },
    },
    { retries: 3 },
  );
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url.toString()}`);
  }

  const html = await res.text();
  const title = getTitle(html);
  const imageUrl = getMeta(html, "og:image") || getMeta(html, "twitter:image");

  const best = extractBestContentHtml(html);
  const text = stripTags(best);

  if (!text || text.length < 200) {
    // fallback to stripping full HTML
    const allText = stripTags(html);
    return {
      title: title || url.hostname,
      content: allText,
      imageUrl,
    };
  }

  return {
    title: title || url.hostname,
    content: text,
    imageUrl,
  };
}

