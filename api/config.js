export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    // Neutral alias for fetching public ad configuration.
    // Some blockers block endpoints containing "ads" in the path.
    const homeTopKey = String(process.env.ADSTERRA_HOME_TOP_KEY || "").trim();
    const articleTopKey = String(process.env.ADSTERRA_ARTICLE_TOP_KEY || "").trim();

    const homeTopKeyDesktop = String(process.env.ADSTERRA_HOME_TOP_KEY_DESKTOP || "").trim();
    const homeTopKeyMobile = String(process.env.ADSTERRA_HOME_TOP_KEY_MOBILE || "").trim();
    const articleTopKeyDesktop = String(process.env.ADSTERRA_ARTICLE_TOP_KEY_DESKTOP || "").trim();
    const articleTopKeyMobile = String(process.env.ADSTERRA_ARTICLE_TOP_KEY_MOBILE || "").trim();

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    res.status(200).json({
      ok: true,
      adsterra: {
        homeTopKey,
        articleTopKey,
        homeTopKeyDesktop: homeTopKeyDesktop || homeTopKey,
        homeTopKeyMobile: homeTopKeyMobile || homeTopKey,
        articleTopKeyDesktop: articleTopKeyDesktop || articleTopKey,
        articleTopKeyMobile: articleTopKeyMobile || articleTopKey,
      },
    });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

