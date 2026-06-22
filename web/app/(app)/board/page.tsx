import { getJobs } from "@/lib/data/jobs";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { BoardView } from "./board-view";

export const metadata = { title: "บอร์ดงาน — PD Monitor" };

export default async function BoardPage() {
  const jobs = await getJobs();
  return (
    <>
      <RealtimeRefresh tables={["jobs"]} />
      <BoardView jobs={jobs} />
    </>
  );
}
