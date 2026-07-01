import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import {
  getPendingEditRequests,
  getTargetSnapshot,
} from "@/lib/data/edit-requests";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { EditRequestsView } from "./edit-requests-view";

export default async function EditRequestsPage() {
  const profile = await getProfile();
  const roles = profile?.roles ?? [];
  if (!hasAnyRole(roles, ["manager", "qa"])) redirect("/");

  const pending = await getPendingEditRequests();
  // ค่าเดิม (before) ของแต่ละคำขอ — โชว์ diff
  const befores: Record<string, Record<string, string>> = {};
  await Promise.all(
    pending.map(async (r) => {
      befores[r.id] = await getTargetSnapshot(r.target_type, r.target_id);
    }),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RealtimeRefresh tables={["edit_requests"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">คำขอแก้ไขย้อนหลัง</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          อนุมัติแล้วระบบจะแก้ข้อมูลจริงให้ทันที พร้อมบันทึกประวัติ (ใคร/เมื่อไร/แก้อะไร)
        </p>
      </div>
      <EditRequestsView items={pending} befores={befores} />
    </div>
  );
}
