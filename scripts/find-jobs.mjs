// Weekly job-search script. Calls Claude with the web_search tool to find
// current part-time job leads near 1601 Benson Ave, Brooklyn, NY 11214,
// then merges any new leads into data/jobs.json. Run via GitHub Actions
// (weekly cron) or manually with `npm run find-jobs`.
import fs from "node:fs/promises";
import path from "node:path";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Add it as a repo secret to run this script.");
  process.exit(1);
}

const DATA_PATH = path.join(process.cwd(), "data", "jobs.json");
const HIDDEN_IDS_PATH = path.join(process.cwd(), "data", "hidden-ids.json");
const MAX_JOBS = 60;

const SYSTEM_PROMPT = `You are a job-search research assistant. You find real, currently-open
part-time job listings and return them as strict JSON. Never invent listings — only include
jobs you found through web search with a real application URL.

Your #1 priority is URL precision. The applyUrl for every job MUST link to the specific,
individual job posting page — the page that describes that one role and has an "Apply" button
for it. Never use:
- A general careers page or job-board homepage (e.g. "walmart.com/careers")
- A search results page that lists many jobs
- A company homepage or "about us" page
If you cannot find the direct posting URL for a job, exclude that job entirely.

Your #2 priority is job specificity. Each listing must be for a concrete, identifiable
position at a specific location — not a vague "we're hiring" announcement or a seasonal
recruiting blurb with no role details.`;

const USER_PROMPT = `Search the web for part-time job openings that meet ALL of these criteria:

1. Located within a 20-30 minute commute (door-to-door) of 1601 Benson Ave, Brooklyn, NY 11214,
   reachable by foot, bus (B1, B6, B64, B82), the D or N subway train, or a mix of those.
2. Can be applied to online (a job board listing, ATS link, or employer careers page — not
   walk-in only).
3. Part-time (not full-time only).
4. Currently open / actively hiring, not expired.

CRITICAL — URL AND JOB SPECIFICITY RULES:

- The "applyUrl" MUST be the direct URL to the specific job posting — the individual page
  for that one role, not a general careers page, not a search-results listing, and not a
  company homepage. Examples of GOOD URLs:
    • https://www.indeed.com/viewjob?jk=abc123  (specific Indeed posting)
    • https://walmart.wd5.myworkdayjobs.com/.../job/...  (specific Workday posting)
    • https://www.linkedin.com/jobs/view/...  (specific LinkedIn posting)
  Examples of BAD URLs (do NOT use these):
    • https://www.walmart.com/careers
    • https://www.indeed.com/q-part-time-l-Brooklyn,-NY-jobs.html
    • https://www.mcdonalds.com/us/en-us/careers.html
- Before including a job, click through or search until you have the EXACT posting URL.
  If the only URL you can find is a general careers page, skip that job — do not include it.
- The "role" field must be the specific job title as shown on the posting (e.g.
  "Part-Time Sales Associate", "Weekend Cashier", "Barista — Part Time") — not a vague
  label like "Team Member" or "Staff" unless that is the actual posting title.
- The "employer" must be the specific franchise/location (e.g. "Dunkin' Bensonhurst") not
  just the brand name when a specific store is identifiable.

Find up to 15 such listings. For each one, respond with ONLY a JSON array (no prose, no markdown
fences) where each item has exactly these fields:

[
  {
    "employer": "string — specific location/franchise if identifiable",
    "role": "string — exact job title from the posting",
    "industry": "Food service" | "Retail / customer service" | "Office / admin" | "Other",
    "address": "string — street address of the specific location",
    "commute": "short human-readable estimate, e.g. '~15 min bus'",
    "applyUrl": "direct URL to the specific job posting page",
    "applyMethod": "short label, e.g. 'Indeed listing' or 'Workday posting'",
    "notes": "short optional context, empty string if none"
  }
]`;

async function main() {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Cheapest current Claude model. Web search + structured JSON
      // extraction is well within what Haiku handles reliably, and this
      // job runs weekly so cost compounds.
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: USER_PROMPT }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 20,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const result = await response.json();
  const textBlocks = (result.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const jsonMatch = textBlocks.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error("No JSON array found in model response:\n", textBlocks);
    process.exit(1);
  }

  let found;
  try {
    found = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("Failed to parse JSON from model response:", err);
    process.exit(1);
  }

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
  // Only active (non-hidden) jobs are used for dedup so the AI can
  // re-discover employers whose previous listing was hidden.
  const seenEmployerRole = new Set(
    active.map((job) => normalizedKey(job.employer, job.role))
  );
  const seenApplyUrls = new Set(active.map((job) => normalizedUrl(job.applyUrl)));

  const today = new Date().toISOString().slice(0, 10);
  let added = 0;

  let rejected = 0;
  for (const item of found) {
    if (!item.employer || !item.role || !item.applyUrl) continue;

    if (isGenericUrl(item.applyUrl)) {
      console.warn(
        `Rejected generic URL for ${item.employer} — ${item.role}: ${item.applyUrl}`
      );
      rejected += 1;
      continue;
    }

    const employerRoleKey = normalizedKey(item.employer, item.role);
    const urlKey = normalizedUrl(item.applyUrl);
    if (seenEmployerRole.has(employerRoleKey) || seenApplyUrls.has(urlKey)) continue;

    const id = uniqueId(slugify(`${item.employer}-${item.role}`), existingById);
    existingById.set(id, {
      id,
      employer: item.employer,
      role: item.role,
      industry: item.industry || "Other",
      address: item.address || "",
      commute: item.commute || "Check estimate",
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
    `Added ${added} new job lead(s). Rejected ${rejected} generic-URL entr${rejected === 1 ? "y" : "ies"}. Total leads: ${merged.length}.`
  );
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function isGenericUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";

    if (segments.length === 0) return true;
    if (["careers", "jobs", "jobs-search", "job-search"].includes(last)) return true;
    if (segments.length === 1 && last === "careers") return true;

    if (u.hostname.includes("indeed.com")) {
      if (u.pathname.startsWith("/q-") || u.pathname.startsWith("/jobs?q=")) return true;
    }
    if (u.hostname.includes("ziprecruiter.com")) {
      if (u.pathname.startsWith("/Jobs/")) return true;
    }
    if (u.hostname.includes("jobtoday.com")) {
      if (u.pathname.includes("/jobs_")) return true;
    }

    return false;
  } catch {
    return true;
  }
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
