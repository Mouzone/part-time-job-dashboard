// Weekly job-search orchestrator. Runs all job-board providers in parallel,
// collects results, filters by location, date, and qualifications (keyword +
// AI), deduplicates against existing active jobs using a two-layer approach
// (deterministic + AI), and merges new leads into data/jobs.json.
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
  normalizedUrl,
  uniqueId,
  isWithinNeighborhood,
  daysSince,
  industryFromTitle,
  isDuplicateJob,
  loadExistingJobs,
  loadProfile,
  failsKeywordFilter,
} from "./_shared.mjs";

import { fetchJobs as fetchAdzuna } from "./providers/adzuna.mjs";
import { fetchJobs as fetchJooble } from "./providers/jooble.mjs";
import { fetchJobs as fetchCareerjet } from "./providers/careerjet.mjs";
import { fetchJobs as fetchSerpApi } from "./providers/serpapi-google.mjs";
import { fetchJobs as fetchCraigslist } from "./providers/craigslist.mjs";
import { fetchJobs as fetchWorkday } from "./providers/workday.mjs";
import { fetchJobs as fetchAnthropic } from "./providers/anthropic-search.mjs";
import { aiDedupJobs } from "./dedup-ai.mjs";
import { vetQualifications } from "./vet-qualifications.mjs";

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
  const profile = await loadProfile();

  // --- Layer 1: deterministic dedup ---
  // Check each new candidate against existing active jobs AND already-accepted
  // new candidates using fuzzy employer+role matching and URL matching.
  const existingById = new Map(active.map((job) => [job.id, job]));
  const accepted = []; // new jobs that passed dedup so far

  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  let tooFar = 0;
  let tooOld = 0;
  let dupes = 0;
  let unqualified = 0;

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

    // Keyword pre-filter: reject obvious qualification mismatches
    if (profile) {
      const matchedKeyword = failsKeywordFilter(item);
      if (matchedKeyword) {
        unqualified += 1;
        console.log(
          `  [keyword-filter] Rejected "${item.role}" at ${item.employer} — matched "${matchedKeyword}"`
        );
        continue;
      }
    }

    const candidate = {
      employer: item.employer,
      role: item.role,
      applyUrl: item.applyUrl,
    };

    // Check against existing active jobs
    let isDupe = false;
    for (const existing of active) {
      if (isDuplicateJob(candidate, existing)) {
        isDupe = true;
        break;
      }
    }
    if (isDupe) {
      dupes += 1;
      continue;
    }

    // Check against already-accepted new candidates
    for (const acceptedJob of accepted) {
      if (isDuplicateJob(candidate, acceptedJob)) {
        isDupe = true;
        break;
      }
    }
    if (isDupe) {
      dupes += 1;
      continue;
    }

    const id = uniqueId(slugify(`${item.employer}-${item.role}`), existingById);
    const job = {
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
      _hasCoords: typeof item.lat === "number",
      description: item.description || "",
      _vetId: id,
    };
    existingById.set(id, job);
    accepted.push(job);
    added += 1;
  }

  console.log(
    `Layer 1 (deterministic): added ${added}, skipped ${dupes} dupes, ` +
      `${tooFar} too far, ${tooOld} too old, ${unqualified} unqualified (keyword).`
  );

  // --- Qualification vetting (AI) ---
  // Send new candidates with full descriptions to Claude to evaluate
  // whether the user is qualified. Only runs if profile and API key are set.
  if (profile && added > 0) {
    const rejectMap = await vetQualifications(accepted, profile);

    if (rejectMap.size > 0) {
      let vetRemoved = 0;
      for (const [vetId, reason] of rejectMap) {
        if (existingById.has(vetId)) {
          existingById.delete(vetId);
          vetRemoved += 1;
          const job = accepted.find((j) => j._vetId === vetId);
          console.log(
            `  [ai-vet] Rejected "${job?.role || vetId}" at ${job?.employer || "?"} — ${reason}`
          );
        }
      }
      added -= vetRemoved;
      console.log(`Qualification vetting (AI): removed ${vetRemoved} unqualified job(s).`);
    }
  }

  // --- Layer 2: AI dedup ---
  // Send the full merged list to Claude to catch cross-provider duplicates
  // that fuzzy matching missed. Only runs if ANTHROPIC_API_KEY is set.
  let merged = Array.from(existingById.values());

  if (added > 0) {
    const removeSet = await aiDedupJobs(merged);

    if (removeSet.size > 0) {
      let aiRemoved = 0;
      for (const id of removeSet) {
        if (existingById.delete(id)) {
          aiRemoved += 1;
        }
      }
      merged = Array.from(existingById.values());
      console.log(`Layer 2 (AI): removed ${aiRemoved} additional duplicate(s).`);
    }
  }

  // Sort, slice, write
  merged.sort((a, b) => b.dateFound.localeCompare(a.dateFound));
  if (merged.length > MAX_JOBS) merged = merged.slice(0, MAX_JOBS);

  // Strip internal fields before writing
  const clean = merged.map(({ _hasCoords, description, _vetId, ...rest }) => rest);

  await fs.writeFile(DATA_PATH, JSON.stringify(clean, null, 2) + "\n");
  console.log(
    `\nFinal: ${clean.length} total job leads ` +
      `(${added} new this run).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
