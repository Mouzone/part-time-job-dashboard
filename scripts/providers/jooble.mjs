// Jooble jobs API provider.
// Docs: https://jooble.org/api
// POST https://jooble.org/api/{apiKey}
// 500 lifetime requests on free tier.
import { isWithinNeighborhood, daysSince, industryFromTitle, MAX_DAYS_OLD } from "../_shared.mjs";

const API_KEY = process.env.JOOBLE_API_KEY;

export async function fetchJobs() {
  if (!API_KEY) {
    console.log("[jooble] Skipping — no credentials.");
    return [];
  }

  const response = await fetch(`https://jooble.org/api/${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keywords: "part time",
      location: "Brooklyn, NY",
      radius: "8",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[jooble] API error ${response.status}: ${body}`);
    return [];
  }

  const data = await response.json();
  const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

  const jobs = [];
  for (const item of rawJobs) {
    if (daysSince(item.updated) > MAX_DAYS_OLD) continue;
    if (!isWithinNeighborhood(item.location)) continue;

    jobs.push({
      employer: item.company || "",
      role: item.title || "",
      address: item.location || "",
      applyUrl: item.link || "",
      applyMethod: "Jooble listing",
      notes: (item.snippet || "").replace(/\s+/g, " ").trim().slice(0, 140),
      industry: industryFromTitle(item.title),
      postedDate: item.updated,
    });
  }

  console.log(`[jooble] Fetched ${rawJobs.length} raw, ${jobs.length} after filtering.`);
  return jobs;
}
