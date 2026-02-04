export default function handler(req, res) {
  // Ezoic ads.txt manager redirect.
  // We derive the domain from the request host so this works on:
  // - your custom domain
  // - your *.vercel.app domain
  const rawHost = String(req?.headers?.host || "").trim();
  const host = rawHost.split(":")[0]; // strip any port

  // If host is missing (rare), fall back to serving the local file by returning 404
  // so Vercel can serve /ads.txt if present.
  if (!host) {
    res.statusCode = 404;
    res.end("Host header missing");
    return;
  }

  const target = `https://srv.adstxtmanager.com/19390/${encodeURIComponent(host)}`;
  res.statusCode = 301;
  res.setHeader("Location", target);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end();
}

