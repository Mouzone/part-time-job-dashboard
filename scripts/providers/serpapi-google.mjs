// SerpApi Google Jobs provider.
// Docs: https://serpapi.com/google-jobs-api
// Free tier: 100 searches/month. 4 queries per run = ~16/month.
import { isWithinNeighborhood, daysSince, industryFromTitle, MAX_DAYS_OLD } from "../_shared.mjs";

const API_KEY = process.env.SERPAPI_API_KEY;

const QUERIES = [
  "part time",
  "barista",
  "cashier",
  "retail",
];

export async function fetchJobs() {
  if (!API_KEY) {
    console.log("[serpapi] Skipping — no credentials.");
    return [];
  }

  const allJobs = [];

  for (const q of QUERIES) {
    const params = new URLSearchParams({
      engine: "google_jobs",
      q,
      location: "Brooklyn, NY",
      gl: "us",
      hl: "en",
      chips: "employment_type:PART_TIME;date_posted:week",
      api_key: API_KEY,
    });

    try {
      const response = await fetch(`https://serpapi.com/search.json?${params}`);
      if (!response.ok) {
        const body = await response.text();
        console.error(`[serpapi] API error ${response.status} for query "${q}": ${body}`);
        continue;
      }

      const data = await response.json();
      const results = Array.isArray(data.jobs_results) ? data.jobs_results : [];

      for (const item of results) {
        if (daysSince(item.detected_extensions?.posted_at) > MAX_DAYS_OLD) continue;
        const loc = item.location || "";
        if (!isWithinNeighborhood(loc)) continue;

        const description = (item.description || "").replace(/\s+/g, " ").trim();
        const notesParts = [];
        if (description) {
          notesParts.push(description.length > 140 ? `${description.slice(0, 137)}...` : description);
        }
        const salary = item.detected_extensions?.salary;
        if (salary) notesParts.push(salary);

        const applyUrl = item.apply_options?.[0]?.link || "";
        const via = item.via || "Google Jobs";

        allJobs.push({
          employer: item.company_name || "",
          role: item.title || "",
          address: loc,
          applyUrl,
          applyMethod: via,
          notes: notesParts.join(" · "),
          industry: industryFromTitle(item.title),
          postedDate: item.detected_extensions?.posted_at,
        });
      }
    } catch (err) {
      console.error(`[serpapi] Error for query "${q}":`, err.message);
    }
  }

  console.log(`[serpapi] Fetched ${allJobs.length} jobs across ${QUERIES.length} queries.`);
  return allJobs;
}
