import { getProfile } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { listMachines, type Machine } from "@/lib/data/machines";
import { getMachineUsage } from "@/lib/data/machine-usage";
import {
  MACHINE_STATUS_LABEL,
  MACHINE_BLOCKED_STATUSES,
  daysUntil,
  type MachineStatus,
} from "@/lib/data/machine-constants";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { MachinesView } from "./machines-view";

export const metadata = { title: "เครื่องจักร — PD Monitor" };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function validDate(s: string | undefined, fallback: string): string {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}
function fmtHours(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

type Attention = { code: string; name: string; reasons: string[] };

/** เครื่องที่ต้องดูแล: สถานะซ่อม/สอบเทียบ · เลยกำหนด · ใกล้ครบกำหนด (≤7 วัน) */
function computeAttention(machines: Machine[]): Attention[] {
  const out: Attention[] = [];
  for (const m of machines) {
    if (!m.is_active) continue;
    const reasons: string[] = [];

    if (MACHINE_BLOCKED_STATUSES.has(m.status as MachineStatus)) {
      reasons.push(`สถานะ: ${MACHINE_STATUS_LABEL[m.status] ?? m.status}`);
    }
    const dm = daysUntil(m.next_maintenance_date);
    if (dm !== null && dm < 0) reasons.push(`เลยกำหนดซ่อม ${Math.abs(dm)} วัน`);
    else if (dm !== null && dm <= 7) reasons.push(`ใกล้ครบซ่อม (อีก ${dm} วัน)`);

    const dc = daysUntil(m.next_calibration_date);
    if (dc !== null && dc < 0) reasons.push(`เลยกำหนดสอบเทียบ ${Math.abs(dc)} วัน`);
    else if (dc !== null && dc <= 7) reasons.push(`ใกล้ครบสอบเทียบ (อีก ${dc} วัน)`);

    if (reasons.length > 0) out.push({ code: m.code, name: m.name, reasons });
  }
  return out;
}

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const from = validDate(sp.from, firstOfMonthISO());
  const to = validDate(sp.to, todayISO());

  const profile = await getProfile();
  const canManage = hasRole(profile?.roles ?? [], "manager");
  const [machines, usage] = await Promise.all([
    listMachines(),
    getMachineUsage(from, to),
  ]);
  const attention = computeAttention(machines);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["machines", "production_records"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">เครื่องจักร</h1>
        <p className="text-sm text-muted-foreground">
          ทะเบียนเครื่องจักร · สถานะ · กำหนดซ่อมบำรุง/สอบเทียบ · รายงานการใช้งาน
          {canManage ? "" : " (ดูอย่างเดียว — แก้ไขได้เฉพาะผู้บริหาร/ผู้ดูแลระบบ)"}
        </p>
      </div>

      {/* แจ้งเตือน: เครื่องที่ต้องดูแล */}
      {attention.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/20">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">
            ⚠️ เครื่องที่ต้องดูแล {attention.length} เครื่อง
          </p>
          <ul className="mt-2 space-y-1.5">
            {attention.map((a) => (
              <li key={a.code} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{a.code}</span>
                <span className="text-muted-foreground">{a.name}</span>
                {a.reasons.map((r, i) => (
                  <span
                    key={i}
                    className="rounded bg-amber-200/60 px-1.5 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                  >
                    {r}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
          ✅ ไม่มีเครื่องที่เลย/ใกล้ครบกำหนดซ่อม-สอบเทียบ หรืออยู่สถานะซ่อม
        </div>
      )}

      {/* รายงานการใช้เครื่อง */}
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">รายงานการใช้เครื่อง</h2>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">ตั้งแต่</label>
              <input
                type="date"
                name="from"
                defaultValue={from}
                max={to}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">ถึง</label>
              <input
                type="date"
                name="to"
                defaultValue={to}
                max={todayISO()}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              ดู
            </button>
          </form>
        </div>

        {usage.length > 0 ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">เครื่อง</th>
                  <th className="px-2 py-2 text-right font-medium">ชั่วโมงรวม</th>
                  <th className="px-2 py-2 text-right font-medium">จำนวนครั้งบันทึก</th>
                  <th className="px-2 py-2 text-right font-medium">จำนวนงาน</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.machine_id} className="border-b last:border-0">
                    <td className="px-2 py-2">
                      <span className="font-medium">{u.code}</span>{" "}
                      <span className="text-muted-foreground">{u.name}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtHours(u.total_hours)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{u.record_count}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{u.job_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            ยังไม่มีการบันทึกผลผลิตที่ระบุเครื่องจักรในช่วงนี้
          </p>
        )}
      </div>

      {/* ทะเบียนเครื่องจักร */}
      <MachinesView machines={machines} canManage={canManage} />
    </div>
  );
}
