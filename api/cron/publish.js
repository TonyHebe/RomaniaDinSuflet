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
  postLinkToFacebook,
  postPhotoToFacebook,
  sleep,
} from "../_lib/facebook.js";

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
      if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
        const caption = `${finalTitle}\n\nVezi în comentarii.`;
        if (finalImageUrl) {
          fbPostId = await postPhotoToFacebook({ imageUrl: finalImageUrl, caption });
        } else {
          fbPostId = await postLinkToFacebook({ link: articleUrl, message: caption });
        }
        if (fbPostId) {
          await sleep(2000);
          await commentOnFacebookPost({ postId: fbPostId, message: articleUrl });
        }
      }

      await markSourcePosted(job.id, { publishedSlug, fbPostId });

      res.status(200).json({
        ok: true,
        processed: {
          id: job.id,
          sourceUrl: job.sourceUrl,
          publishedSlug,
          articleUrl,
          fbPostId,
        },
      });
    } catch (err) {
      const marked = await markSourceFailed(job.id, err);
      // Don't fail the cron run for a single bad URL; mark it and move on.
      res.status(200).json({
        ok: false,
        error: String(err?.message || err),
        job: { id: job.id, sourceUrl: job.sourceUrl },
        marked,
      });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

