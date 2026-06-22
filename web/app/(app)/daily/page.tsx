import Link from "next/link";
import { getDailyReport } from "@/lib/data/daily";
import { STATION_LABEL, STATION_ICON } from "@/lib/data/station-constants";

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("th-TH");
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayISO();
  const rows = await getDailyReport(date);

  const totalOutput = rows.reduce((s, r) => s + (r.output_qty ?? 0), 0);
  const totalLoss = rows.reduce((s, r) => s + (r.loss_qty ?? 0), 0);
  const totalHours = rows.reduce((s, r) => s + (r.hours ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">รายงานประจำวัน</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          สรุปบันทึกผลผลิตของทุกงานในวันที่เลือก
        </p>
      </div>

      {/* ตัวกรองวันที่ */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            เลือกวันที่
          </label>
          <input
            type="date"
            name="date"
            defaultValue={date}
            max={todayISO()}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          ดูรายงาน
        </button>
      </form>

      {/* การ์ดสรุป */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">จำนวนบันทึก</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{rows.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">ผลิตได้รวม</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{fmt(totalOutput)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">ของเสียรวม</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{fmt(totalLoss)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">ชั่วโมงรวม</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{fmt(totalHours)}</p>
        </div>
      </div>

      {/* ตาราง */}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">งาน</th>
                <th className="px-3 py-2 font-medium">ผลิตภัณฑ์</th>
                <th className="px-3 py-2 font-medium">สถานี</th>
                <th className="px-3 py-2 text-right font-medium">ตั้งต้น</th>
                <th className="px-3 py-2 text-right font-medium">ผลิตได้</th>
                <th className="px-3 py-2 text-right font-medium">ของเสีย</th>
                <th className="px-3 py-2 text-right font-medium">ชม.</th>
                <th className="px-3 py-2 font-medium">ผู้บันทึก</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {r.job_no ? (
                      <Link
                        href={`/board/${encodeURIComponent(r.job_no)}`}
                        className="text-primary hover:underline"
                      >
                        {r.job_no}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">{r.product_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {STATION_ICON[r.station]} {STATION_LABEL[r.station] ?? r.station}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.input_qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.output_qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.loss_qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.hours ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {r.operator_name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          ไม่มีบันทึกผลผลิตของวันที่ {date}
        </p>
      )}
    </div>
  );
}
