import { enqueueSourceUrls } from "./_lib/sourceQueue.js";

function getProvidedSecret(req) {
  return (
    req.headers["x-admin-secret"] ||
    req.headers["x-cron-secret"] ||
    req.query?.secret ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "")
  );
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    // Protect this endpoint (recommended).
    const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
    if (secret) {
      const provided = getProvidedSecret(req);
      if (!provided || String(provided) !== String(secret)) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }
    }

    const body = await readJsonBody(req);
    const urls = Array.isArray(body?.urls)
      ? body.urls
      : body?.url
        ? [body.url]
        : [];

    if (!urls.length) {
      res.status(400).json({ ok: false, error: "Missing urls (or url)" });
      return;
    }

    const enqueued = await enqueueSourceUrls(urls);
    res.status(200).json({ ok: true, enqueued });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

