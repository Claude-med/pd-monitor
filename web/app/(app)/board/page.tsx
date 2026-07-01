import { getJobs } from "@/lib/data/jobs";
import { getProfile } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { BoardView } from "./board-view";

export const metadata = { title: "บอร์ดงาน — PD Monitor" };

export default async function BoardPage() {
  const [jobs, profile] = await Promise.all([getJobs(), getProfile()]);
  const canCreate = hasRole(profile?.roles ?? [], "manager");
  return (
    <>
      <RealtimeRefresh tables={["jobs", "fg_inventory"]} />
      <BoardView jobs={jobs} canCreate={canCreate} />
    </>
  );
}
