import { getJobs } from "@/lib/data/jobs";
import { getProfile } from "@/lib/auth/dal";
import { canPlanJobs } from "@/lib/data/role-access";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { BoardView } from "./board-view";

export const metadata = { title: "บอร์ดงาน — PD Monitor" };

export default async function BoardPage() {
  const [jobs, profile] = await Promise.all([getJobs(), getProfile()]);
  const canCreate = canPlanJobs(profile?.roles ?? []);
  return (
    <>
      <RealtimeRefresh tables={["jobs", "fg_inventory"]} />
      <BoardView jobs={jobs} canCreate={canCreate} />
    </>
  );
}
