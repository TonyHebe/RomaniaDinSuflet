export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    // This endpoint intentionally returns only non-sensitive ad zone keys.
    // Configure in Vercel:
    // - ADSTERRA_HOME_TOP_KEY
    // - ADSTERRA_ARTICLE_TOP_KEY
    //
    // Note: Ad blockers may block this call; the site should still function.
    const homeTopKey = String(process.env.ADSTERRA_HOME_TOP_KEY || "").trim();
    const articleTopKey = String(process.env.ADSTERRA_ARTICLE_TOP_KEY || "").trim();

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    res.status(200).json({
      ok: true,
      adsterra: {
        homeTopKey,
        articleTopKey,
      },
    });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

