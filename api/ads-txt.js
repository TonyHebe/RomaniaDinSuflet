export default async function handler(req, res) {
  // Ezoic Ads.txt Manager.
  //
  // Important: some validators (including parts of the Ezoic UI) can flag a plain
  // redirect as a "potential issue". To make verification reliable, we *fetch*
  // the managed ads.txt content and serve it as `200 text/plain`.
  //
  // This route is wired at the root via `vercel.json` rewrite: `/ads.txt` -> `/api/ads-txt`.

  const rawHost = String(req?.headers?.host || "").trim();
  const requestHost = rawHost.split(":")[0].toLowerCase(); // strip any port

  const preferredDomain = String(process.env.ADS_TXT_DOMAIN || "").trim().toLowerCase();
  const candidates = [];

  if (preferredDomain) candidates.push(preferredDomain);
  if (requestHost) candidates.push(requestHost);
  if (requestHost && requestHost.startsWith("www.")) candidates.push(requestHost.slice(4));
  if (requestHost && !requestHost.startsWith("www.")) candidates.push(`www.${requestHost}`);

  // Dedupe while preserving order
  const domains = Array.from(new Set(candidates.filter(Boolean)));
  if (!domains.length) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Missing Host header; cannot determine ads.txt domain.");
    return;
  }

  async function tryFetch(domain) {
    const url = `https://srv.adstxtmanager.com/19390/${encodeURIComponent(domain)}`;
    const r = await fetch(url, {
      // Follow any internal redirects Ezoic may use.
      redirect: "follow",
      headers: {
        "user-agent": "romaniadinsuflet/ads.txt (vercel)",
        accept: "text/plain,*/*",
      },
    });
    const text = await r.text().catch(() => "");
    return { url, ok: r.ok, status: r.status, text };
  }

  let last = null;
  for (const d of domains) {
    try {
      const r = await tryFetch(d);
      last = r;
      // Heuristic: a valid ads.txt should have at least one line with commas
      // (e.g. `google.com, pub-..., DIRECT, ...`) and not be an HTML error page.
      const looksLikeText = !/<html[\s>]/i.test(r.text);
      const hasAdLine = /,\s*(direct|reseller)\b/i.test(r.text) || /\bgoogle\.com\b/i.test(r.text);
      if (r.ok && looksLikeText && (hasAdLine || r.text.trim().length > 20)) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
        res.setHeader("X-Ads-Txt-Manager", "ezoic");
        res.setHeader("X-Ads-Txt-Domain", d);
        res.end(r.text);
        return;
      }
    } catch {
      // try next candidate
    }
  }

  // Fallback: redirect to the best guess. This is better than returning nothing,
  // and still allows crawlers that follow redirects to retrieve the file.
  const fallbackDomain = domains[0];
  const fallbackUrl = `https://srv.adstxtmanager.com/19390/${encodeURIComponent(fallbackDomain)}`;
  res.statusCode = 302;
  res.setHeader("Location", fallbackUrl);
  res.setHeader("Cache-Control", "public, max-age=60");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(
    last
      ? `Temporary redirect to Ads.txt Manager (last_status=${last.status}).\n${fallbackUrl}\n`
      : `Temporary redirect to Ads.txt Manager.\n${fallbackUrl}\n`,
  );
}

