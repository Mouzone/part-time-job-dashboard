// CareerJet jobs API provider.
// Docs: https://www.careerjet.com/partners/api/
// GET https://search.api.careerjet.net/v4/query
// Basic auth: API key as username, empty password.
import { isWithinNeighborhood, daysSince, industryFromTitle, MAX_DAYS_OLD } from "../_shared.mjs";

const API_KEY = process.env.CAREERJET_API_KEY;

export async function fetchJobs() {
  if (!API_KEY) {
    console.log("[careerjet] Skipping — no credentials.");
    return [];
  }

  const params = new URLSearchParams({
    keywords: "part time",
    location: "Brooklyn, NY",
    work_hours: "p",
    sort: "date",
    radius: "8",
    page_size: "50",
    user_ip: "127.0.0.1",
    user_agent: "Mozilla/5.0",
  });

  const response = await fetch(
    `https://search.api.careerjet.net/v4/query?${params}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}`,
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(`[careerjet] API error ${response.status}: ${body}`);
    return [];
  }

  const data = await response.json();
  const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

  const jobs = [];
  for (const item of rawJobs) {
    if (daysSince(item.date) > MAX_DAYS_OLD) continue;
    const locations = item.locations || "";
    if (!isWithinNeighborhood(locations)) continue;

    const description = (item.description || "").replace(/\s+/g, " ").trim();
    const notesParts = [];
    if (description) {
      notesParts.push(description.length > 140 ? `${description.slice(0, 137)}...` : description);
    }
    if (item.salary_min && item.salary_max) {
      notesParts.push(`$${Math.round(item.salary_min)}–$${Math.round(item.salary_max)}`);
    }

    jobs.push({
      employer: item.company || "",
      role: item.title || "",
      address: locations,
      applyUrl: item.url || "",
      applyMethod: "CareerJet listing",
      notes: notesParts.join(" · "),
      industry: industryFromTitle(item.title),
      postedDate: item.date,
    });
  }

  console.log(`[careerjet] Fetched ${rawJobs.length} raw, ${jobs.length} after filtering.`);
  return jobs;
}
