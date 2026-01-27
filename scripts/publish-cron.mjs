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
const cronSecret = process.env.CRON_SECRET || "";
const bearer = process.env.CRON_AUTH_BEARER || "";

const callTimeoutMs = Number.parseInt(process.env.CRON_CALL_TIMEOUT_MS || "20000", 10);
const perCallRetries = Number.parseInt(process.env.CRON_PER_CALL_RETRIES || "4", 10);
const baseDelayMs = Number.parseInt(process.env.CRON_RETRY_BASE_DELAY_MS || "800", 10);
 
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
let hardFailures = 0;
let noPending = false;
 
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function isVercelInvocationFailedBody(text) {
  const t = String(text || "");
  return (
    /FUNCTION_INVOCATION_FAILED/i.test(t) ||
    /A server error has occurred/i.test(t) ||
    /This Serverless Function has crashed/i.test(t)
  );
}

async function fetchWithTimeout(input, init, timeoutMs) {
  const ms = Number(timeoutMs);
  const timeout = Number.isFinite(ms) && ms > 0 ? ms : 20000;
  const controller = new AbortController();
  const t = setTimeout(
    () => controller.abort(new Error(`Cron call timeout after ${timeout}ms`)),
    timeout,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callCronOnce({ attempt, maxAttempts } = {}) {
  const headers = {
    "user-agent": "RDS-PublishCron/1.0",
  };
  if (cronSecret) headers["x-cron-secret"] = cronSecret;
  if (bearer) headers.authorization = `Bearer ${bearer}`;

  const res = await fetchWithTimeout(url, { headers }, callTimeoutMs);
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // leave data null
  }

  console.log(`call: status=${res.status} attempt=${attempt}/${maxAttempts}`);
  console.log(text);

  return { res, text, data };
}

for (let i = 0; i < max; i++) {
  let res = null;
  let text = "";
  let data = null;
  let lastErr = null;

  const maxAttempts = Math.max(1, Number.isFinite(perCallRetries) ? perCallRetries + 1 : 5);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      ({ res, text, data } = await callCronOnce({ attempt, maxAttempts }));
      lastErr = null;

      // Determine if we should retry.
      const retryable =
        !res.ok && (isRetryableStatus(res.status) || isVercelInvocationFailedBody(text));

      if (!res.ok && retryable && attempt < maxAttempts) {
        const ra = Number.parseInt(res.headers?.get?.("retry-after") || "", 10);
        const retryAfterMs = Number.isFinite(ra) ? ra * 1000 : null;
        const base = Math.max(250, baseDelayMs) * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * 250);
        const delay = Math.min(8000, retryAfterMs ?? base + jitter);
        console.log(`retrying after ${delay}ms (status=${res.status})`);
        await sleep(delay);
        continue;
      }

      break;
    } catch (err) {
      lastErr = err;
      console.error(`call: exception attempt=${attempt}/${maxAttempts}`);
      console.error(err);

      if (attempt >= maxAttempts) break;
      const base = Math.max(250, baseDelayMs) * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * 250);
      const delay = Math.min(8000, base + jitter);
      console.log(`retrying after ${delay}ms (exception)`);
      await sleep(delay);
    }
  }

  console.log(`call ${i + 1}/${max}: finalStatus=${res?.status ?? "n/a"}`);

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

  // "hard" failures = the cron endpoint itself is unhealthy (non-2xx) OR we never got a response.
  if (!res?.ok) {
    failures += 1;
    hardFailures += 1;
    if (lastErr) console.error(`final exception: ${String(lastErr?.message || lastErr)}`);
  } else if (data?.ok === false) {
    // "soft" failures = a single source item failed (already tracked + retried server-side)
    failures += 1;
  }
}
 
console.log(
  JSON.stringify({ processed, failures, hardFailures, noPending, max }, null, 2),
);
 
// Only fail the workflow when the cron endpoint itself is unhealthy.
if (hardFailures > 0) {
  process.exit(1);
}
