import jobs from "@/data/jobs.json";
import JobsDashboard, { Job } from "@/components/JobsDashboard";

export default function Home() {
  return <JobsDashboard jobs={jobs as Job[]} />;
}
