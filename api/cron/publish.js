export default async function handler(req, res) {
  try {
    // Scaffold only: you’ll plug in scrape -> rewrite -> publish -> facebook.
    // Keeping this endpoint safe by requiring a secret.
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const provided =
        req.headers["x-cron-secret"] ||
        req.query?.secret ||
        req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
      if (!provided || String(provided) !== String(secret)) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }
    }

    res.status(200).json({
      ok: true,
      message:
        "Cron scaffold installed. Next: implement processArticle() with DB + scraping + AI + publish + Facebook.",
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

