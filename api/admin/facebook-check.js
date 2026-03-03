/**
 * Debug endpoint: verify FB_PAGE_ID and FB_PAGE_TOKEN.
 * Call with ADMIN_SECRET or CRON_SECRET to see the exact Facebook error if posting fails.
 *
 * GET /api/admin/facebook-check?secret=YOUR_ADMIN_SECRET
 * or Header: x-admin-secret / x-cron-secret
 */
import {
  getFacebookPageInfo,
  isFacebookTokenExpiredError,
  isFacebookPermissionConfigError,
} from "../_lib/facebook.js";

function getSecret(req) {
  return (
    req.headers["x-admin-secret"] ||
    req.headers["x-cron-secret"] ||
    req.query?.secret ||
    (req.headers["authorization"] && req.headers["authorization"].replace(/^Bearer\s+/i, ""))
  );
}

function formatFbError(err) {
  if (!err) return null;
  if (err?.name === "FacebookGraphError" && err?.fb) {
    return {
      message: err.message,
      code: err.fb?.code,
      errorSubcode: err.fb?.errorSubcode,
      type: err.fb?.type,
    };
  }
  return { message: String(err?.message || err) };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }

  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  const provided = getSecret(req);
  if (!secret || provided !== secret) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  const hasPageId = Boolean(process.env.FB_PAGE_ID);
  const hasToken = Boolean(process.env.FB_PAGE_TOKEN);

  if (!hasPageId || !hasToken) {
    res.status(200).json({
      ok: false,
      configured: false,
      env: {
        FB_PAGE_ID: hasPageId ? "set" : "missing",
        FB_PAGE_TOKEN: hasToken ? "set" : "missing",
      },
      error: !hasPageId && !hasToken
        ? "FB_PAGE_ID and FB_PAGE_TOKEN are not set in this environment."
        : !hasPageId
          ? "FB_PAGE_ID is not set."
          : "FB_PAGE_TOKEN is not set.",
    });
    return;
  }

  try {
    const page = await getFacebookPageInfo();
    res.status(200).json({
      ok: true,
      configured: true,
      page: page ? { id: page.id, name: page.name } : null,
      hint: "Token can access the Page. If posts still don't appear, check GitHub Actions log for processed.facebook.error or DB last_error.",
    });
  } catch (err) {
    const fb = formatFbError(err);
    res.status(200).json({
      ok: false,
      configured: true,
      error: err?.message || String(err),
      facebook: fb,
      tokenExpired: isFacebookTokenExpiredError(err),
      permissionError: isFacebookPermissionConfigError(err),
      hint:
        err?.message?.includes("Missing") ||
        (fb?.code === 190 && (fb?.errorSubcode === 463 || fb?.errorSubcode === 460))
          ? "Token expired or invalid. Generate a new Page access token (not User token): Meta for Developers → Your App → Tools → Graph API Explorer → User or Page → Get Token → select pages_manage_posts, pages_read_engagement → then get Page token from /me/accounts for your Page."
          : fb?.code === 200 && /permission|publish/i.test(String(fb?.message || ""))
            ? "Token missing publish permission. Use a Page access token with pages_manage_posts and pages_read_engagement."
            : "Update FB_PAGE_TOKEN in Vercel (or your host) and redeploy if needed.",
    });
  }
}
