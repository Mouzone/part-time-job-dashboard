// Anthropic web-search provider.
// Uses Claude Sonnet with web search to find small local business job
// postings (bodegas, salons, tutoring centers, gyms, pharmacies) near
// Bensonhurst that may not appear on job boards.
import { isWithinNeighborhood, industryFromTitle } from "../_shared.mjs";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-5-20250929";

const SYSTEM_PROMPT = `You are a job search assistant. Find part-time job openings at small local businesses near Bensonhurst, Brooklyn, NY 11214 (within 5 miles). Target businesses like bodegas, delis, salons, barbershops, tutoring centers, gyms, pharmacies, laundromats, pet stores, and small shops that may not post on major job boards.

You MUST respond with ONLY a JSON array. No prose, no explanations, no apologies. If you find no listings, respond with [].

Each job object must have these exact fields:
{
  "employer": "Business name",
  "role": "Job title",
  "address": "Neighborhood or street address",
  "applyUrl": "Direct URL to the posting or business",
  "applyMethod": "How to apply (e.g. 'In person', 'Phone', 'Email')",
  "notes": "Brief description, max 140 chars",
  "postedDate": "ISO date if known, else null"
}

Examples of valid responses:
[{"employer":"Tony's Deli","role":"Part-time counter help","address":"18th Ave, Bensonhurst","applyUrl":"https://example.com/posting","applyMethod":"In person","notes":"Seeking weekend counter help, must be reliable","postedDate":"2026-08-20"}]

[]

NEVER respond with text like "I cannot" or "I don't have access". Always return a JSON array, even if empty.`;

const USER_PROMPT = `Search for part-time job openings at small local businesses within 5 miles of 1601 Benson Ave, Brooklyn, NY 11214. Focus on Bensonhurst, Bay Ridge, Borough Park, Dyker Heights, Gravesend, and Sunset Park. Return ONLY a JSON array of job listings.`;

export async function fetchJobs() {
  if (!API_KEY) {
    console.log("[anthropic] Skipping — no credentials.");
    return [];
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: USER_PROMPT }],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 15,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[anthropic] API error ${response.status}: ${body}`);
      return [];
    }

    const data = await response.json();

    const textBlock = data.content?.find((b) => b.type === "text");
    if (!textBlock) {
      console.log("[anthropic] No text in response.");
      return [];
    }

    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("[anthropic] No JSON array found in response.");
      return [];
    }

    let listings;
    try {
      listings = JSON.parse(jsonMatch[0]);
    } catch {
      console.log("[anthropic] Failed to parse JSON from response.");
      return [];
    }

    if (!Array.isArray(listings)) return [];

    const jobs = listings
      .filter((item) => item.employer && item.role && item.applyUrl)
      .filter((item) => isWithinNeighborhood(item.address))
      .map((item) => ({
        employer: item.employer,
        role: item.role,
        address: item.address || "",
        applyUrl: item.applyUrl,
        applyMethod: item.applyMethod || "Online application",
        notes: (item.notes || "").slice(0, 140),
        description: item.notes || "",
        industry: industryFromTitle(item.role),
        postedDate: item.postedDate || undefined,
      }));

    console.log(`[anthropic] Found ${jobs.length} local business listings.`);
    return jobs;
  } catch (err) {
    console.error(`[anthropic] Error:`, err.message);
    return [];
  }
}
