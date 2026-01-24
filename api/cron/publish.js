import { insertArticle } from "../_lib/articles.js";
import {
  claimNextSource,
  markSourceFailed,
  markSourcePosted,
} from "../_lib/sourceQueue.js";
import { scrapeSourceUrl } from "../_lib/scrape.js";
import { parseRewrite, rewriteWithAI } from "../_lib/openai.js";
import {
  commentOnFacebookPost,
  postPhotoToFacebook,
  sleep,
} from "../_lib/facebook.js";

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

    const job = await claimNextSource();
    if (!job) {
      res.status(200).json({ ok: true, message: "No pending sources." });
      return;
    }

    try {
      const scraped = await scrapeSourceUrl(job.sourceUrl);

      let finalTitle = scraped.title;
      let finalContent = scraped.content;
      const finalImageUrl = scraped.imageUrl || null;

      // Optional AI rewrite.
      if (process.env.OPENAI_API_KEY) {
        const rewritten = await rewriteWithAI({
          title: scraped.title,
          content: scraped.content,
        });
        const parsed = parseRewrite(rewritten);
        finalTitle = parsed.title;
        finalContent = parsed.content;
      }

      const publishedSlug = await insertArticle({
        title: finalTitle,
        content: finalContent,
        imageUrl: finalImageUrl,
        category: "stiri",
      });

      const siteUrl =
        process.env.SITE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
      const articleUrl = `${String(siteUrl).replace(/\/$/, "")}/article.html?slug=${encodeURIComponent(
        publishedSlug,
      )}`;

      // Optional Facebook posting.
      let fbPostId = null;
      if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN && finalImageUrl) {
        const caption = `${finalTitle}\n\nCitește: ${articleUrl}`;
        fbPostId = await postPhotoToFacebook({ imageUrl: finalImageUrl, caption });
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

