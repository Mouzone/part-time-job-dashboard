// Weekly job-search script. Queries the Adzuna jobs API for part-time
// openings near 1601 Benson Ave, Brooklyn, NY 11214, filters them to a
// 5-mile radius, and merges any new leads into data/jobs.json. Run via
// GitHub Actions (weekly cron) or manually with `npm run find-jobs`.
import fs from "node:fs/promises";
import path from "node:path";

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
  console.error(
    "ADZUNA_APP_ID and ADZUNA_APP_KEY must both be set. Add them as repo secrets to run this script."
  );
  process.exit(1);
}

const DATA_PATH = path.join(process.cwd(), "data", "jobs.json");
const HIDDEN_IDS_PATH = path.join(process.cwd(), "data", "hidden-ids.json");
const MAX_JOBS = 60;

// 1601 Benson Ave, Brooklyn, NY 11214
const HOME_LAT = 40.6006;
const HOME_LON = -73.9857;
const MAX_MILES = 5;

// Adzuna's `where` geocoding is coarse and leaks results from other
// boroughs and even New Jersey, so we request a generous radius (km) and
// do the real distance filtering client-side with haversine.
const SEARCH = {
  where: "Bensonhurst, Brooklyn, NY",
  distance: 8,
  results_per_page: 50,
  part_time: 1,
  sort_by: "date",
  max_days_old: 14,
};
const PAGES = 3;

async function main() {
  const found = [];
  for (let page = 1; page <= PAGES; page += 1) {
    const results = await fetchPage(page);
    if (results.length === 0) break;
    found.push(...results);
  }

  console.log(`Fetched ${found.length} raw listing(s) from Adzuna.`);

  const existingRaw = await fs.readFile(DATA_PATH, "utf-8");
  const existing = JSON.parse(existingRaw);

  let hiddenIds = [];
  try {
    const hiddenRaw = await fs.readFile(HIDDEN_IDS_PATH, "utf-8");
    hiddenIds = JSON.parse(hiddenRaw);
  } catch {
    // hidden-ids.json may not exist yet
  }
  const hiddenSet = new Set(hiddenIds);

  const active = existing.filter((job) => !hiddenSet.has(job.id));

  const existingById = new Map(active.map((job) => [job.id, job]));

  // Two duplicate signals, since the same opening often reappears with a
  // slightly different store suffix or a different job-board URL:
  //   1. normalized "employer|role" (strips store numbers/parentheticals)
  //   2. exact apply URL, normalized
  // Only active (non-hidden) jobs are used for dedup so a hidden listing's
  // employer can be re-discovered later.
  const seenEmployerRole = new Set(
    active.map((job) => normalizedKey(job.employer, job.role))
  );
  const seenApplyUrls = new Set(active.map((job) => normalizedUrl(job.applyUrl)));

  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  let tooFar = 0;

  for (const item of found) {
    const employer = item.company?.display_name;
    const role = item.title;
    const applyUrl = item.redirect_url;
    if (!employer || !role || !applyUrl) continue;

    if (item.contract_time === "full_time") continue;

    if (typeof item.latitude !== "number" || typeof item.longitude !== "number") {
      tooFar += 1;
      continue;
    }
    const miles = haversineMiles(HOME_LAT, HOME_LON, item.latitude, item.longitude);
    if (miles > MAX_MILES) {
      tooFar += 1;
      continue;
    }

    const employerRoleKey = normalizedKey(employer, role);
    const urlKey = normalizedUrl(applyUrl);
    if (seenEmployerRole.has(employerRoleKey) || seenApplyUrls.has(urlKey)) continue;

    const id = uniqueId(slugify(`${employer}-${role}`), existingById);
    existingById.set(id, {
      id,
      employer,
      role,
      industry: industryFromCategory(item.category?.tag, role),
      address: item.location?.display_name || "",
      commute: formatCommute(miles),
      applyUrl,
      applyMethod: "Adzuna listing",
      notes: buildNotes(item),
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
    `Added ${added} new job lead(s). Skipped ${tooFar} outside ${MAX_MILES} miles. Total leads: ${merged.length}.`
  );
}

async function fetchPage(page) {
  const params = new URLSearchParams({
    app_id: ADZUNA_APP_ID,
    app_key: ADZUNA_APP_KEY,
    "content-type": "application/json",
    ...Object.fromEntries(Object.entries(SEARCH).map(([k, v]) => [k, String(v)])),
  });
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/${page}?${params}`;

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Adzuna API error ${response.status} on page ${page}: ${body}`);
  }

  const result = await response.json();
  return Array.isArray(result.results) ? result.results : [];
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatCommute(miles) {
  if (miles < 1) return "Walking distance (~<1 mi)";
  if (miles < 2) return `~${miles.toFixed(1)} mi — short bus ride`;
  if (miles < 3.5) return `~${miles.toFixed(1)} mi — bus or D/N train`;
  return `~${miles.toFixed(1)} mi — subway or bus transfer`;
}

// Adzuna's `part-time-jobs` category is a generic catch-all that mixes
// retail, food service, and office roles, so fall back to the job title
// when the category tag isn't specific enough.
function industryFromCategory(tag, title) {
  switch (tag) {
    case "hospitality-catering-jobs":
      return "Food service";
    case "retail-jobs":
    case "customer-services-jobs":
    case "sales-jobs":
      return "Retail / customer service";
    case "admin-jobs":
    case "accounting-finance-jobs":
    case "pr-advertising-marketing-jobs":
      return "Office / admin";
    default:
      return industryFromTitle(title);
  }
}

function industryFromTitle(title) {
  const t = (title || "").toLowerCase();
  if (/barista|cook|chef|server|waiter|waitress|bartender|kitchen|restaurant|cashier.*food|food service|deli|dishwasher|crew member/.test(t)) {
    return "Food service";
  }
  if (/retail|sales associate|cashier|store|merchandis|customer service|front desk|host|greeter|stock/.test(t)) {
    return "Retail / customer service";
  }
  if (/administrative|admin assistant|receptionist|office|clerk|data entry|bookkeep|secretary/.test(t)) {
    return "Office / admin";
  }
  return "Other";
}

function buildNotes(item) {
  const parts = [];
  const description = (item.description || "").replace(/\s+/g, " ").trim();
  if (description) {
    parts.push(description.length > 140 ? `${description.slice(0, 137)}...` : description);
  }
  if (item.salary_min && item.salary_max) {
    const label = item.salary_is_predicted === "1" ? "est. " : "";
    parts.push(
      `${label}$${Math.round(item.salary_min).toLocaleString()}–$${Math.round(item.salary_max).toLocaleString()}/yr`
    );
  }
  return parts.join(" · ");
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Strip store numbers, parentheticals, and trailing "- location" suffixes so
// "McDonald's (Bensonhurst #02467)" and "McDonald's - 86th St" collide.
function normalizedKey(employer, role) {
  const clean = (s) =>
    s
      .toLowerCase()
      .replace(/\([^)]*\)/g, "")
      .replace(/#\d+/g, "")
      .split(/[-–—]/)[0]
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${clean(employer)}|${clean(role)}`;
}

function normalizedUrl(url) {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

function uniqueId(base, existingById) {
  if (!existingById.has(base)) return base;
  let n = 2;
  while (existingById.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
