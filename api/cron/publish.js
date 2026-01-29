let _deps = null;
async function getDeps() {
  if (_deps) return _deps;
  const [articles, sourceQueue, scrape, blocklist, openai, facebook] = await Promise.all([
    import("../_lib/articles.js"),
    import("../_lib/sourceQueue.js"),
    import("../_lib/scrape.js"),
    import("../_lib/blocklist.js"),
    import("../_lib/openai.js"),
    import("../_lib/facebook.js"),
  ]);

  _deps = {
    // articles
    getArticleBySlug: articles.getArticleBySlug,
    getSecondsSinceLastPublish: articles.getSecondsSinceLastPublish,
    insertArticle: articles.insertArticle,
    // queue
    claimNextSource: sourceQueue.claimNextSource,
    markSourceFailed: sourceQueue.markSourceFailed,
    markSourceBlocked: sourceQueue.markSourceBlocked,
    markSourcePosted: sourceQueue.markSourcePosted,
    markSourcePendingNoAttempt: sourceQueue.markSourcePendingNoAttempt,
    setSourcePublishedSlug: sourceQueue.setSourcePublishedSlug,
    // scrape + blocklist
    scrapeSourceUrl: scrape.scrapeSourceUrl,
    isBlockedSourceUrl: blocklist.isBlockedSourceUrl,
    isBlockedTitle: blocklist.isBlockedTitle,
    // openai
    isBadTitle: openai.isBadTitle,
    parseRewrite: openai.parseRewrite,
    rewriteWithAI: openai.rewriteWithAI,
    titlesLookSame: openai.titlesLookSame,
    // facebook
    commentOnFacebookPost: facebook.commentOnFacebookPost,
    getFacebookPostInfo: facebook.getFacebookPostInfo,
    tryMakeFacebookPostPublic: facebook.tryMakeFacebookPostPublic,
    isFacebookPermissionConfigError: facebook.isFacebookPermissionConfigError,
    isFacebookTokenExpiredError: facebook.isFacebookTokenExpiredError,
    postPhotoToFacebook: facebook.postPhotoToFacebook,
    postLinkToFacebook: facebook.postLinkToFacebook,
    sleep: facebook.sleep,
  };

  return _deps;
}

// Vercel: allow enough time for scrape + (optional) OpenAI + (optional) Facebook.
// Without this, a slow upstream can cause `FUNCTION_INVOCATION_FAILED`.
export const config = {
  maxDuration: 60,
};

class ConfigError extends Error {
  constructor(message) {
    super(String(message || "Configuration error"));
    this.name = "ConfigError";
  }
}

function formatError(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  const msg = String(err?.message || err);
  // Preserve useful FB metadata when present.
  if (err?.name === "FacebookGraphError" && err?.fb) {
    try {
      return `${msg} ${JSON.stringify(err.fb)}`;
    } catch {
      return msg;
    }
  }
  return msg;
}

function isUpstreamRateLimitError(err) {
  const msg = String(formatError(err) || "").toLowerCase();
  // Our scraper throws: `Fetch failed (429) for https://...`
  // Keep this conservative so we don't misclassify unrelated errors.
  return msg.includes("fetch failed") && (msg.includes("(429)") || /\b429\b/.test(msg));
}

function deriveTitleFromText(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  const firstParagraph =
    t
      .split(/\n{2,}/g)
      .map((p) => p.trim())
      .filter(Boolean)[0] || "";
  const sentence =
    firstParagraph
      .split(/(?<=[.!?])\s+/g)
      .map((s) => s.trim())
      .filter(Boolean)[0] || firstParagraph;
  const cleaned = sentence.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
  if (!cleaned) return "";
  const maxLen = 90;
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

function normalizeOgImageUrl(raw, siteUrl) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^data:/i.test(s)) return "";
  try {
    return new URL(s, siteUrl).toString();
  } catch {
    return "";
  }
}

function parseEnvFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return Boolean(defaultValue);
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return Boolean(defaultValue);
}

const FB_POST_TITLE_SUFFIX = "...Vezi in comentarii 👇👇";

function buildFacebookPostTitle(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Avoid double-appending if we already have the CTA.
  if (/vezi in comentarii/i.test(t)) return t;
  // Keep the suffix formatting consistent: `Title...Vezi in comentarii 👇👇`
  return `${t.replace(/[\s.?!…]+$/g, "")}${FB_POST_TITLE_SUFFIX}`;
}

function shouldRetryFacebookCommentError(err) {
  const msg = String(err?.fb?.message || err?.message || "").toLowerCase();
  const code = Number(err?.fb?.code ?? err?.code ?? NaN);
  const status = Number(err?.status ?? NaN);

  // Common transient cases right after creating the post/photo:
  // - "Unsupported post request"
  // - "Object with ID ... does not exist"
  if (code === 100 && /unsupported post request|object with id|does not exist|unknown object/.test(msg))
    return true;

  // General transient buckets per FB docs / observed behavior.
  if ([1, 2, 4, 17].includes(code)) return true; // server error / throttling

  if (Number.isFinite(status) && status >= 500) return true;

  return false;
}

async function commentWithRetry({ targetId, message, maxAttempts = 6 } = {}) {
  const { commentOnFacebookPost, sleep, isFacebookTokenExpiredError, isFacebookPermissionConfigError } =
    await getDeps();
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await commentOnFacebookPost({ postId: targetId, message });
    } catch (err) {
      lastErr = err;
      // Do not retry systemic config/auth problems.
      if (isFacebookTokenExpiredError(err) || isFacebookPermissionConfigError(err)) throw err;
      if (!shouldRetryFacebookCommentError(err) || i === attempts - 1) throw err;
      const delay = Math.min(1500 * 2 ** i, 15000);
      await sleep(delay);
    }
  }
  // Should be unreachable, but keep a safe fallback.
  if (lastErr) throw lastErr;
  return null;
}

