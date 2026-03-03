/**
 * Call the deployed /api/admin/facebook-check endpoint to verify FB_PAGE_ID + FB_PAGE_TOKEN.
 * Uses the same URL and secret as the publish cron (from env).
 *
 * Usage:
 *   Set CRON_URL and CRON_SECRET (or ADMIN_SECRET), then:
 *   node scripts/facebook-check.mjs
 *
 * Or one-shot:
 *   CRON_URL=https://www.romaniadinsuflet.ro CRON_SECRET=your_secret node scripts/facebook-check.mjs
 */
const baseUrl = process.env.CRON_URL || process.env.VERCEL_URL;
const secret = process.env.CRON_SECRET || process.env.ADMIN_SECRET || "";

if (!baseUrl) {
  console.error("Set CRON_URL or VERCEL_URL (e.g. https://www.romaniadinsuflet.ro)");
  process.exit(1);
}

const url =
  (baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`).replace(/\/$/, "") +
  "/api/admin/facebook-check";

const headers = { "user-agent": "RDS-FacebookCheck/1.0" };
if (secret) headers["x-cron-secret"] = secret;

console.log("Calling", url, secret ? "(with secret)" : "(no secret - will get 401)");
const res = await fetch(url, { headers });
const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.log("Response (not JSON):", text);
  process.exit(res.ok ? 0 : 1);
}

console.log(JSON.stringify(data, null, 2));
if (data.ok) {
  console.log("\nFacebook config OK. Page:", data.page?.name || data.page?.id);
} else if (data.error || data.facebook) {
  console.log("\nHint:", data.hint || "Check FB_PAGE_ID and FB_PAGE_TOKEN in Vercel.");
  process.exit(1);
}
process.exit(res.ok ? 0 : 1);
