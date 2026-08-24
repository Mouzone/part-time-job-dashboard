// AI-powered dedup pass. Sends the full candidate list to Claude in one
// batched call to identify cross-provider duplicates that the deterministic
// layer missed (e.g. "CVS Health Cashier" vs "CVS Pharmacy Front End Cashier").
// Returns a set of job IDs to remove. Wrapped in try/catch so failures are
// silently skipped — the deterministic layer is the source of truth.
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a deduplication assistant for job listings. You receive a list of jobs from multiple job boards and must identify which ones are the same real-world job opening posted on different sites.

Respond with ONLY a JSON object: {"remove": ["id1", "id2", ...]}
The "remove" array contains the IDs of the DUPLICATE entries to delete. For each group of duplicates, keep the one with the most complete data (has lat/lng, salary, longer description) and mark the others for removal.

If there are no duplicates, respond with: {"remove": []}

Never include prose or explanations. Only JSON.`;

export async function aiDedupJobs(allJobs) {
  if (!API_KEY) {
    console.log("[dedup-ai] Skipping — no ANTHROPIC_API_KEY.");
    return new Set();
  }

  if (allJobs.length < 2) return new Set();

  // Compact representation to minimize tokens
  const compact = allJobs.map((j, i) => ({
    idx: i,
    id: j.id,
    employer: j.employer,
    role: j.role,
    address: j.address,
    applyUrl: j.applyUrl,
    hasCoords: typeof j.lat === "number" || j._hasCoords,
    notesLen: (j.notes || "").length,
  }));

  const userContent = `Here are ${compact.length} job listings. Identify duplicates (same real job posted on different sites). Keep the one with the most data in each group; mark others for removal.

${JSON.stringify(compact, null, 2)}

Return JSON: {"remove": ["id1", "id2", ...]}`;

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
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[dedup-ai] API error ${response.status}: ${body}`);
      return new Set();
    }

    const data = await response.json();
    const textBlock = data.content?.find((b) => b.type === "text");
    if (!textBlock) {
      console.log("[dedup-ai] No text in response.");
      return new Set();
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("[dedup-ai] No JSON found in response.");
      return new Set();
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.log("[dedup-ai] Failed to parse JSON.");
      return new Set();
    }

    const removeIds = Array.isArray(parsed.remove) ? parsed.remove : [];
    const removeSet = new Set(removeIds.filter((id) => typeof id === "string"));

    console.log(`[dedup-ai] Identified ${removeSet.size} duplicate(s) for removal.`);
    return removeSet;
  } catch (err) {
    console.error(`[dedup-ai] Error:`, err.message);
    return new Set();
  }
}
