import { getPool } from "./db.js";

const DEFAULT_MAX_ATTEMPTS = 5;

function normalizeError(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return String(err?.message || err);
}

export async function enqueueSourceUrls(urls) {
  const pool = getPool();
  const clean = Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [])
        .map((u) => String(u || "").trim())
        .filter(Boolean),
    ),
  );

  const results = [];
  for (const url of clean) {
    // validate format
    // eslint-disable-next-line no-new
    new URL(url);
    const { rows } = await pool.query(
      `
        insert into source_queue (source_url, status, created_at, updated_at)
        values ($1, 'pending', now(), now())
        on conflict (source_url) do update
          set updated_at = now()
        returning id, source_url as "sourceUrl", status, attempt_count as "attemptCount"
      `,
      [url],
    );
    results.push(rows[0]);
  }
  return results;
}

export async function claimNextSource({ maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");

    // Try to avoid posting from the same site twice in a row.
    // This makes publishing look more diverse when multiple sources are queued.
    let lastPostedHost = null;
    try {
      const { rows: last } = await client.query(
        `
          select source_url as "sourceUrl"
          from source_queue
          where status = 'posted'
          order by processed_at desc nulls last, updated_at desc
          limit 1
        `,
      );
      const lastUrl = last?.[0]?.sourceUrl;
      if (lastUrl) lastPostedHost = new URL(String(lastUrl)).hostname.toLowerCase();
    } catch {
      // If parsing fails for any reason, fall back to oldest-first behavior.
      lastPostedHost = null;
    }

    const scanLimit = 200;
    const { rows: candidates } = await client.query(
      `
        select
          id,
          source_url as "sourceUrl",
          attempt_count as "attemptCount",
          published_slug as "publishedSlug",
          fb_post_id as "fbPostId",
          created_at as "createdAt"
        from source_queue
        where status = 'pending' and attempt_count < $1
        order by created_at asc
        for update skip locked
        limit $2
      `,
      [maxAttempts, scanLimit],
    );

    if (!candidates?.length) {
      await client.query("commit");
      return null;
    }

    // Look at recent posts to bias selection toward sources that haven't been posted recently.
    // This helps prevent "draining" one big backlog (e.g. cancan/g4media) before we ever reach newer sources.
    const recentPostedLimit = 2000;
    const { rows: recentPosted } = await client.query(
      `
        select
          source_url as "sourceUrl",
          processed_at as "processedAt"
        from source_queue
        where status = 'posted'
        order by processed_at desc nulls last, updated_at desc
        limit $1
      `,
      [recentPostedLimit],
    );

    const hostToLastPostedAt = new Map();
    for (const r of recentPosted || []) {
      if (!r?.sourceUrl) continue;
      if (!r?.processedAt) continue;
      let host = null;
      try {
        host = new URL(String(r.sourceUrl)).hostname.toLowerCase();
      } catch {
        host = null;
      }
      if (!host) continue;
      // First occurrence wins because results are ordered by processed_at desc.
      if (!hostToLastPostedAt.has(host)) hostToLastPostedAt.set(host, r.processedAt);
    }

    const enriched = candidates.map((c) => {
      let host = null;
      try {
        host = new URL(String(c.sourceUrl)).hostname.toLowerCase();
      } catch {
        host = null;
      }
      return { ...c, host };
    });

    // Group by host, tracking the oldest pending item per host.
    const hostToOldestCreatedAt = new Map();
    for (const c of enriched) {
      if (!c.host) continue;
      const prev = hostToOldestCreatedAt.get(c.host);
      if (!prev || c.createdAt < prev) hostToOldestCreatedAt.set(c.host, c.createdAt);
    }

    let chosenHost = null;
    if (hostToOldestCreatedAt.size > 0) {
      const hostMeta = Array.from(hostToOldestCreatedAt.entries()).map(([host, oldestPendingCreatedAt]) => {
        const lastPostedAt = hostToLastPostedAt.get(host) || null;
        return {
          host,
          oldestPendingCreatedAt,
          lastPostedAt,
          isSameAsLastPosted: lastPostedHost ? host === lastPostedHost : false,
        };
      });

      // Prefer a different host than the last post if we can.
      // Primary goal: distribute across sources (hosts never posted show up immediately).
      hostMeta.sort((a, b) => {
        // 1) Avoid repeating same host twice in a row when possible.
        if (a.isSameAsLastPosted !== b.isSameAsLastPosted) return a.isSameAsLastPosted ? 1 : -1;

        // 2) Prefer hosts that have never been posted (null lastPostedAt).
        const aNever = a.lastPostedAt === null;
        const bNever = b.lastPostedAt === null;
        if (aNever !== bNever) return aNever ? -1 : 1;

        // 3) Prefer the least recently posted host.
        if (a.lastPostedAt && b.lastPostedAt) {
          const at = new Date(a.lastPostedAt).getTime();
          const bt = new Date(b.lastPostedAt).getTime();
          if (at !== bt) return at < bt ? -1 : 1;
        }

        // 4) Tie-break: oldest pending item first.
        if (a.oldestPendingCreatedAt !== b.oldestPendingCreatedAt) {
          return a.oldestPendingCreatedAt < b.oldestPendingCreatedAt ? -1 : 1;
        }
        return 0;
      });

      chosenHost = hostMeta[0]?.host || null;
    }

    const pickFromHost = chosenHost
      ? enriched
          .filter((c) => c.host === chosenHost)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))[0]
      : null;

    const row = pickFromHost || enriched[0];

    const { rows: updated } = await client.query(
      `
        update source_queue
        set status = 'processing',
            claimed_at = now(),
            updated_at = now()
        where id = $1
        returning
          id,
          source_url as "sourceUrl",
          status,
          attempt_count as "attemptCount",
          claimed_at as "claimedAt",
          published_slug as "publishedSlug",
          fb_post_id as "fbPostId"
      `,
      [row.id],
    );

    await client.query("commit");
    return updated[0] ?? null;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function setSourcePublishedSlug(id, publishedSlug) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
      update source_queue
      set published_slug = $2,
          updated_at = now()
      where id = $1
      returning id, published_slug as "publishedSlug"
    `,
    [id, publishedSlug ? String(publishedSlug) : null],
  );
  return rows[0] ?? null;
}

export async function markSourcePosted(
  id,
  { publishedSlug = null, fbPostId = null, lastError = null } = {},
) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
      update source_queue
      set status = 'posted',
          processed_at = now(),
          updated_at = now(),
          last_error = $4,
          published_slug = $2,
          fb_post_id = $3
      where id = $1
      returning
        id,
        status,
        last_error as "lastError",
        published_slug as "publishedSlug",
        fb_post_id as "fbPostId"
    `,
    [id, publishedSlug, fbPostId, lastError ? String(lastError) : null],
  );
  return rows[0] ?? null;
}

