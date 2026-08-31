import { getJobs } from "@/lib/data/jobs";
import { getProfile } from "@/lib/auth/dal";
import { canPlanJobs } from "@/lib/data/role-access";
import { listCompanies } from "@/lib/data/companies";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { BoardView } from "./board-view";

export const metadata = { title: "บอร์ดงาน — PD Monitor" };

export default async function BoardPage() {
  // companies = ตัวเลือกของ dropdown กรองบริษัท (แพทเทิร์นเดียวกับหน้า /board/new)
  const [jobs, profile, companies] = await Promise.all([
    getJobs(),
    getProfile(),
    listCompanies(),
  ]);
  const canCreate = canPlanJobs(profile?.roles ?? []);
  return (
    <>
      <RealtimeRefresh tables={["jobs", "fg_inventory"]} />
      <BoardView jobs={jobs} companies={companies} canCreate={canCreate} />
    </>
  );
}
