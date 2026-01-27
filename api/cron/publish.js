import {
  getArticleBySlug,
  getSecondsSinceLastPublish,
  insertArticle,
} from "../_lib/articles.js";
import {
  claimNextSource,
  markSourceFailed,
  markSourceBlocked,
  markSourcePosted,
  markSourcePendingNoAttempt,
  setSourcePublishedSlug,
} from "../_lib/sourceQueue.js";
import { scrapeSourceUrl } from "../_lib/scrape.js";
import { isBlockedSourceUrl, isBlockedTitle } from "../_lib/blocklist.js";
import {
  isBadTitle,
  parseRewrite,
  rewriteWithAI,
  titlesLookSame,
} from "../_lib/openai.js";
import {
  commentOnFacebookPost,
  getFacebookPhotoPageStoryId,
  isFacebookPermissionConfigError,
  isFacebookTokenExpiredError,
  postLinkToFacebook,
  postPhotoToFacebook,
  sleep,
} from "../_lib/facebook.js";

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
    // Example: MIN_PUBLISH_INTERVAL_SECONDS=3600 allows max 1 publish/hour.
    const minIntervalSeconds = Number.parseInt(
      process.env.MIN_PUBLISH_INTERVAL_SECONDS || "0",
      10,
    );
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

        // Optional AI rewrite.
        if (process.env.OPENAI_API_KEY) {
          const rewritten1 = await rewriteWithAI({
            title: scraped.title,
            content: scraped.content,
          });
          let parsed = parseRewrite(rewritten1);
          finalTitle = parsed.title;
          finalContent = parsed.content;

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
            if (derived && !titlesLookSame(derived, scraped.title))
              finalTitle = derived;
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
      }

      const articleUrl = `${siteUrl}/article.html?slug=${encodeURIComponent(
        publishedSlug,
      )}`;

      // Optional Facebook posting.
      let fbPostId = null;
      let fbPhotoId = null;
      let fbEnabled = false;
      let fbMode = null;
      let fbRaw = null;
      let fbOk = false;
      let fbError = null;
      let fbCommentId = null;
      let fbCommentTargetId = null;
      if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
        fbEnabled = true;
        try {
          const caption = `${finalTitle}\n\nVezi în comentarii.`;
          if (finalImageUrl) {
            fbMode = "photo";
            const resp = await postPhotoToFacebook({
              imageUrl: finalImageUrl,
              caption,
            });
            fbPostId = resp?.postId || null;
            fbPhotoId = resp?.photoId || null;
            fbRaw = resp?.raw || null;
          } else {
            fbMode = "link";
            const resp = await postLinkToFacebook({ link: articleUrl, message: caption });
            fbPostId = resp?.postId || null;
            fbRaw = resp?.raw || null;
          }

          // Comment the article URL on the FEED STORY (post) id when possible.
          // Commenting on a raw photo object id may not appear as a visible “post comment” in the UI.
          if (!fbPostId && fbPhotoId) {
            try {
              fbPostId = await getFacebookPhotoPageStoryId(fbPhotoId, { maxAttempts: 6 });
            } catch {
              // ignore; we'll fall back below
            }
          }

          fbCommentTargetId = fbPostId || fbPhotoId || null;
          if (fbCommentTargetId) {
            // Give FB a moment to index the story.
            await sleep(1500);
            fbCommentId = await commentWithRetry({
              targetId: fbCommentTargetId,
              message: articleUrl,
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
          fbPostId,
          fbPhotoId,
          facebook: {
            enabled: fbEnabled,
            ok: fbEnabled ? fbOk : null,
            mode: fbMode,
            // Helpful to debug “posted but not visible” cases:
            // - photoId with no postId can indicate an upload without a feed story.
            ids: { postId: fbPostId, photoId: fbPhotoId },
            comment: { id: fbCommentId, targetId: fbCommentTargetId },
            raw: fbRaw,
            error: fbError,
          },
        },
      });
    } catch (err) {
      const isConfig = err?.name === "ConfigError";
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

