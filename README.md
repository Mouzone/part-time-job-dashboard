# Part-Time Job Dashboard

A simple dashboard tracking part-time job leads within a 20-30 minute
commute (foot / bus / subway) of 1601 Benson Ave, Brooklyn, NY 11214, that
can be applied to online.

- Filter by applied / not applied
- Sort by date found or industry
- "Applied" status is saved in your browser (localStorage) — no login, no
  database

## Weekly updates

`.github/workflows/weekly-job-search.yml` runs every Monday and calls
`scripts/find-jobs.mjs`, which queries seven job sources in parallel for
recent part-time openings near Bensonhurst, filters them to a 5-mile
radius, deduplicates, and merges any new ones into `data/jobs.json`. A
commit is pushed automatically when new leads are found, which triggers a
new Vercel deployment.

### Job sources

| Source | Type | Credentials needed | Notes |
| --- | --- | --- | --- |
| [Adzuna](https://developer.adzuna.com) | Jobs API | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | 3 pages × 50 results, lat/lng for haversine filtering |
| [Jooble](https://jooble.org/api) | Jobs API | `JOOBLE_API_KEY` | 500 lifetime requests, neighborhood string match |
| [CareerJet](https://www.careerjet.com/partners/api/) | Jobs API | `CAREERJET_API_KEY` | Basic auth, neighborhood string match |
| [SerpApi Google Jobs](https://serpapi.com/google-jobs-api) | Search API | `SERPAPI_API_KEY` | 4 queries (part time, barista, cashier, retail), 100/mo free tier |
| [Craigslist](https://www.craigslist.org) | HTML scrape | None | Brooklyn + Staten Island part-time, JSON-LD from posting pages |
| [Workday](https://www.myworkdayjobs.com) | Careers API | None | Target, CVS Health, TJX (TJ Maxx / Marshalls / HomeGoods) |
| [Anthropic web search](https://www.anthropic.com) | AI + web search | `ANTHROPIC_API_KEY` | Claude Sonnet targets small local businesses not on job boards |

Each provider runs independently — if one fails or has no credentials, the
others still run. Providers with no credentials are silently skipped.

### Location filtering

- Listings with lat/lng coordinates are filtered by haversine distance ≤ 5
  miles from 1601 Benson Ave.
- Listings without coordinates are filtered by neighborhood string match
  against a whitelist of Brooklyn and Staten Island neighborhoods.

### To enable it

Add any of the credential secrets to the repo: **Settings → Secrets and
variables → Actions → New repository secret**. At minimum, Adzuna
credentials are recommended (free at
[developer.adzuna.com/signup](https://developer.adzuna.com/signup)).
Craigslist and Workday require no credentials.

You can also trigger a run manually any time from the **Actions** tab
("Weekly job search" → **Run workflow**), or locally with:

```bash
ADZUNA_APP_ID=... ADZUNA_APP_KEY=... npm run find-jobs
```

Additional providers can be added by setting their respective secrets — the
script will pick them up automatically.

## Local development

```bash
npm install
npm run dev
```
