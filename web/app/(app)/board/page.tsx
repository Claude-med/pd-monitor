import { getJobs } from "@/lib/data/jobs";
import { BoardView } from "./board-view";

export const metadata = { title: "บอร์ดงาน — PD Monitor" };

export default async function BoardPage() {
  const jobs = await getJobs();
  return <BoardView jobs={jobs} />;
}
