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
`scripts/find-jobs.mjs`, which asks Claude (with web search) to find new
matching job leads and merges them into `data/jobs.json`. A commit is
pushed automatically when new leads are found, which triggers a new Vercel
deployment.

To enable it, add an `ANTHROPIC_API_KEY` secret to this repo:
**Settings → Secrets and variables → Actions → New repository secret**.

You can also trigger a run manually any time from the **Actions** tab
("Weekly job search" → **Run workflow**), or locally with:

```bash
ANTHROPIC_API_KEY=sk-... npm run find-jobs
```

## Local development

```bash
npm install
npm run dev
```
