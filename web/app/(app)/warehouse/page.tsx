import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { listFgJobs } from "@/lib/data/fg";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { WarehouseView } from "./warehouse-view";

export const metadata = { title: "คลัง / FG — PD Monitor" };

export default async function WarehousePage() {
  const profile = await getProfile();
  const canManage = hasAnyRole(profile?.roles ?? [], ["warehouse", "manager"]);
  const jobs = await listFgJobs();

  const received = jobs.filter((j) => j.fg);
  const pending = jobs.filter((j) => !j.fg);
  const totalReceived = received.reduce((s, j) => s + (j.fg?.qty ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["jobs", "fg_inventory"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">คลัง / FG</h1>
        <p className="text-sm text-muted-foreground">
          สินค้าสำเร็จรูป (Finished Goods) · รับงานที่ผ่าน QA เข้าคลัง · จำนวน/ตำแหน่งจัดเก็บ
          {canManage ? "" : " (ดูอย่างเดียว — รับเข้าได้เฉพาะฝ่ายคลัง/ผู้บริหาร)"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">งาน FG ทั้งหมด</p>
          <p className="mt-1 text-2xl font-bold">{jobs.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">รอรับเข้าคลัง</p>
          <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {pending.length}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">ยอดรับเข้ารวม</p>
          <p className="mt-1 text-2xl font-bold">
            {totalReceived.toLocaleString("th-TH")}
          </p>
        </div>
      </div>

      <WarehouseView jobs={jobs} canManage={canManage} />
    </div>
  );
}
