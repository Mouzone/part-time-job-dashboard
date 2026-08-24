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
`scripts/find-jobs.mjs`, which queries the [Adzuna jobs API](https://developer.adzuna.com)
for recent part-time openings near Bensonhurst, filters them to a 5-mile
radius, and merges any new ones into `data/jobs.json`. A commit is pushed
automatically when new leads are found, which triggers a new Vercel
deployment.

Every listing links to a specific job posting via Adzuna's per-ad redirect
URL, so there are no generic careers-page or search-results links. Locations
come back at neighbourhood level (e.g. "Borough Park, Brooklyn") rather than
street addresses, and the commute estimate is a straight-line distance from
1601 Benson Ave to that neighbourhood's centroid.

To enable it, add `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` secrets to this repo:
**Settings → Secrets and variables → Actions → New repository secret**.
Free API credentials are available at
[developer.adzuna.com/signup](https://developer.adzuna.com/signup).

You can also trigger a run manually any time from the **Actions** tab
("Weekly job search" → **Run workflow**), or locally with:

```bash
ADZUNA_APP_ID=... ADZUNA_APP_KEY=... npm run find-jobs
```

## Local development

```bash
npm install
npm run dev
```