export default async function handler(req, res) {
  try {
    const {
      getArticleBySlug,
      getSecondsSinceLastPublish,
      insertArticle,
      claimNextSource,
      markSourceFailed,
      markSourceBlocked,
      markSourcePosted,
      markSourcePendingNoAttempt,
      setSourcePublishedSlug,
      scrapeSourceUrl,
      isBlockedSourceUrl,
      isBlockedTitle,
      isBadTitle,
      parseRewrite,
      rewriteWithAI,
      titlesLookSame,
      isFacebookPermissionConfigError,
      isFacebookTokenExpiredError,
      getFacebookPostInfo,
      tryMakeFacebookPostPublic,
      postPhotoToFacebook,
      postLinkToFacebook,
      sleep,
    } = await getDeps();

    // Process ONE pending source URL per call (safe + retryable).
    // Keeping this endpoint safe by requiring a secret.
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const provided =
        req.headers["x-cron-secret"] ||
        req.query?.secret ||
        req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
      if (!provided || String(provided) !== String(secret)) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }
    }

    // Optional publish cooldown (prevents batching even if the runner loops).
    // Example: MIN_PUBLISH_INTERVAL_SECONDS=600 allows max 1 publish/10min.
    // IMPORTANT: default to 10min to prevent duplicate publishes when the caller retries
    // (e.g. network timeout after the function already finished publishing).
    const minIntervalEnv = process.env.MIN_PUBLISH_INTERVAL_SECONDS;
    const minIntervalSeconds =
      minIntervalEnv === undefined || String(minIntervalEnv).trim() === ""
        ? 600
        : Number.parseInt(String(minIntervalEnv), 10);
    if (Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0) {
      const secondsSince = await getSecondsSinceLastPublish({ category: "stiri" });
      if (secondsSince !== null && secondsSince < minIntervalSeconds) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(minIntervalSeconds - secondsSince),
        );
        res.status(200).json({
          ok: true,
          cooldown: true,
          message: `Cooldown active. Try again in ~${retryAfterSeconds}s.`,
          retryAfterSeconds,
        });
        return;
      }
    }

    const job = await claimNextSource();
    if (!job) {
      res.status(200).json({ ok: true, message: "No pending sources." });
      return;
    }

    try {
      const siteUrlRaw =
        process.env.SITE_URL ||
        `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
      const siteUrl = String(siteUrlRaw).replace(/\/$/, "");

      const blockedHost = isBlockedSourceUrl(job.sourceUrl);
      if (blockedHost.blocked) {
        const marked = await markSourceBlocked(job.id, blockedHost.reason);
        res.status(200).json({
          ok: true,
          blocked: true,
          reason: blockedHost.reason,
          job: { id: job.id, sourceUrl: job.sourceUrl },
          marked,
        });
        return;
      }

      let publishedSlug = job.publishedSlug || null;
      let finalTitle = "";
      let finalContent = "";
      let finalImageUrl = null;

      // Retry-safe behavior:
      // If we already created the site article in a previous attempt, reuse it
      // (prevents duplicates when Facebook posting temporarily fails).
      if (publishedSlug) {
        const existing = await getArticleBySlug(publishedSlug);
        if (existing) {
          finalTitle = existing.title;
          finalContent = existing.content;
          finalImageUrl = existing.imageUrl || null;
        } else {
          publishedSlug = null;
        }
      }

      if (!publishedSlug) {
        const scraped = await scrapeSourceUrl(job.sourceUrl);

        const blockedScrapedTitle = isBlockedTitle(scraped.title);
        if (blockedScrapedTitle.blocked) {
          const marked = await markSourceBlocked(job.id, blockedScrapedTitle.reason);
          res.status(200).json({
            ok: true,
            blocked: true,
            reason: blockedScrapedTitle.reason,
            job: { id: job.id, sourceUrl: job.sourceUrl },
            marked,
          });
          return;
        }

        finalTitle = scraped.title;
        finalContent = scraped.content;
        finalImageUrl = scraped.imageUrl || null;

        const ai = {
          enabled: Boolean(process.env.OPENAI_API_KEY),
          required:
            String(process.env.OPENAI_REQUIRED || "")
              .trim()
              .toLowerCase() === "true" || String(process.env.OPENAI_REQUIRED || "").trim() === "1",
          ok: null,
          used: false,
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          error: null,
        };

        // Optional AI rewrite (best-effort unless OPENAI_REQUIRED=true).
        if (ai.enabled) {
          try {
            const rewritten1 = await rewriteWithAI({
              title: scraped.title,
              content: scraped.content,
            });
            let parsed = parseRewrite(rewritten1);
            finalTitle = parsed.title;
            finalContent = parsed.content;
            ai.used = true;

            // Hard guardrails: no placeholder titles and not identical to source title.
            if (isBadTitle(finalTitle) || titlesLookSame(finalTitle, scraped.title)) {
              try {
                const rewritten2 = await rewriteWithAI({
                  title: scraped.title,
                  content: scraped.content,
                  previousBadTitle: finalTitle,
                });
                parsed = parseRewrite(rewritten2);
                finalTitle = parsed.title;
                finalContent = parsed.content;
              } catch {
                // ignore; we'll fall back below
              }
            }

            if (isBadTitle(finalTitle) || titlesLookSame(finalTitle, scraped.title)) {
              // Last-resort: generate a headline from rewritten content (still rephrased).
              const derived = deriveTitleFromText(finalContent);
              if (derived && !titlesLookSame(derived, scraped.title)) finalTitle = derived;
            }

            // If we still failed guardrails, treat it as an AI failure (so we can fall back).
            if (isBadTitle(finalTitle) || titlesLookSame(finalTitle, scraped.title)) {
              throw new Error("OpenAI rewrite produced an invalid or unchanged title");
            }

            ai.ok = true;
          } catch (err) {
            ai.ok = false;
            ai.error = formatError(err);
            // Reset to scraped content if AI failed.
            finalTitle = scraped.title;
            finalContent = scraped.content;
            if (ai.required) throw err;
          }
        }

        const blockedFinalTitle = isBlockedTitle(finalTitle);
        if (blockedFinalTitle.blocked) {
          const marked = await markSourceBlocked(job.id, blockedFinalTitle.reason);
          res.status(200).json({
            ok: true,
            blocked: true,
            reason: blockedFinalTitle.reason,
            job: { id: job.id, sourceUrl: job.sourceUrl },
            marked,
          });
          return;
        }

        publishedSlug = await insertArticle({
          title: finalTitle,
          content: finalContent,
          imageUrl: finalImageUrl,
          category: "stiri",
        });

        // Persist the slug immediately so FB retries don't re-insert the article.
        await setSourcePublishedSlug(job.id, publishedSlug);

        // Expose AI debug info (if any) to the caller.
        // This is safe because it contains no secrets, only status/error text.
        // eslint-disable-next-line no-param-reassign
        job._ai = ai;
      }

      const articleUrl = `${siteUrl}/article.html?slug=${encodeURIComponent(
        publishedSlug,
      )}`;
      // A crawler-friendly share URL with server-rendered OG tags (Facebook/Twitter previews).
      const shareUrl = `${siteUrl}/s/${encodeURIComponent(publishedSlug)}`;

      // Optional Facebook posting.
      let fbPostId = null;
      let fbPhotoId = null;
      let fbEnabled = false;
      let fbMode = null;
      let fbRaw = null;
      let fbPostInfo = null;
      let fbVisibilityFix = null;
      let fbOk = false;
      let fbError = null;
      let fbCommentId = null;
      let fbCommentTargetId = null;
      if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
        fbEnabled = true;
        try {
          const fbPostTitle = buildFacebookPostTitle(finalTitle) || finalTitle;

          // Prefer posting a photo + comment (better reach, link in comments).
          // Fallback to link post if we don't have a usable image URL.
          const imageUrl = normalizeOgImageUrl(finalImageUrl, siteUrl);
          if (imageUrl) {
            fbMode = "photo";
            const resp = await postPhotoToFacebook({ imageUrl, caption: fbPostTitle });
            fbPostId = resp?.postId || null;
            fbPhotoId = resp?.photoId || null;
            fbRaw = resp?.raw || null;
          } else {
            fbMode = "link";
            // Publish a link post so it appears under "All posts".
            // The share URL renders OG tags (title/description/image) for rich previews.
            const resp = await postLinkToFacebook({ link: shareUrl, message: fbPostTitle });
            fbPostId = resp?.postId || null;
            fbRaw = resp?.raw || null;
          }

          // Fetch post info to debug “only admins can see it” cases.
          if (fbPostId) {
            try {
              fbPostInfo = await getFacebookPostInfo(fbPostId);
            } catch {
              fbPostInfo = null;
            }
          }

          // If FB created something that isn't actually public, try to flip it.
          if (fbPostId && fbPostInfo && (fbPostInfo.is_published === false || fbPostInfo.is_hidden === true)) {
            try {
              fbVisibilityFix = await tryMakeFacebookPostPublic(fbPostId);
              fbPostInfo = await getFacebookPostInfo(fbPostId);
            } catch {
              // ignore; we'll still return the debug fields we have
            }
          }

          // By default: add the share URL as the first comment.
          // You can disable with FB_COMMENT_LINK=0.
          const shouldComment = parseEnvFlag("FB_COMMENT_LINK", true);
          fbCommentTargetId = fbPostId || fbPhotoId || null;
          if (shouldComment && fbCommentTargetId) {
            await sleep(1500);
            fbCommentId = await commentWithRetry({
              targetId: fbCommentTargetId,
              message: shareUrl,
              maxAttempts: 6,
            });
          }
          fbOk = true;
        } catch (err) {
          fbError = formatError(err);

          // If FB is required, treat systemic auth/permission issues as a hard failure.
          const fbRequired =
            String(process.env.FB_REQUIRED || "")
              .trim()
              .toLowerCase() === "true" ||
            String(process.env.FB_REQUIRED || "").trim() === "1";
          if (fbRequired) {
            // Token expiry / auth issues are systemic (not per-article), so fail loudly and don't burn attempts.
            if (isFacebookTokenExpiredError(err)) {
              throw new ConfigError(
                "Facebook access token expired. Renew/replace FB_PAGE_TOKEN (a long-lived Page token) in your deployment environment, then re-run Publish Cron.",
              );
            }
            if (isFacebookPermissionConfigError(err)) {
              throw new ConfigError(
                "Facebook token/app is missing required publishing permissions for the Page. Generate a Page access token with `pages_manage_posts` + `pages_read_engagement` (and ensure the app has access), then re-run Publish Cron.",
              );
            }
            throw err;
          }
          // Best-effort by default: don't block website publishing on FB issues.
        }
      }

      await markSourcePosted(job.id, {
        publishedSlug,
        fbPostId,
        lastError: fbEnabled && !fbOk && fbError ? `Facebook: ${fbError}` : null,
      });

      res.status(200).json({
        ok: true,
        processed: {
          id: job.id,
          sourceUrl: job.sourceUrl,
          publishedSlug,
          articleUrl,
          shareUrl,
          ai: job._ai || { enabled: Boolean(process.env.OPENAI_API_KEY) },
          fbPostId,
          fbPhotoId,
          facebook: {
            enabled: fbEnabled,
            ok: fbEnabled ? fbOk : null,
            mode: fbMode,
            // Helpful to debug “posted but not visible” cases:
            // - photoId with no postId can indicate an upload without a feed story.
            ids: { postId: fbPostId, photoId: fbPhotoId },
            post: fbPostInfo,
            visibilityFix: fbVisibilityFix,
            comment: { id: fbCommentId, targetId: fbCommentTargetId },
            raw: fbRaw,
            error: fbError,
          },
        },
      });
    } catch (err) {
      const isConfig = err?.name === "ConfigError";
      // If an upstream site throttles us (429), don't burn attempts and back off.
      // This prevents a good source from becoming permanently "failed" just because
      // the origin is temporarily rate limiting our IP/user-agent.
      if (!isConfig && isUpstreamRateLimitError(err)) {
        const cooldownEnv = process.env.SOURCE_429_COOLDOWN_SECONDS;
        const cooldownSeconds =
          cooldownEnv === undefined || String(cooldownEnv).trim() === ""
            ? 1800
            : Number.parseInt(String(cooldownEnv), 10);

        const retryAfterSeconds =
          Number.isFinite(cooldownSeconds) && cooldownSeconds > 0 ? cooldownSeconds : 1800;

        const marked = await markSourcePendingNoAttempt(job.id, formatError(err));
        res.status(200).json({
          ok: true,
          cooldown: true,
          message: `Upstream rate limited this fetch (429). Cooling down for ~${retryAfterSeconds}s.`,
          retryAfterSeconds,
          job: { id: job.id, sourceUrl: job.sourceUrl },
          marked,
        });
        return;
      }

      const marked = isConfig
        ? await markSourcePendingNoAttempt(job.id, formatError(err))
        : await markSourceFailed(job.id, formatError(err));

      // Config errors should fail the cron run (so Actions turns red) and not consume attempts.
      // Per-item errors should be 200 so the runner can continue.
      res.status(isConfig ? 500 : 200).json({
        ok: false,
        hardFailure: isConfig,
        error: formatError(err),
        job: { id: job.id, sourceUrl: job.sourceUrl },
        marked,
      });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: formatError(err) });
  }
}

