export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    // Lightweight health endpoint. Does not require secrets.
    // Helpful to diagnose “empty site” reports when /api is blocked/misconfigured.
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      time: new Date().toISOString(),
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

