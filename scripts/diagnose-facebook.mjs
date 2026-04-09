/**
 * Call the publish endpoint once and print exactly what happened with Facebook.
 * This shows the real error if FB posting is failing.
 *
 * Usage (PowerShell):
 *   $env:CRON_URL="https://www.romaniadinsuflet.ro"
 *   $env:CRON_SECRET="your_cron_secret"
 *   node scripts/diagnose-facebook.mjs
 *
 * Or (cmd):
 *   set CRON_URL=https://www.romaniadinsuflet.ro
 *   set CRON_SECRET=your_cron_secret
 *   node scripts/diagnose-facebook.mjs
 */
const baseUrl = (process.env.CRON_URL || "").trim().replace(/\/$/, "");
const secret = (process.env.CRON_SECRET || process.env.ADMIN_SECRET || "").trim();

if (!baseUrl) {
  console.error("Set CRON_URL (e.g. https://www.romaniadinsuflet.ro)");
  process.exit(1);
}

const url = baseUrl.startsWith("http") ? baseUrl : "https://" + baseUrl;
const publishUrl = url + "/api/cron/publish";

const headers = { "user-agent": "RDS-Diagnose/1.0" };
if (secret) headers["x-cron-secret"] = secret;

console.log("Calling publish endpoint (one run)...\n");
const res = await fetch(publishUrl + "?secret=" + encodeURIComponent(secret), { headers });
const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.log("Response (raw):", text);
  process.exit(1);
}

// Show Facebook part clearly
const fb = data?.processed?.facebook;
if (fb) {
  console.log("--- FACEBOOK RESULT ---");
  console.log("enabled:", fb.enabled);
  console.log("ok:", fb.ok);
  console.log("mode:", fb.mode);
  if (fb.error) console.log("error:", fb.error);
  if (fb.ids) console.log("ids:", fb.ids);
  if (fb.post) console.log("post:", JSON.stringify(fb.post, null, 2));
  console.log("------------------------\n");
  if (fb.ok) {
    console.log("Facebook posting succeeded for this run.");
  } else {
    console.log("Facebook failed. Fix the 'error' above, then redeploy.");
  }
} else if (data?.message && /no pending/i.test(data.message)) {
  console.log("Queue is empty (no article was processed). So we did not try Facebook.");
  console.log("To see a Facebook result: enqueue a source URL, then run this script again.");
} else if (data?.cooldown) {
  console.log("Cooldown:", data.message);
} else if (data?.ok === false && data?.error) {
  console.log("Cron error:", data.error);
} else {
  console.log("Full response:", JSON.stringify(data, null, 2));
}

process.exit(res.ok ? 0 : 1);
