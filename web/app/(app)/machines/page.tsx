import { getProfile } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { listMachines } from "@/lib/data/machines";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { MachinesView } from "./machines-view";

export const metadata = { title: "เครื่องจักร — PD Monitor" };

export default async function MachinesPage() {
  const profile = await getProfile();
  const canManage = hasRole(profile?.roles ?? [], "manager");
  const machines = await listMachines();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["machines"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">เครื่องจักร</h1>
        <p className="text-sm text-muted-foreground">
          ทะเบียนเครื่องจักร · สถานะ · กำหนดซ่อมบำรุง/สอบเทียบ
          {canManage ? "" : " (ดูอย่างเดียว — แก้ไขได้เฉพาะผู้บริหาร/ผู้ดูแลระบบ)"}
        </p>
      </div>
      <MachinesView machines={machines} canManage={canManage} />
    </div>
  );
}
