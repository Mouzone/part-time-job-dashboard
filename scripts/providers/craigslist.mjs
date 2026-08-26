// Craigslist jobs provider.
// Fetches Brooklyn + Staten Island part-time listings via the static HTML
// fallback (no JS required), then enriches from individual posting pages
// for lat/lng, company name, and full description via JSON-LD.
import { haversineMiles, HOME_LAT, HOME_LON, MAX_MILES, daysSince, industryFromTitle, MAX_DAYS_OLD } from "../_shared.mjs";

const SUBAREAS = ["brk", "stn"];
const MAX_POSTING_FETCHES = 20;
const USER_AGENT = "Mozilla/5.0 (compatible; JobDashboardBot/1.0)";

export async function fetchJobs() {
  const searchResults = [];

  for (const sub of SUBAREAS) {
    try {
      const url = `https://www.craigslist.org/search/subarea/${sub}?cat=jjj&employment_type=2&sort=date`;
      const html = await fetchText(url);
      const listings = parseSearchResults(html, sub);
      searchResults.push(...listings);
    } catch (err) {
      console.error(`[craigslist] Error fetching subarea ${sub}:`, err.message);
    }
  }

  console.log(`[craigslist] Found ${searchResults.length} listings from search pages.`);

  const sorted = searchResults.slice(0, MAX_POSTING_FETCHES);
  const jobs = [];

  for (const listing of sorted) {
    try {
      const html = await fetchText(listing.url);
      const job = parsePostingPage(html, listing.url);
      if (!job) continue;
      if (daysSince(job.postedDate) > MAX_DAYS_OLD) continue;

      if (typeof job.lat === "number" && typeof job.lng === "number") {
        const miles = haversineMiles(HOME_LAT, HOME_LON, job.lat, job.lng);
        if (miles > MAX_MILES) continue;
        job.miles = miles;
      }

      jobs.push(job);
    } catch (err) {
      // Skip individual posting errors gracefully
    }
  }

  console.log(`[craigslist] Enriched ${jobs.length} jobs from posting pages.`);
  return jobs;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.text();
}

function parseSearchResults(html, subarea) {
  const results = [];
  const liRegex = /<li class="cl-static-search-result"[^>]* title="([^"]*)"[^>]*>\s*<a href="([^"]*)"[^>]*>[\s\S]*?<div class="location">([^<]*)<\/div>/g;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    results.push({
      title: match[1].trim(),
      url: match[2].trim(),
      neighborhood: match[3].trim(),
      subarea,
    });
  }
  return results;
}

function parsePostingPage(html, url) {
  const jsonLdMatch = html.match(/<script[^>]*id="ld_posting_data"[^>]*>([\s\S]*?)<\/script>/);
  if (!jsonLdMatch) return null;

  let data;
  try {
    data = JSON.parse(jsonLdMatch[1].trim());
  } catch {
    return null;
  }

  if (data["@type"] !== "JobPosting") return null;

  const title = data.title || "";
  const employer = data.hiringOrganization?.name || "";
  const description = (data.description || "").replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
  const lat = data.jobLocation?.geo?.latitude ? parseFloat(data.jobLocation.geo.latitude) : undefined;
  const lng = data.jobLocation?.geo?.longitude ? parseFloat(data.jobLocation.geo.longitude) : undefined;
  const addressLocality = data.jobLocation?.address?.addressLocality || "";
  const postedDate = data.datePosted;

  if (!employer || !title) return null;

  return {
    employer,
    role: title,
    address: addressLocality,
    applyUrl: url,
    applyMethod: "Craigslist posting",
    notes: description.length > 140 ? `${description.slice(0, 137)}...` : description,
    description,
    industry: industryFromTitle(title),
    lat,
    lng,
    postedDate,
  };
}
