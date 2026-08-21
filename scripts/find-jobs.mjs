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
const MAX_JOBS = 60;

const SYSTEM_PROMPT = `You are a job-search research assistant. You find real, currently-open
part-time job listings and return them as strict JSON. Never invent listings — only include
jobs you found through web search with a real application URL.`;

const USER_PROMPT = `Search the web for part-time job openings that meet ALL of these criteria:

1. Located within a 20-30 minute commute (door-to-door) of 1601 Benson Ave, Brooklyn, NY 11214,
   reachable by foot, bus (B1, B6, B64, B82), the D or N subway train, or a mix of those.
2. Can be applied to online (a job board listing, ATS link, or employer careers page — not
   walk-in only).
3. Part-time (not full-time only).
4. Currently open / actively hiring, not expired.

Find up to 15 such listings. For each one, respond with ONLY a JSON array (no prose, no markdown
fences) where each item has exactly these fields:

[
  {
    "employer": "string",
    "role": "string",
    "industry": "Food service" | "Retail / customer service" | "Office / admin" | "Other",
    "address": "string",
    "commute": "short human-readable estimate, e.g. '~15 min bus'",
    "applyUrl": "direct URL to apply",
    "applyMethod": "short label, e.g. 'Indeed listing' or 'Company careers site'",
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
          max_uses: 8,
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
  const existingById = new Map(existing.map((job) => [job.id, job]));

  // Two duplicate signals, since the same opening often reappears with a
  // slightly different store suffix or a different job-board URL:
  //   1. normalized "employer|role" (strips store numbers/parentheticals)
  //   2. exact apply URL, normalized
  const seenEmployerRole = new Set(
    existing.map((job) => normalizedKey(job.employer, job.role))
  );
  const seenApplyUrls = new Set(existing.map((job) => normalizedUrl(job.applyUrl)));

  const today = new Date().toISOString().slice(0, 10);
  let added = 0;

  for (const item of found) {
    if (!item.employer || !item.role || !item.applyUrl) continue;

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
  console.log(`Added ${added} new job lead(s). Total leads: ${merged.length}.`);
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
