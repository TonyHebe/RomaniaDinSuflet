function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export class FacebookGraphError extends Error {
  constructor(fbError, { status } = {}) {
    const safe = fbError && typeof fbError === "object" ? fbError : {};
    const msg =
      safe?.message ||
      (typeof fbError === "string" ? fbError : "Facebook Graph API error");
    super(String(msg));
    this.name = "FacebookGraphError";
    this.status = status ?? null;
    this.fb = {
      message: safe?.message,
      type: safe?.type,
      code: safe?.code,
      errorSubcode: safe?.error_subcode,
      fbtraceId: safe?.fbtrace_id,
    };
    this.raw = fbError;
  }
}

function extractFacebookErrorObject(err) {
  if (!err) return null;
  if (typeof err === "object") {
    if (err?.fb && typeof err.fb === "object") return err.fb;
    if (err?.fbError && typeof err.fbError === "object") return err.fbError;
    if (err?.raw?.error && typeof err.raw.error === "object") return err.raw.error;
    if (err?.raw && typeof err.raw === "object") {
      // FacebookGraphError stores the raw error object in `raw`.
      if ("code" in err.raw || "error_subcode" in err.raw || "message" in err.raw) return err.raw;
    }
  }

  const msg =
    typeof err?.message === "string"
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  if (!msg) return null;

  // Some deployments stringify the FB error into the message, e.g.:
  // "Facebook error: {\"message\":\"...\",\"code\":190,\"error_subcode\":463}"
  const start = msg.indexOf("{");
  const end = msg.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(msg.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function isFacebookTokenExpiredError(err) {
  if (!err) return false;
  const fb = extractFacebookErrorObject(err);
  const code = fb?.code;
  const sub = fb?.errorSubcode ?? fb?.error_subcode;
  // 190 = OAuthException; 463/460 commonly indicate expired tokens.
  return Number(code) === 190 && (Number(sub) === 463 || Number(sub) === 460);
}

export function isFacebookPermissionConfigError(err) {
  const fb = extractFacebookErrorObject(err);
  const msg =
    String(
      fb?.message ||
        (typeof err?.message === "string" ? err.message : typeof err === "string" ? err : ""),
    )
      .toLowerCase()
      .trim();
  // Commonly shows up as code 200 with "publish_actions ... deprecated" or missing page publishing perms.
  const code = fb?.code ?? null;
  if (Number(code) === 200 && /publish_actions|publish_pages|permission\(s\)/i.test(msg)) return true;
  if (/publish_actions.*deprecated/i.test(msg)) return true;
  return false;
}

async function graphGet(path, params) {
  const base = "https://graph.facebook.com/v19.0";
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  const timeoutMs = Number.parseInt(process.env.FB_TIMEOUT_MS || "15000", 10);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error("Facebook timeout")), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: "GET", signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    if (json?.error) throw new FacebookGraphError(json.error, { status: res.status });
    throw new FacebookGraphError(json, { status: res.status });
  }
  return json;
}

async function graphPost(path, params) {
  const base = "https://graph.facebook.com/v19.0";
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  const timeoutMs = Number.parseInt(process.env.FB_TIMEOUT_MS || "15000", 10);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error("Facebook timeout")), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: "POST", signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    if (json?.error) throw new FacebookGraphError(json.error, { status: res.status });
    throw new FacebookGraphError(json, { status: res.status });
  }
  return json;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function getFacebookPhotoPageStoryId(photoId, { maxAttempts = 6 } = {}) {
  const token = mustGetEnv("FB_PAGE_TOKEN");
  if (!photoId) throw new Error("Missing photoId");

  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const lookedUp = await graphGet(`/${photoId}`, {
        // page_story_id is the Page's feed story for the uploaded photo (the thing users see as "the post").
        fields: "page_story_id",
        access_token: token,
      });
      if (lookedUp?.page_story_id) return String(lookedUp.page_story_id);
    } catch (err) {
      lastErr = err;
    }

    // Exponential-ish backoff, capped.
    const delay = Math.min(1500 * 2 ** i, 15000);
    await sleep(delay);
  }

  if (lastErr) throw lastErr;
  return null;
}

export async function postPhotoToFacebook({ imageUrl, caption } = {}) {
  const pageId = mustGetEnv("FB_PAGE_ID");
  const token = mustGetEnv("FB_PAGE_TOKEN");
  if (!imageUrl) throw new Error("Missing imageUrl");

  // Use the "photos" edge with a URL (FB fetches the image).
  const resp = await graphPost(`/${pageId}/photos`, {
    url: imageUrl,
    caption: caption || "",
    // Make the intent explicit: publish a visible Page post (feed story).
    // Some configurations can otherwise result in an unpublished upload or no-story upload.
    published: true,
    no_story: false,
    access_token: token,
  });

  // Typically returns: { id: <photo_id>, post_id: <page_post_id> }
  // If post_id is missing, keep id as fallback (commenting on the photo still works),
  // and try a best-effort lookup for page_story_id.
  let postId = resp?.post_id || null;
  const photoId = resp?.id || null;

  if (!postId && photoId) {
    try {
      // The story can take a few seconds to materialize. Poll briefly.
      postId = await getFacebookPhotoPageStoryId(photoId, { maxAttempts: 6 });
    } catch {
      // ignore lookup failures; we'll return only the photo id
    }
  }

  return { postId, photoId, raw: resp };
}

export async function postLinkToFacebook({ link, message } = {}) {
  const pageId = mustGetEnv("FB_PAGE_ID");
  const token = mustGetEnv("FB_PAGE_TOKEN");
  if (!link) throw new Error("Missing link");

  const resp = await graphPost(`/${pageId}/feed`, {
    link: String(link),
    message: message ? String(message) : "",
    published: true,
    access_token: token,
  });
  return { postId: resp?.id || null, raw: resp };
}

export async function commentOnFacebookPost({ postId, message } = {}) {
  const token = mustGetEnv("FB_PAGE_TOKEN");
  if (!postId) throw new Error("Missing postId");
  if (!message) throw new Error("Missing message");

  const resp = await graphPost(`/${postId}/comments`, {
    message,
    access_token: token,
  });
  return resp?.id || null;
}

