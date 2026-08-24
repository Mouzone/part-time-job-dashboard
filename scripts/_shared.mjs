// Shared constants and helpers used by all providers and the orchestrator.
import path from "node:path";
import fs from "node:fs/promises";

// 1601 Benson Ave, Brooklyn, NY 11214
export const HOME_LAT = 40.6006;
export const HOME_LON = -73.9857;
export const MAX_MILES = 5;
export const MAX_JOBS = 60;
export const MAX_DAYS_OLD = 14;

export const DATA_PATH = path.join(process.cwd(), "data", "jobs.json");
export const HIDDEN_IDS_PATH = path.join(process.cwd(), "data", "hidden-ids.json");

// Neighborhoods within ~5 miles of 1601 Benson Ave, used for string-based
// filtering when a provider doesn't return lat/lng coordinates.
export const NEIGHBORHOOD_WHITELIST = [
  "brooklyn",
  "staten island",
  "bay ridge",
  "bensonhurst",
  "borough park",
  "dyker heights",
  "sunset park",
  "gravesend",
  "coney island",
  "canarsie",
  "flatbush",
  "flatlands",
  "marine park",
  "mill basin",
  "crown heights",
  "prospect heights",
  "park slope",
  "carroll gardens",
  "red hook",
  "gowanus",
  "windsor terrace",
  "kensington",
  "mapleton",
  "bath beach",
  "new utrecht",
  "sheepshead bay",
  "manhattan beach",
  "brighton beach",
  "midwood",
  "ditmas park",
  "prospect park",
  "boerum hill",
  "fort greene",
  "clinton hill",
  "bedford stuyvesant",
  "cobble hill",
  "brooklyn heights",
  "dumbo",
  "vinegar hill",
  "navy yard",
  "greenpoint",
  "williamsburg",
  "bushwick",
  "ridgewood",
  "glendale",
  "ozone park",
  "howard beach",
  "woodhaven",
  "richmond hill",
  "kew gardens",
  "forest hills",
  "elmhurst",
  "corona",
  "jackson heights",
  "astoria",
  "long island city",
  "maspeth",
  "middle village",
  "fresh meadows",
  "flushing",
  "whitestone",
  "bayside",
  "little neck",
  "far rockaway",
  "rockaway beach",
  "arverne",
  "edgemere",
  "broad channel",
  "hamels",
  "rosedale",
  "laurelton",
  "springfield gardens",
  "jamaica",
  "jamaica estates",
  "hollis",
  "holliswood",
  "queens village",
  "cambria heights",
  "st albans",
  "south ozone park",
  "south richmond hill",
  "bellerose",
  "glen oaks",
  "new hyde park",
  "ditmas",
  "prospect lefferts gardens",
  "east flatbush",
  "remsen village",
  "rugby",
  "norwood",
  "hoyt",
  "twombly",
  "brownsville",
  "east new york",
  "cyprus hills",
  "city line",
  "new lots",
  "spring creek",
  "starrett city",
  "georgetown",
  "bergen beach",
  "paerdegat basin",
  "ulmer park",
  "meredith",
  "northeast flatbush",
  "farragut",
  "rosewood",
  "hackensack",
  "borough",
];

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatCommute(miles) {
  if (miles < 1) return "Walking distance (~<1 mi)";
  if (miles < 2) return `~${miles.toFixed(1)} mi — short bus ride`;
  if (miles < 3.5) return `~${miles.toFixed(1)} mi — bus or D/N train`;
  return `~${miles.toFixed(1)} mi — subway or bus transfer`;
}

export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Strip store numbers, parentheticals, and trailing "- location" suffixes so
// "McDonald's (Bensonhurst #02467)" and "McDonald's - 86th St" collide.
export function normalizedKey(employer, role) {
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

export function normalizedUrl(url) {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

export function uniqueId(base, existingById) {
  if (!existingById.has(base)) return base;
  let n = 2;
  while (existingById.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function isWithinNeighborhood(address) {
  if (!address) return false;
  const lower = address.toLowerCase();
  return NEIGHBORHOOD_WHITELIST.some((nb) => lower.includes(nb));
}

export function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return Infinity;
  return (Date.now() - then.getTime()) / (1000 * 60 * 60 * 24);
}

export function industryFromTitle(title) {
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

export async function loadExistingJobs() {
  let existing = [];
  try {
    const raw = await fs.readFile(DATA_PATH, "utf-8");
    existing = JSON.parse(raw);
  } catch {
    // jobs.json may not exist yet
  }

  let hiddenIds = [];
  try {
    const hiddenRaw = await fs.readFile(HIDDEN_IDS_PATH, "utf-8");
    hiddenIds = JSON.parse(hiddenRaw);
  } catch {
    // hidden-ids.json may not exist yet
  }
  const hiddenSet = new Set(hiddenIds);
  const active = existing.filter((job) => !hiddenSet.has(job.id));

  return { existing, active };
}
