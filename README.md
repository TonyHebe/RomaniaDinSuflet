# RomaniaDinSuflet

Static website hosted on Vercel, with dynamic “Știri” articles loaded from Vercel Functions + Postgres.

## What changed

- Home page now includes a real `#stiri` section that loads latest articles from `GET /api/articles?category=stiri`.
- Added `article.html?slug=...` which loads full article details from `GET /api/articles/:slug`.
- Added a Cron scaffold endpoint at `GET /api/cron/publish` (scheduled via `vercel.json`) — currently **scaffold only**.

## Database (required)

Set `DATABASE_URL` to a Postgres connection string (Vercel Postgres / Neon / Supabase Postgres).

Run this SQL once:

```sql
create table if not exists articles (
  id bigserial primary key,
  slug text unique not null,
  title text not null,
  content text not null,
  excerpt text,
  image_url text,
  category text not null default 'stiri',
  status text not null default 'published',
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists articles_category_published_at_idx
  on articles (category, published_at desc);
```

### Source queue (for automation)

To make the publish workflow **retry-safe** and prevent duplicates, create a `source_queue` table.

Run this SQL once:

```sql
create table if not exists source_queue (
  id bigserial primary key,
  source_url text unique not null,
  status text not null default 'pending', -- pending | processing | posted | failed
  attempt_count int not null default 0,
  last_error text,
  claimed_at timestamptz,
  processed_at timestamptz,
  published_slug text,
  fb_post_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists source_queue_status_created_at_idx
  on source_queue (status, created_at asc);
```

Example insert:

```sql
insert into articles (slug, title, content, excerpt, image_url, category)
values (
  'exemplu-articol',
  'Titlu exemplu',
  'Paragraf 1.\n\nParagraf 2.',
  'Rezumat scurt…',
  'https://example.com/image.jpg',
  'stiri'
);
```

## API

- `GET /api/articles?category=stiri&limit=9`
- `GET /api/articles/:slug`
- `POST /api/sources` (enqueue source URLs)

## Vercel Cron (scaffold)

This repo includes a cron endpoint at `GET /api/cron/publish`.

**Important**: Vercel Cron Jobs require a paid plan. If your Vercel project is on **Free**, keep `vercel.json` cron config disabled and trigger the endpoint from an external scheduler instead (e.g. GitHub Actions cron, cron-job.org) using `CRON_SECRET`.

Optional protection:

- Set `CRON_SECRET` and call with:
  - header `x-cron-secret: <value>` or
  - query `?secret=<value>` or
  - header `Authorization: Bearer <value>`

## Environment variables

- `DATABASE_URL` (required)
- `CRON_SECRET` (optional, recommended)
- `ADMIN_SECRET` (optional, recommended; protects `POST /api/sources`)
- `SITE_URL` (optional; e.g. `https://www.romaniadinsuflet.ro` for building canonical links)
- `MIN_PUBLISH_INTERVAL_SECONDS` (optional; publish cooldown to prevent bursts when the scheduler loops)

## Google AdSense (ads)

This repo includes an AdSense integration that is **disabled by default** until you fill in your real IDs.

- **Step 1 (AdSense setup)**: in Google AdSense, add your site, complete ownership verification, and wait for approval.
- **Step 2 (create ad units)**: create one or more “Display” ad units (responsive) and copy:
  - your **publisher id**: `ca-pub-xxxxxxxxxxxxxxxx`
  - each ad unit’s **slot id**: a numeric id (e.g. `1234567890`)

- **Step 3 (enable in HTML)**:
  - Update the meta tag in `index.html` and `article.html`:
    - `meta[name="adsense-client"]` → your real `ca-pub-...`
  - Update each ad placeholder:
    - `data-ad-slot="REPLACE_ME"` → your real numeric slot id(s)

Ad placeholders live in:

- `index.html` (`data-ad="home_top"`)
- `article.html` (`data-ad="article_top"`)

- **Step 4 (`ads.txt`)**: update `ads.txt` to match your publisher id:
  - `google.com, pub-REPLACE_ME, DIRECT, f08c47fec0942fa0` → `google.com, pub-xxxxxxxxxxxxxxxx, DIRECT, f08c47fec0942fa0`

Implementation details:

- `ads.js` loads the AdSense script only when it detects a real `ca-pub-...` and real numeric slot id(s).
- If AdSense is blocked (ad blockers, CSP, etc), it fails safely and the site remains usable.

Later (when we implement automation pipeline):

- `OPENAI_API_KEY`
- `APIFY_TOKEN`
- `FB_PAGE_TOKEN`
- `FB_PAGE_ID`

## Workflow (manual feed → publish job)

1) Create the `source_queue` table (see SQL above).
2) In Vercel → Project → Settings → Environment Variables set:
   - `DATABASE_URL`
   - `CRON_SECRET` (recommended)
   - `ADMIN_SECRET` (recommended)
   - optional: `OPENAI_API_KEY`, `FB_PAGE_ID`, `FB_PAGE_TOKEN`, `SITE_URL`
3) Enqueue a source URL:

```bash
curl -X POST "https://YOUR_DOMAIN/api/sources" \
  -H "content-type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"urls":["https://example.com/some-article"]}'
```

4) Run the publish worker once (processes 1 queued URL per call):

```bash
curl "https://YOUR_DOMAIN/api/cron/publish?secret=$CRON_SECRET"
```

If Vercel Cron is unavailable (Free plan), schedule step 4 from an external scheduler
(GitHub Actions cron, cron-job.org, UptimeRobot, etc).

## Fully automatic mode (discovery + publish)

This repo includes two GitHub Actions workflows:

- `.github/workflows/publish-cron.yml`: calls `GET /api/cron/publish` on a schedule (consumes the queue)
- `.github/workflows/discover-cron.yml`: fetches RSS feeds and calls `POST /api/sources` (fills the queue)

### Why did multiple posts publish “all of a sudden”?

If your scheduler calls `GET /api/cron/publish` multiple times in a single run (e.g. `MAX_CALLS_PER_RUN > 1`),
it will publish multiple queued items back-to-back. To prevent bursts, set:

- `MAX_CALLS_PER_RUN=1` in the scheduler, and/or
- `MIN_PUBLISH_INTERVAL_SECONDS` in the API to enforce spacing between publishes.

To enable discovery, add these GitHub repo secrets:

- `SOURCES_API_URL` = `https://YOUR_DOMAIN/api/sources`
- `ADMIN_SECRET` = the same value you set in Vercel
