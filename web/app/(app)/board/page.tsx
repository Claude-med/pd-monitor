import { getJobs } from "@/lib/data/jobs";
import { getProfile } from "@/lib/auth/dal";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { BoardView } from "./board-view";

export const metadata = { title: "บอร์ดงาน — PD Monitor" };

export default async function BoardPage() {
  const [jobs, profile] = await Promise.all([getJobs(), getProfile()]);
  const canCreate = profile?.roles.includes("manager") ?? false;
  return (
    <>
      <RealtimeRefresh tables={["jobs"]} />
      <BoardView jobs={jobs} canCreate={canCreate} />
    </>
  );
}
