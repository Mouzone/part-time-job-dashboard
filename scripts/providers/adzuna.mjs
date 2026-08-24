// Adzuna jobs API provider.
// Docs: https://developer.adzuna.com/docs/search
// Returns raw job listings with lat/lng for haversine filtering.
import { HOME_LAT, HOME_LON, haversineMiles } from "../_shared.mjs";

const APP_ID = process.env.ADZUNA_APP_ID;
const APP_KEY = process.env.ADZUNA_APP_KEY;

const SEARCH = {
  where: "Bensonhurst, Brooklyn, NY",
  distance: 8,
  results_per_page: 50,
  part_time: 1,
  sort_by: "date",
  max_days_old: 14,
};
const PAGES = 3;

export async function fetchJobs() {
  if (!APP_ID || !APP_KEY) {
    console.log("[adzuna] Skipping — no credentials.");
    return [];
  }

  const all = [];
  for (let page = 1; page <= PAGES; page += 1) {
    const results = await fetchPage(page);
    if (results.length === 0) break;
    all.push(...results);
  }

  const jobs = [];
  for (const item of all) {
    if (item.contract_time === "full_time") continue;
    if (typeof item.latitude !== "number" || typeof item.longitude !== "number") {
      continue;
    }
    const miles = haversineMiles(HOME_LAT, HOME_LON, item.latitude, item.longitude);

    const description = (item.description || "").replace(/\s+/g, " ").trim();
    const notesParts = [];
    if (description) {
      notesParts.push(description.length > 140 ? `${description.slice(0, 137)}...` : description);
    }
    if (item.salary_min && item.salary_max) {
      const label = item.salary_is_predicted === "1" ? "est. " : "";
      notesParts.push(
        `${label}$${Math.round(item.salary_min).toLocaleString()}–$${Math.round(item.salary_max).toLocaleString()}/yr`
      );
    }

    jobs.push({
      employer: item.company?.display_name || "",
      role: item.title || "",
      address: item.location?.display_name || "",
      applyUrl: item.redirect_url || "",
      applyMethod: "Adzuna listing",
      notes: notesParts.join(" · "),
      industry: industryFromCategory(item.category?.tag, item.title),
      lat: item.latitude,
      lng: item.longitude,
      miles,
      postedDate: item.created,
    });
  }

  console.log(`[adzuna] Fetched ${all.length} raw, ${jobs.length} after filtering.`);
  return jobs;
}

async function fetchPage(page) {
  const params = new URLSearchParams({
    app_id: APP_ID,
    app_key: APP_KEY,
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
