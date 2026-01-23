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

## Vercel Cron (scaffold)

`vercel.json` schedules:

- `/api/cron/publish` every 6 hours

Optional protection:

- Set `CRON_SECRET` and call with:
  - header `x-cron-secret: <value>` or
  - query `?secret=<value>` or
  - header `Authorization: Bearer <value>`

## Environment variables

- `DATABASE_URL` (required)
- `CRON_SECRET` (optional, recommended)

Later (when we implement automation pipeline):

- `OPENAI_API_KEY`
- `APIFY_TOKEN`
- `FB_PAGE_TOKEN`
- `FB_PAGE_ID`
