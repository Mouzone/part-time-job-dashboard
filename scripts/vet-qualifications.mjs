// AI-powered qualification vetting. Sends each new candidate job (with full
// description) along with the user's profile to Claude Haiku to evaluate
// whether the user is qualified and the job fits their constraints.
// Returns a set of job IDs to reject. Wrapped in try/catch so failures are
// silently skipped — the keyword pre-filter is the safety net.
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a job qualification vetting assistant. You receive a job seeker's profile and a list of candidate job listings. For each job, evaluate whether the seeker is qualified and whether the job fits their constraints.

Reject a job if ANY of the following are true:
- The job requires education, credentials, licenses, or certifications the seeker does not have.
- The job requires fluency in a language the seeker does not speak.
- The job is restricted by gender or other demographic characteristics.
- The job requires a fixed/recurring schedule that conflicts with a full-time student's availability (e.g. teaching positions with set class times).
- The job is in an explicitly excluded category per the profile.

Keep a job if the requirements are reasonable for someone with the seeker's skills and education, even if it's not a perfect match.

Respond with ONLY a JSON object: {"reject": [{"id": "job-id", "reason": "short reason"}]}
If all jobs are suitable, respond with: {"reject": []}
Never include prose or explanations. Only JSON.`;

export async function vetQualifications(candidates, profile) {
  if (!API_KEY) {
    console.log("[vet-qualifications] Skipping — no ANTHROPIC_API_KEY.");
    return new Map();
  }

  if (candidates.length === 0) return new Map();

  const compact = candidates.map((c) => ({
    id: c._vetId,
    role: c.role,
    employer: c.employer,
    description: (c.description || c.notes || "").slice(0, 800),
  }));

  const profileSummary = [
    `Education: ${profile.education}`,
    `Student status: ${profile.studentStatus}`,
    `Schedule needs: ${profile.scheduleNeeds}`,
    `Skills: ${profile.skills.join(", ")}`,
    `Languages: ${profile.languages.join(", ")}`,
    `Excluded job types: ${profile.excludedJobTypes.join("; ")}`,
    `Additional notes: ${profile.additionalNotes}`,
  ].join("\n");

  const userContent = `Job seeker profile:
${profileSummary}

Candidate jobs to evaluate:
${JSON.stringify(compact, null, 2)}

Return JSON: {"reject": [{"id": "...", "reason": "..."}]}`;

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
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[vet-qualifications] API error ${response.status}: ${body}`);
      return new Map();
    }

    const data = await response.json();
    const textBlock = data.content?.find((b) => b.type === "text");
    if (!textBlock) {
      console.log("[vet-qualifications] No text in response.");
      return new Map();
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("[vet-qualifications] No JSON found in response.");
      return new Map();
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.log("[vet-qualifications] Failed to parse JSON.");
      return new Map();
    }

    const rejectList = Array.isArray(parsed.reject) ? parsed.reject : [];
    const rejectMap = new Map();
    for (const entry of rejectList) {
      if (entry && typeof entry.id === "string") {
        rejectMap.set(entry.id, entry.reason || "Unqualified");
      }
    }

    console.log(
      `[vet-qualifications] Identified ${rejectMap.size} job(s) to reject out of ${candidates.length} candidates.`
    );
    return rejectMap;
  } catch (err) {
    console.error(`[vet-qualifications] Error:`, err.message);
    return new Map();
  }
}
