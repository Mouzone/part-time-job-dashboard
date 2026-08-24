// Weekly job-search orchestrator. Runs all job-board providers in parallel,
// collects results, filters by location and date, deduplicates against
// existing active jobs, and merges new leads into data/jobs.json.
// Run via GitHub Actions (weekly cron) or manually with `npm run find-jobs`.
import fs from "node:fs/promises";

import {
  DATA_PATH,
  MAX_JOBS,
  MAX_MILES,
  HOME_LAT,
  HOME_LON,
  haversineMiles,
  formatCommute,
  slugify,
  normalizedKey,
  normalizedUrl,
  uniqueId,
  isWithinNeighborhood,
  daysSince,
  industryFromTitle,
  loadExistingJobs,
} from "./_shared.mjs";

import { fetchJobs as fetchAdzuna } from "./providers/adzuna.mjs";
import { fetchJobs as fetchJooble } from "./providers/jooble.mjs";
import { fetchJobs as fetchCareerjet } from "./providers/careerjet.mjs";
import { fetchJobs as fetchSerpApi } from "./providers/serpapi-google.mjs";
import { fetchJobs as fetchCraigslist } from "./providers/craigslist.mjs";
import { fetchJobs as fetchWorkday } from "./providers/workday.mjs";
import { fetchJobs as fetchAnthropic } from "./providers/anthropic-search.mjs";

const PROVIDERS = [
  { name: "adzuna", fetch: fetchAdzuna },
  { name: "jooble", fetch: fetchJooble },
  { name: "careerjet", fetch: fetchCareerjet },
  { name: "serpapi", fetch: fetchSerpApi },
  { name: "craigslist", fetch: fetchCraigslist },
  { name: "workday", fetch: fetchWorkday },
  { name: "anthropic", fetch: fetchAnthropic },
];

async function main() {
  console.log("Starting weekly job search across all providers...\n");

  const results = await Promise.allSettled(PROVIDERS.map((p) => p.fetch()));

  let allRaw = [];
  for (let i = 0; i < PROVIDERS.length; i += 1) {
    const result = results[i];
    if (result.status === "fulfilled") {
      allRaw.push(...result.value);
    } else {
      console.error(`[${PROVIDERS[i].name}] Provider rejected:`, result.reason);
    }
  }

  console.log(`\nTotal raw candidates across all providers: ${allRaw.length}`);

  const { active } = await loadExistingJobs();

  const existingById = new Map(active.map((job) => [job.id, job]));
  const seenEmployerRole = new Set(
    active.map((job) => normalizedKey(job.employer, job.role))
  );
  const seenApplyUrls = new Set(active.map((job) => normalizedUrl(job.applyUrl)));

  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  let tooFar = 0;
  let tooOld = 0;
  let dupes = 0;

  for (const item of allRaw) {
    if (!item.employer || !item.role || !item.applyUrl) continue;

    // Location filter: haversine if coords available, else neighborhood match
    let miles;
    if (typeof item.lat === "number" && typeof item.lng === "number") {
      miles = haversineMiles(HOME_LAT, HOME_LON, item.lat, item.lng);
      if (miles > MAX_MILES) {
        tooFar += 1;
        continue;
      }
    } else if (!isWithinNeighborhood(item.address)) {
      tooFar += 1;
      continue;
    }

    // Date filter
    if (daysSince(item.postedDate) > 14) {
      tooOld += 1;
      continue;
    }

    // Dedup
    const employerRoleKey = normalizedKey(item.employer, item.role);
    const urlKey = normalizedUrl(item.applyUrl);
    if (seenEmployerRole.has(employerRoleKey) || seenApplyUrls.has(urlKey)) {
      dupes += 1;
      continue;
    }

    const id = uniqueId(slugify(`${item.employer}-${item.role}`), existingById);
    existingById.set(id, {
      id,
      employer: item.employer,
      role: item.role,
      industry: item.industry || industryFromTitle(item.role),
      address: item.address || "",
      commute: miles != null ? formatCommute(miles) : "Check estimate",
      applyUrl: item.applyUrl,
      applyMethod: item.applyMethod || "Online application",
      notes: item.notes || "",
      dateFound: today,
    });
    seenEmployerRole.add(employerRoleKey);
    seenApplyUrls.add(urlKey);
    added += 1;
  }

  let merged = Array.from(existingById.values()).sort((a, b) =>
    b.dateFound.localeCompare(a.dateFound)
  );
  if (merged.length > MAX_JOBS) merged = merged.slice(0, MAX_JOBS);

  await fs.writeFile(DATA_PATH, JSON.stringify(merged, null, 2) + "\n");
  console.log(
    `\nAdded ${added} new job lead(s). ` +
      `Skipped ${tooFar} outside ${MAX_MILES} miles, ` +
      `${tooOld} too old, ${dupes} duplicates. ` +
      `Total leads: ${merged.length}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
