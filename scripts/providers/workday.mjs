// Workday careers portal provider.
// Scrapes the cxs (candidate experience) API for Target, CVS Health, and TJX.
// These are retail chains with many part-time store positions near Bensonhurst.
import { isWithinNeighborhood, daysSince, industryFromTitle, MAX_DAYS_OLD } from "../_shared.mjs";

const CHAINS = [
  {
    name: "Target",
    url: "https://target.wd5.myworkdayjobs.com/wday/cxs/target/targetcareers/jobs",
  },
  {
    name: "CVS Health",
    url: "https://cvshealth.wd1.myworkdayjobs.com/wday/cxs/cvshealth/CVS_Health_Careers/jobs",
  },
  {
    name: "TJX",
    url: "https://tjx.wd1.myworkdayjobs.com/wday/cxs/tjx/TJX_EXTERNAL/jobs",
  },
];

export async function fetchJobs() {
  const allJobs = [];

  for (const chain of CHAINS) {
    try {
      const response = await fetch(chain.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appliedFacets: {},
          limit: 50,
          offset: 0,
          searchText: "part time",
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`[workday] ${chain.name} API error ${response.status}: ${body}`);
        continue;
      }

      const data = await response.json();
      const postings = Array.isArray(data.jobPostings) ? data.jobPostings : [];

      for (const post of postings) {
        if (daysSince(post.postedOn) > MAX_DAYS_OLD) continue;
        const loc = post.locationsText || "";
        if (!isWithinNeighborhood(loc)) continue;

        allJobs.push({
          employer: chain.name,
          role: post.title || "",
          address: loc,
          applyUrl: post.externalUrl || "",
          applyMethod: `${chain.name} careers`,
          notes: "",
          industry: industryFromTitle(post.title),
          postedDate: post.postedOn,
        });
      }
    } catch (err) {
      console.error(`[workday] Error fetching ${chain.name}:`, err.message);
    }
  }

  console.log(`[workday] Fetched ${allJobs.length} jobs across ${CHAINS.length} chains.`);
  return allJobs;
}
