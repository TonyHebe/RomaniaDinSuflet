const FEEDS = [
  { name: "cancan-stiri", url: "https://www.cancan.ro/stiri/feed" },
  { name: "romaniatv-politica", url: "https://www.romaniatv.net/politica/feed" },
  { name: "g4media-articole", url: "https://www.g4media.ro/articole/feed" },
  { name: "ciao-news", url: "https://ciao.ro/news/feed/" },
  { name: "unica-stiri", url: "https://www.unica.ro/stiri/feed" },
];

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function stripCdata(s) {
  return String(s || "")
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function extractLinksFromRss(xml, { limit = 30 } = {}) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const out = [];
  for (const item of items) {
    const m = item.match(/<link>([\s\S]*?)<\/link>/i);
    if (!m?.[1]) continue;
    const raw = stripCdata(m[1]);
    if (!raw) continue;
    try {
      // normalize
      const u = new URL(raw);
      u.hash = "";
      out.push(u.toString());
    } catch {
      // ignore
    }
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchText(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; RDS-Discovery/1.0)",
        accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
      },
      redirect: "follow",
    });

    if (res.ok) return await res.text();

    // Some publishers rate-limit aggressively; retry a bit.
    if (res.status === 429 && attempt < 2) {
      const waitMs = 3000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }
}

async function enqueueUrls(urls) {
  const apiUrl = mustEnv("SOURCES_API_URL");
  const adminSecret = mustEnv("ADMIN_SECRET");
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-secret": adminSecret,
    },
    body: JSON.stringify({ urls }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Enqueue failed (${res.status}): ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

const seen = new Set();
const all = [];

for (const feed of FEEDS) {
  try {
    const xml = await fetchText(feed.url);
    const links = extractLinksFromRss(xml, { limit: 25 });
    const unique = [];
    for (const l of links) {
      if (seen.has(l)) continue;
      seen.add(l);
      unique.push(l);
    }
    all.push(...unique);
    console.log(`[${feed.name}] ${unique.length} links`);
  } catch (err) {
    console.error(`[${feed.name}] error:`, String(err?.message || err));
  }
}

if (!all.length) {
  console.log("No links found.");
  process.exit(0);
}

// Keep payload reasonable per run.
const batch = all.slice(0, 80);
const resp = await enqueueUrls(batch);
console.log(`Enqueued ${batch.length} urls.`);
console.log(JSON.stringify(resp).slice(0, 2000));

