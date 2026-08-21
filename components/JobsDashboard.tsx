"use client";

import { useEffect, useMemo, useState } from "react";

export type Job = {
  id: string;
  employer: string;
  role: string;
  industry: string;
  address: string;
  commute: string;
  applyUrl: string;
  applyMethod: string;
  notes?: string;
  dateFound: string;
};

type JobStatus = "none" | "applied" | "skipped";
type StatusState = Record<string, { status: JobStatus; dateApplied: string | null }>;

const STORAGE_KEY = "job-dashboard-status-v2";
const OLD_STORAGE_KEY = "job-dashboard-applied-v1";

type SortKey = "dateFound" | "industry";
type SortDir = "asc" | "desc";
type FilterMode = "all" | "not-applied" | "applied" | "skipped";

export default function JobsDashboard({ jobs }: { jobs: Job[] }) {
  const [status, setStatusState] = useState<StatusState>({});
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sortKey, setSortKey] = useState<SortKey>("dateFound");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setStatusState(JSON.parse(raw));
      } else {
        // one-time migration from the old applied-only format
        const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
        if (oldRaw) {
          const old = JSON.parse(oldRaw) as Record<
            string,
            { applied: boolean; dateApplied: string | null }
          >;
          const migrated: StatusState = {};
          for (const [id, v] of Object.entries(old)) {
            if (v.applied) migrated[id] = { status: "applied", dateApplied: v.dateApplied };
          }
          setStatusState(migrated);
        }
      }
    } catch {
      // ignore corrupt/unavailable storage
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
    } catch {
      // ignore write failures (private browsing, quota)
    }
  }, [status, hydrated]);

  function setJobStatus(id: string, next: JobStatus) {
    setStatusState((prev) => {
      const current = prev[id]?.status ?? "none";
      const resolved = current === next ? "none" : next;
      return {
        ...prev,
        [id]: {
          status: resolved,
          dateApplied: resolved === "applied" ? new Date().toISOString().slice(0, 10) : null,
        },
      };
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const visibleJobs = useMemo(() => {
    let list = jobs.filter((job) => {
      const jobStatus = status[job.id]?.status ?? "none";
      if (filter === "applied") return jobStatus === "applied";
      if (filter === "skipped") return jobStatus === "skipped";
      if (filter === "not-applied") return jobStatus === "none";
      return true;
    });

    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "dateFound") {
        cmp = a.dateFound.localeCompare(b.dateFound);
      } else {
        cmp = a.industry.localeCompare(b.industry) || a.employer.localeCompare(b.employer);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [jobs, status, filter, sortKey, sortDir]);

  const appliedCount = jobs.filter((j) => status[j.id]?.status === "applied").length;
  const skippedCount = jobs.filter((j) => status[j.id]?.status === "skipped").length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Part-Time Job Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Leads within a 20-30 min walk / bus / train commute of 1601 Benson Ave, Brooklyn NY
          11214. Refreshed weekly.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-200/70 p-1 text-sm">
          {(
            [
              ["all", "All"],
              ["not-applied", "Not applied"],
              ["applied", "Applied"],
              ["skipped", "Skipped"],
            ] as [FilterMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                filter === mode
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-500">
          {appliedCount} / {jobs.length} applied · {skippedCount} skipped
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Applied</th>
              <th className="px-4 py-3">Skip</th>
              <th className="px-4 py-3">Employer</th>
              <th className="px-4 py-3">Role</th>
              <th
                className="cursor-pointer select-none px-4 py-3"
                onClick={() => toggleSort("industry")}
              >
                Industry {sortKey === "industry" ? (sortDir === "asc" ? "▲" : "▼") : ""}
              </th>
              <th className="px-4 py-3">Commute</th>
              <th
                className="cursor-pointer select-none px-4 py-3"
                onClick={() => toggleSort("dateFound")}
              >
                Date found {sortKey === "dateFound" ? (sortDir === "asc" ? "▲" : "▼") : ""}
              </th>
              <th className="px-4 py-3">Date applied</th>
              <th className="px-4 py-3">Apply</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleJobs.map((job) => {
              const jobStatus = status[job.id]?.status ?? "none";
              const dateApplied = status[job.id]?.dateApplied ?? null;
              return (
                <tr
                  key={job.id}
                  className={`hover:bg-slate-50 ${jobStatus === "skipped" ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={jobStatus === "applied"}
                      onChange={() => setJobStatus(job.id, "applied")}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={jobStatus === "skipped"}
                      onChange={() => setJobStatus(job.id, "skipped")}
                      className="h-4 w-4 rounded border-slate-300 text-slate-400 focus:ring-slate-500"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{job.employer}</td>
                  <td className="px-4 py-3 text-slate-700">{job.role}</td>
                  <td className="px-4 py-3 text-slate-700">{job.industry}</td>
                  <td className="px-4 py-3 text-slate-500">{job.commute}</td>
                  <td className="px-4 py-3 text-slate-500">{job.dateFound}</td>
                  <td className="px-4 py-3 text-slate-500">{dateApplied ?? "—"}</td>
                  <td className="px-4 py-3">
                    <a
                      href={job.applyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {job.applyMethod}
                    </a>
                  </td>
                </tr>
              );
            })}
            {visibleJobs.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  No jobs match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Applied/Skip status is saved in this browser only. Skipped jobs are hidden from
        &quot;Not applied&quot; but still show under &quot;All&quot; or &quot;Skipped,&quot; and
        stay in the underlying data so the weekly search won&apos;t re-add them as new. Commute
        times are estimates — verify door-to-door time before committing.
      </p>
    </main>
  );
}
