import { getProfile } from "@/lib/auth/dal";
import {
  getDashboardData,
  DEFAULT_LABOR_RATE,
} from "@/lib/data/dashboard";
import { STATION_LABEL, STATION_ICON } from "@/lib/data/station-constants";
import { RealtimeRefresh } from "@/components/realtime-refresh";

const STATUS_LABELS: Record<string, string> = {
  pending_announce: "รอแจ้งผลิต",
  planned: "มีแผนแล้ว",
  in_production: "กำลังผลิต",
  qc: "รอ/อยู่ QC",
  qa: "รอ/อยู่ QA",
  finished_goods: "เสร็จ (FG)",
};

const STATUS_ORDER = [
  "pending_announce",
  "planned",
  "in_production",
  "qc",
  "qa",
  "finished_goods",
];

function fmt(n: number): string {
  // ตัดทศนิยมที่ลงท้ายด้วยศูนย์ออก แต่คงสูงสุด 2 ตำแหน่ง
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function fmtBaht(n: number): string {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthISO(): string {
  return todayISO().slice(0, 8) + "01";
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; rate?: string }>;
}) {
  const profile = await getProfile();
  const isManager = profile?.roles.includes("manager") ?? false;

  const sp = await searchParams;
  const from = sp.from && ISO.test(sp.from) ? sp.from : firstOfMonthISO();
  const to = sp.to && ISO.test(sp.to) ? sp.to : todayISO();

  // อัตราค่าแรง: เห็น/ปรับได้เฉพาะผู้บริหาร
  const parsedRate = Number(sp.rate);
  const rate =
    Number.isFinite(parsedRate) && parsedRate >= 0
      ? parsedRate
      : DEFAULT_LABOR_RATE;

  const d = await getDashboardData(from, to);
  const dlCost = d.totalHours * rate;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["jobs", "production_records"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          สวัสดี {profile?.full_name ?? ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ภาพรวมงานผลิตทั้งหมด {d.totalJobs} งาน
          {d.problemCount > 0 && (
            <>
              {" · "}
              <span className="font-medium text-destructive">
                ติดปัญหา {d.problemCount} งาน
              </span>
            </>
          )}
        </p>
      </div>

      {/* งานตามสถานะ (ภาพรวมปัจจุบัน) */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          งานตามสถานะ (ปัจจุบัน)
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STATUS_ORDER.map((s) => (
            <div key={s} className="rounded-xl border bg-card p-4">
              <p className="text-2xl font-bold tabular-nums">
                {d.statusCounts[s] ?? 0}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {STATUS_LABELS[s]}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ตัวกรองช่วงวันที่ (+ อัตราค่าแรง สำหรับผู้บริหาร) */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            ตั้งแต่วันที่
          </label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            max={todayISO()}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            ถึงวันที่
          </label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            max={todayISO()}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {isManager && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ค่าแรง (฿/ชม.)
            </label>
            <input
              type="number"
              name="rate"
              min={0}
              step="any"
              defaultValue={rate}
              className="w-28 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          ดูสรุป
        </button>
      </form>

      {/* KPI ผลผลิตในช่วงที่เลือก */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          ผลผลิตช่วง {from} ถึง {to} ({d.recordCount} บันทึก)
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">ผลิตได้รวม</p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {fmt(d.totalOutput)}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">ของเสียรวม</p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {fmt(d.totalLoss)}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Yield (ผลิตได้/ตั้งต้น)</p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {d.yieldPct == null ? "—" : `${d.yieldPct.toFixed(1)}%`}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">ชั่วโมงแรงงานรวม</p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {fmt(d.totalHours)}
            </p>
          </div>
        </div>
      </div>

      {/* ต้นทุนค่าแรง (DL cost) — ผู้บริหารเท่านั้น */}
      {isManager && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            ต้นทุนค่าแรงทางตรง (DL cost) · ที่ {fmt(rate)} ฿/ชม.
          </h2>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs text-muted-foreground">
              ต้นทุนค่าแรงรวมในช่วงที่เลือก
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              ฿{fmtBaht(dlCost)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              = {fmt(d.totalHours)} ชม. × {fmt(rate)} ฿/ชม.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">สถานี</th>
                    <th className="px-3 py-2 text-right font-medium">ชม.</th>
                    <th className="px-3 py-2 text-right font-medium">ผลิตได้</th>
                    <th className="px-3 py-2 text-right font-medium">ของเสีย</th>
                    <th className="px-3 py-2 text-right font-medium">ค่าแรง (฿)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byStation.map((s) => (
                    <tr key={s.station} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2">
                        {STATION_ICON[s.station]}{" "}
                        {STATION_LABEL[s.station] ?? s.station}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(s.hours)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(s.output)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(s.loss)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        ฿{fmtBaht(s.hours * rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td className="px-3 py-2">รวม</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmt(d.totalHours)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmt(d.totalOutput)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmt(d.totalLoss)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      ฿{fmtBaht(dlCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              * ค่าแรงคิดจากชั่วโมงทำงานที่บันทึก × อัตราที่ตั้ง (ปรับช่อง
              &ldquo;ค่าแรง&rdquo; ด้านบนได้) — ใช้ประเมินต้นทุนเบื้องต้น
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
