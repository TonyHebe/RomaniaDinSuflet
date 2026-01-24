/**
 * Publish cron runner.
 *
 * Calls the CRON_URL endpoint repeatedly in a single GitHub Actions run
 * (up to MAX_CALLS_PER_RUN) so we can process multiple queued items per hour.
 *
 * NOTE: This is intentionally a real file (not `node -e "..."`) to avoid
 * shell-quoting issues (backticks, ${}, etc.) and to allow top-level await.
 */
 
const max = Number.parseInt(process.env.MAX_CALLS_PER_RUN || "1", 10);
const url = process.env.CRON_URL;
 
if (!url) {
  console.error("Missing CRON_URL env var (set this secret in GitHub Actions).");
  process.exit(1);
}
 
if (!Number.isFinite(max) || max <= 0) {
  console.error(
    `Invalid MAX_CALLS_PER_RUN=${JSON.stringify(process.env.MAX_CALLS_PER_RUN)}`
  );
  process.exit(1);
}
 
let processed = 0;
let failures = 0;
let noPending = false;
 
for (let i = 0; i < max; i++) {
  let res;
  let text = "";
  let data = null;
 
  try {
    res = await fetch(url, {
      headers: { "user-agent": "RDS-PublishCron/1.0" },
    });
    text = await res.text();
 
    try {
      data = JSON.parse(text);
    } catch {
      // leave data null; we still log raw text below
    }
 
    console.log(`call ${i + 1}/${max}: status=${res.status}`);
    console.log(text);
 
    if (
      typeof data?.message === "string" &&
      /no pending/i.test(data.message)
    ) {
      noPending = true;
      break;
    }
 
    // If the API enforces a cooldown, stop the loop early.
    if (
      data?.cooldown === true ||
      (typeof data?.message === "string" && /cooldown|rate limit/i.test(data.message))
    ) {
      console.log("Cooldown detected; stopping early.");
      break;
    }

    if (data?.processed?.publishedSlug) processed += 1;
    if (!res.ok || data?.ok === false) failures += 1;
  } catch (err) {
    failures += 1;
    console.error(`call ${i + 1}/${max}: exception`);
    console.error(err);
  }
}
 
console.log(JSON.stringify({ processed, failures, noPending, max }, null, 2));
 
if (failures > 0) {
  process.exit(1);
}
