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
radius, vets them for qualification matches, deduplicates, and merges any
new ones into `data/jobs.json`. A commit is pushed automatically when new
leads are found, which triggers a new Vercel deployment.

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

### Qualification vetting

Jobs are vetted against the user's profile in `data/profile.json` using a
two-stage approach:

1. **Keyword pre-filter** (`failsKeywordFilter` in `_shared.mjs`): Fast,
   free first pass that rejects jobs with obvious qualification mismatches
   (teaching, medical licenses, CDL, armed security, advanced degrees,
   gender/language restrictions). Checks the job title, full description,
   and notes against a blocklist of exclusion keywords.

2. **AI qualification vetting** (`scripts/vet-qualifications.mjs`): Sends
   each candidate job's full description along with the user profile to
   Claude Haiku for nuanced evaluation. Catches subtle requirements that
   keyword filters miss (e.g. "Yiddish preferred", "female only",
   credential requirements buried in description text). Fail-open: if the
   API call fails, all keyword-filtered candidates are kept.

The profile (`data/profile.json`) captures education level, student status,
schedule needs, skills, languages, excluded job types, and additional
notes. Edit this file to adjust what jobs are filtered.

Full job descriptions are preserved from providers during the pipeline
(stored in a transient `description` field) but stripped before persisting
to `data/jobs.json` — only the 140-char `notes` field is saved for display.

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
