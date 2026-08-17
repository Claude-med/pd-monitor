import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { canSetLotStatus } from "@/lib/data/role-access";
import { listStockProducts } from "@/lib/data/materials";
import { daysUntil } from "@/lib/data/machine-constants";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { MaterialsView } from "./materials-view";

export const metadata = { title: "ผลิตภัณฑ์คลัง — PD Monitor" };

type Attention = { code: string; lot: string; reason: string };

export default async function MaterialsPage() {
  const profile = await getProfile();
  const roles = profile?.roles ?? [];
  const canManage = hasAnyRole(roles, ["warehouse", "manager"]);
  // Part 2.1: ตั้งสถานะล็อต = ฝ่ายวางแผน/ผู้บริหาร (ตรงกับ can_set_lot_status() ใน DB)
  const canSetStatus = canSetLotStatus(roles);
  const all = await listStockProducts();
  // ที่ปิดใช้งานแล้วซ่อนไว้ เว้นแต่ยังมีล็อตค้างอยู่ (ห้ามซ่อนของที่ยังมีสต็อก)
  const products = all.filter((p) => p.is_active || p.lots.length > 0);

  // แจ้งเตือน: ล็อตหมดอายุ / ใกล้หมดอายุ (≤30 วัน) — ตัดสถานะ "ไม่ผ่าน" ออก
  // เพราะ 0046 ยุบสถานะเหลือ 2 ค่าแล้ว (ของที่ไม่พร้อมใช้เห็นได้จากป้ายในตารางล็อตอยู่แล้ว)
  const attention: Attention[] = [];
  for (const p of products) {
    for (const lot of p.lots) {
      const d = daysUntil(lot.expiry_date);
      if (d !== null && d < 0)
        attention.push({ code: p.code, lot: lot.lot_no, reason: "หมดอายุ" });
      else if (d !== null && d <= 30)
        attention.push({
          code: p.code,
          lot: lot.lot_no,
          reason: `ใกล้หมดอายุ (อีก ${d} วัน)`,
        });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["products", "material_lots"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ผลิตภัณฑ์คลัง</h1>
        <p className="text-sm text-muted-foreground">
          ล็อต/สต็อกคงเหลือของผลิตภัณฑ์ทุกตัว · สถานะ · วันหมดอายุ
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
          ✅ ไม่มีล็อตที่หมดอายุ/ใกล้หมดอายุ
        </div>
      )}

      <MaterialsView
        products={products}
        canManage={canManage}
        canSetStatus={canSetStatus}
      />
    </div>
  );
}
