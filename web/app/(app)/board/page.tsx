import { getJobs } from "@/lib/data/jobs";
import { getProfile } from "@/lib/auth/dal";
import { canPlanJobs } from "@/lib/data/role-access";
import { listCompanies } from "@/lib/data/companies";
import { STATUS_LABEL } from "@/lib/data/job-constants";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { BoardView } from "./board-view";

export const metadata = { title: "บอร์ดงาน — PD Monitor" };

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // companies = ตัวเลือกของ dropdown กรองบริษัท (แพทเทิร์นเดียวกับหน้า /board/new)
  const [jobs, profile, companies, sp] = await Promise.all([
    getJobs(),
    getProfile(),
    listCompanies(),
    searchParams,
  ]);
  const canCreate = canPlanJobs(profile?.roles ?? []);
  // ?status= มาจากการ์ดบนแดชบอร์ด — ต้อง validate ก่อนใช้ ไม่งั้นค่ามั่วจะทำให้บอร์ดว่างเปล่า
  // ใช้ Object.hasOwn ไม่ใช่ truthiness — ไม่งั้น ?status=constructor จะผ่านด่านไปได้
  const initialStatus =
    sp.status && Object.hasOwn(STATUS_LABEL, sp.status) ? sp.status : "";
  return (
    <>
      <RealtimeRefresh tables={["jobs", "fg_inventory"]} />
      <BoardView
        jobs={jobs}
        companies={companies}
        canCreate={canCreate}
        initialStatus={initialStatus}
      />
    </>
  );
}
