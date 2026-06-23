import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { listMaterials } from "@/lib/data/materials";
import { daysUntil } from "@/lib/data/machine-constants";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { MaterialsView } from "./materials-view";

export const metadata = { title: "วัตถุดิบ / คลัง — PD Monitor" };

type Attention = { code: string; lot: string; reason: string };

export default async function MaterialsPage() {
  const profile = await getProfile();
  const canManage = hasAnyRole(profile?.roles ?? [], ["warehouse", "manager"]);
  const materials = await listMaterials();

  // แจ้งเตือน: ล็อตหมดอายุ / ใกล้หมดอายุ (≤30 วัน) / ไม่ผ่าน
  const attention: Attention[] = [];
  for (const m of materials) {
    for (const lot of m.lots) {
      const d = daysUntil(lot.expiry_date);
      if (lot.status === "expired" || (d !== null && d < 0))
        attention.push({ code: m.code, lot: lot.lot_no, reason: "หมดอายุ" });
      else if (d !== null && d <= 30)
        attention.push({
          code: m.code,
          lot: lot.lot_no,
          reason: `ใกล้หมดอายุ (อีก ${d} วัน)`,
        });
      else if (lot.status === "rejected")
        attention.push({ code: m.code, lot: lot.lot_no, reason: "ไม่ผ่าน" });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["materials", "material_lots"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">วัตถุดิบ / คลัง (RM/PM)</h1>
        <p className="text-sm text-muted-foreground">
          คลังวัตถุดิบและบรรจุภัณฑ์ · ล็อต/สต็อกคงเหลือ · สถานะ QC · วันหมดอายุ
          {canManage ? "" : " (ดูอย่างเดียว — จัดการได้เฉพาะฝ่ายคลัง/ผู้บริหาร)"}
        </p>
      </div>

      {attention.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/20">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">
            ⚠️ ล็อตที่ต้องระวัง {attention.length} รายการ
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {attention.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.code}</span>
                <span className="text-muted-foreground">ล็อต {a.lot}</span>
                <span className="rounded bg-amber-200/60 px-1.5 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                  {a.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
          ✅ ไม่มีล็อตที่หมดอายุ/ใกล้หมดอายุ/ไม่ผ่าน
        </div>
      )}

      <MaterialsView materials={materials} canManage={canManage} />
    </div>
  );
}