export async function markSourceFailed(
  id,
  err,
  { maxAttempts = DEFAULT_MAX_ATTEMPTS } = {},
) {
  const pool = getPool();
  const message = normalizeError(err);
  const { rows } = await pool.query(
    `
      update source_queue
      set attempt_count = attempt_count + 1,
          last_error = $2,
          updated_at = now(),
          processed_at = case
            when (attempt_count + 1) >= $3 then now()
            else processed_at
          end,
          status = case
            when (attempt_count + 1) >= $3 then 'failed'
            else 'pending'
          end
      where id = $1
      returning id, status, attempt_count as "attemptCount", last_error as "lastError"
    `,
    [id, message, maxAttempts],
  );
  return rows[0] ?? null;
}

export async function markSourcePendingNoAttempt(id, err) {
  const pool = getPool();
  const message = normalizeError(err);
  const { rows } = await pool.query(
    `
      update source_queue
      set status = 'pending',
          claimed_at = null,
          last_error = $2,
          updated_at = now()
      where id = $1
      returning id, status, attempt_count as "attemptCount", last_error as "lastError"
    `,
    [id, message],
  );
  return rows[0] ?? null;
}

export async function markSourceBlocked(
  id,
  reason,
  { maxAttempts = DEFAULT_MAX_ATTEMPTS } = {},
) {
  const pool = getPool();
  const message = normalizeError(reason || "Blocked by rules");
  const max = Number.isFinite(Number(maxAttempts)) ? Number(maxAttempts) : DEFAULT_MAX_ATTEMPTS;
  const { rows } = await pool.query(
    `
      update source_queue
      set attempt_count = $3,
          last_error = $2,
          updated_at = now(),
          processed_at = now(),
          status = 'failed'
      where id = $1
      returning id, status, attempt_count as "attemptCount", last_error as "lastError"
    `,
    [id, message, max],
  );
  return rows[0] ?? null;
}

