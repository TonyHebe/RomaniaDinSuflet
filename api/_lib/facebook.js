function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function graphGet(path, params) {
  const base = "https://graph.facebook.com/v19.0";
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { method: "GET" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    throw new Error(
      `Facebook error: ${JSON.stringify(json?.error || json).slice(0, 400)}`,
    );
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
  const res = await fetch(url, { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    throw new Error(
      `Facebook error: ${JSON.stringify(json?.error || json).slice(0, 400)}`,
    );
  }
  return json;
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
      const lookedUp = await graphGet(`/${photoId}`, {
        fields: "page_story_id",
        access_token: token,
      });
      if (lookedUp?.page_story_id) postId = String(lookedUp.page_story_id);
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

export async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

