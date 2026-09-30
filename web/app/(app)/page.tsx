import Link from "next/link";
import { getProfile } from "@/lib/auth/dal";
import { canSeeCost } from "@/lib/data/role-access";
import {
  getDashboardData,
  getLaborByJob,
  laborCost,
  DEFAULT_LABOR_RATE,
  DEFAULT_OT_MULTIPLIER,
  type JobLabor,
  type PendingOrderCounts,
} from "@/lib/data/dashboard";
import { STATUS_COLOR } from "@/lib/data/job-constants";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { listCompanies } from "@/lib/data/companies";

/**
 * การ์ดทั้งหมดของบล็อก Pending Order
 * label/สี อยู่ที่นี่ที่เดียว · ตัวเลขมาจาก dashboard_job_counts() (0081) ห้ามคำนวณซ้ำ
 *
 * href = ลิงก์ไปหน้าที่เห็น "งานชุดนั้นจริง ๆ" — บอร์ดงานรับ ?status= จาก URL (board/page.tsx)
 * ⓘ บอร์ดกรองได้แค่ระดับ status (enum) → การ์ดที่แตกย่อยกว่านั้น (Unplan/แพ็ค/รอเข้าคลัง)
 *   จะพาไปที่กลุ่มใหญ่ของมัน แล้วผู้ใช้ค่อยไล่ดูต่อ
 */
type Card = {
  key: keyof PendingOrderCounts;
  label: string;
  color: string;
  href: string;
  hint?: string;
};

const PLAN_CARDS: Card[] = [
  {
    key: "unplan",
    label: "ยังไม่ลงแผน",
    color: "#94a3b8",
    href: "/board?status=pending_announce",
    hint: "ยังไม่ลงเดือนแผนผลิต (Unplan)",
  },
  {
    key: "pendingAnnounce",
    label: "รอแจ้งผลิต",
    color: STATUS_COLOR.pending_announce,
    href: "/board?status=pending_announce",
    hint: "ลงเดือนแผนไว้แล้ว รอยืนยันแจ้งผลิต",
  },
  {
    key: "planned",
    label: "มีแผนแล้ว",
    color: STATUS_COLOR.planned,
    href: "/board?status=planned",
  },
];

const WIP_CARDS: Card[] = [
  {
    key: "producing",
    label: "ผลิต",
    color: STATUS_COLOR.in_production,
    href: "/board?status=in_production",
  },
  {
    key: "packing",
    // ไม่ใช่ค่าใน enum job_status — คำนวณจาก "บันทึกผลผลิตล่าสุดอยู่สถานีที่ติดธงบรรจุ"
    // (ตั้งธงได้ที่หน้า สูตรการผลิต → สถานี)
    label: "แพ็ค",
    color: "#fb923c",
    href: "/board?status=in_production",
    hint: "บันทึกผลผลิตล่าสุดอยู่สถานีบรรจุ",
  },
  {
    key: "qc",
    label: "QC",
    color: STATUS_COLOR.qc,
    href: "/board?status=qc",
  },
  {
    key: "qa",
    label: "QA",
    color: STATUS_COLOR.qa,
    href: "/board?status=qa",
  },
  {
    key: "awaitingFg",
    label: "รอเข้าคลัง",
    color: "#4ade80",
    href: "/board?status=finished_goods",
    hint: "QA ปล่อยผ่านแล้ว คลังยังไม่รับเข้า",
  },
];

/** ต่อ ?company= ให้ลิงก์ไปบอร์ด — บอร์ดกรองบริษัทเดียวกัน ตัวเลขจึงตรงกับการ์ด (Part I) */
function withCompany(href: string, company: string): string {
  return company
    ? `${href}${href.includes("?") ? "&" : "?"}company=${encodeURIComponent(company)}`
    : href;
}

function StatCard({
  card,
  value,
  company,
}: {
  card: Card;
  value: number;
  company: string;
}) {
  return (
    <Link
      href={withCompany(card.href, company)}
      title={card.hint}
      className="block rounded-lg border border-l-4 bg-card p-3 transition-colors hover:bg-accent/50"
      style={{ borderLeftColor: card.color }}
    >
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{card.label}</p>
    </Link>
  );
}

/**
 * "ดูรายละเอียดการคำนวณ" — ค่าแรงแตกราย Job (0103 dashboard_labor_by_job)
 * ใช้ <details> ของ HTML ล้วน (server component · ไม่ต้องมี JS ฝั่งเครื่องผู้ใช้)
 * แถวรวมต้องเท่ากับการ์ดต้นทุนเสมอ — ถ้าไม่เท่าขึ้นเตือน (ไม่ควรเกิด: เงื่อนไขกรองชุดเดียวกัน)
 */
function LaborBreakdown({
  rows,
  error,
  rate,
  otRate,
  expectedTotal,
}: {
  rows: JobLabor[];
  error: string | null;
  rate: number;
  otRate: number;
  expectedTotal: number;
}) {
  const sum = rows.reduce(
    (a, r) => ({
      records: a.records + r.recordCount,
      normal: a.normal + r.normalPersonHours,
      ot: a.ot + r.otPersonHours,
    }),
    { records: 0, normal: 0, ot: 0 },
  );
  const total = sum.normal * rate + sum.ot * otRate;
  const mismatch = !error && Math.abs(total - expectedTotal) >= 0.5;

  return (
    <details className="mt-4 rounded-lg border">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium hover:bg-accent/50">
        🧮 ดูรายละเอียดการคำนวณ (ราย Job · {rows.length} งาน)
      </summary>
      <div className="border-t p-3">
        {error ? (
          <p className="text-sm text-destructive">
            ⚠️ โหลดรายละเอียดไม่สำเร็จ: {error} (ตรวจว่ารัน migration 0103 แล้วหรือยัง)
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            ไม่มีบันทึกผลผลิตในช่วงนี้
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Job</th>
                  <th className="px-2 py-2 font-medium">ผลิตภัณฑ์</th>
                  <th className="px-2 py-2 text-right font-medium">บันทึก</th>
                  <th className="px-2 py-2 text-right font-medium">คน-ชม. ปกติ</th>
                  <th className="px-2 py-2 text-right font-medium">คน-ชม. OT</th>
                  <th className="px-2 py-2 text-right font-medium">ค่าแรงปกติ</th>
                  <th className="px-2 py-2 text-right font-medium">ค่าแรง OT</th>
                  <th className="px-2 py-2 text-right font-medium">รวม (฿)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const n = r.normalPersonHours * rate;
                  const o = r.otPersonHours * otRate;
                  return (
                    <tr key={r.jobId} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <Link
                          href={`/board/${encodeURIComponent(r.jobNo)}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.jobNo}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5">{r.productName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.recordCount}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt(r.normalPersonHours)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.otPersonHours > 0 ? fmt(r.otPersonHours) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmtBaht(n)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {o > 0 ? fmtBaht(o) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                        {fmtBaht(n + o)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="px-2 py-2" colSpan={2}>
                    รวม
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {sum.records}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {fmt(sum.normal)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {fmt(sum.ot)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {fmtBaht(sum.normal * rate)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {fmtBaht(sum.ot * otRate)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    ฿{fmtBaht(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          สูตรต่อ Job: (คน-ชม. ปกติ × {fmt(rate)} ฿) + (คน-ชม. OT × {fmt(otRate)} ฿) ·
          คน-ชม. = นาทีที่บันทึก ÷ 60 × จำนวนคน · ไม่นับบันทึกที่ถูกตีกลับ
        </p>
        {mismatch && (
          <p className="mt-1 text-xs text-destructive">
            ⚠️ ผลรวมราย Job (฿{fmtBaht(total)}) ไม่เท่ากับยอดรวมด้านบน (฿
            {fmtBaht(expectedTotal)}) — แจ้งผู้ดูแลระบบ
          </p>
        )}
      </div>
    </details>
  );
}

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
  searchParams: Promise<{
    from?: string;
    to?: string;
    rate?: string;
    otRate?: string;
    company?: string;
  }>;
}) {
  const [profile, companies] = await Promise.all([getProfile(), listCompanies()]);
  // ต้นทุนค่าแรง: เห็น/ปรับอัตราได้เฉพาะผู้บริหาร + บัญชีต้นทุน (COST)
  const showCost = canSeeCost(profile?.roles ?? []);

  const sp = await searchParams;
  const from = sp.from && ISO.test(sp.from) ? sp.from : firstOfMonthISO();
  const to = sp.to && ISO.test(sp.to) ? sp.to : todayISO();

  const parsedRate = Number(sp.rate);
  const rate =
    Number.isFinite(parsedRate) && parsedRate >= 0
      ? parsedRate
      : DEFAULT_LABOR_RATE;
  // ช่อง OT ว่าง = ค่าแรงปกติ × 1.5 (Number("") คือ 0 จึงต้องเช็กสตริงว่างเอง)
  const parsedOtRate = sp.otRate?.trim() ? Number(sp.otRate) : NaN;
  const otRateEntered = Number.isFinite(parsedOtRate) && parsedOtRate >= 0;
  const otRate = otRateEntered ? parsedOtRate : rate * DEFAULT_OT_MULTIPLIER;

  // ตัวกรองบริษัทของกล่อง Pending Order — validate กับรายชื่อจริง (ค่ามั่ว = ทุกบริษัท)
  const company = companies.some((co) => co.id === sp.company)
    ? (sp.company as string)
    : "";
  const companyCode = companies.find((co) => co.id === company)?.code ?? null;

  const [d, labor] = await Promise.all([
    getDashboardData(from, to, company || null),
    showCost ? getLaborByJob(from, to) : Promise.resolve(null),
  ]);
  const c = d.counts;
  const normalPersonHours = d.totalPersonHours - d.totalOtPersonHours;
  const dlCost = laborCost(d.totalPersonHours, d.totalOtPersonHours, rate, otRate);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* กดรับเข้าคลังแล้วการ์ด "รอเข้าคลัง / เข้าคลังแล้ว" ต้องขยับเอง → ต้องฟัง fg_inventory ด้วย */}
      <RealtimeRefresh
        tables={["jobs", "production_records", "fg_inventory", "deviations"]}
      />

      {d.loadError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          ⚠️ {d.loadError}
        </p>
      )}

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          สวัสดี {profile?.full_name ?? ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ภาพรวมงานผลิตทั้งหมด {d.totalJobs} งาน
        </p>
      </div>

      {/* ── Pending Order = Plan + WIP ── (คำสั่งผู้บริหาร · A-p03) */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground">
              Pending Order
            </h2>
            <p className="text-xs text-muted-foreground">
              = Plan + WIP · งานที่ยังไม่เข้าคลัง · <b>ภาพ ณ ตอนนี้</b> (ไม่ขึ้นกับช่วงวันที่ด้านล่าง)
              {companyCode && <> · บริษัท {companyCode}</>}
            </p>
            {/* ตัวกรองของกล่องนี้เอง (Part I) — แยกจากฟอร์มช่วงวันที่ · hidden ช่วยให้ค่าด้านล่างไม่หาย */}
            {companies.length > 0 && (
              <form method="get" className="mt-2 flex items-center gap-2">
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="to" value={to} />
                {sp.rate && <input type="hidden" name="rate" value={sp.rate} />}
                {sp.otRate && (
                  <input type="hidden" name="otRate" value={sp.otRate} />
                )}
                <select
                  name="company"
                  defaultValue={company}
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                >
                  <option value="">ทุกบริษัท</option>
                  {companies.map((co) => (
                    <option key={co.id} value={co.id}>
                      {co.code}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                >
                  กรอง
                </button>
              </form>
            )}
          </div>
          <p className="text-3xl font-bold tabular-nums">
            {c.pending}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              งาน
            </span>
          </p>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_5fr]">
          {/* Plan */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
              Plan · {c.plan}
              <span className="ml-1 font-normal">(มีแผน ยังไม่เริ่มผลิต)</span>
            </p>
            <div className="grid grid-cols-3 gap-2">
              {PLAN_CARDS.map((card) => (
                <StatCard
                  key={card.key}
                  card={card}
                  value={c[card.key]}
                  company={company}
                />
              ))}
            </div>
          </div>

          {/* WIP */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
              WIP · {c.wip}
              <span className="ml-1 font-normal">
                (เริ่มผลิตแล้ว ยังไม่เข้าคลัง)
              </span>
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {WIP_CARDS.map((card) => (
                <StatCard
                  key={card.key}
                  card={card}
                  value={c[card.key]}
                  company={company}
                />
              ))}
            </div>
          </div>
        </div>

        {/* งานมีปัญหา — นิยามเดียวกับปุ่ม "เฉพาะงานมีปัญหา" ในบอร์ด (0104 · isProblemJob)
            กดแล้วไปบอร์ดที่เปิดตัวกรองนั้น + บริษัทเดียวกัน ⇒ จำนวนงานตรงกันเป๊ะ
            "เข้าคลังแล้ว" ย้ายไปส่วนช่วงวันที่ (Part I) — ยอดสะสมทั้งหมดไม่บอกอะไรและทำให้สับสน */}
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3 text-sm">
          <Link
            href={withCompany("/board?problem=1", company)}
            className={`rounded-md border px-3 py-1.5 ${
              d.problemCount > 0
                ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "hover:bg-accent"
            }`}
            title="ติดธงปัญหา หรือมี Incident Case ที่ยังไม่ปิด (ไม่นับงานที่เข้าคลังแล้ว)"
          >
            ⚠️ งานมีปัญหา{" "}
            <span className="font-semibold tabular-nums">{d.problemCount}</span>
          </Link>
          <Link
            href={withCompany("/board?problem=1", company)}
            className={`rounded-md border px-3 py-1.5 ${
              d.incidentOpenCount > 0
                ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                : "hover:bg-accent"
            }`}
            title="จำนวนงานที่มี Incident Case ยังไม่ปิด"
          >
            🚨 งานที่ Incident ยังเปิด{" "}
            <span className="font-semibold tabular-nums">
              {d.incidentOpenCount}
            </span>
          </Link>
        </div>
      </section>

      {/* ตัวกรองช่วงวันที่ (+ อัตราค่าแรง สำหรับผู้บริหาร/บัญชีต้นทุน)
          ⚠️ มีผลเฉพาะบล็อกด้านล่าง — Pending Order ด้านบนเป็นภาพ ณ ปัจจุบันเสมอ */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        {company && <input type="hidden" name="company" value={company} />}
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
        {showCost && (
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
        {showCost && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ค่าแรง OT (฿/ชม.)
            </label>
            <input
              type="number"
              name="otRate"
              min={0}
              step="any"
              defaultValue={otRateEntered ? otRate : ""}
              placeholder={`${fmt(otRate)} (×${DEFAULT_OT_MULTIPLIER})`}
              title={`เว้นว่าง = ค่าแรงปกติ × ${DEFAULT_OT_MULTIPLIER}`}
              className="w-36 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">ชั่วโมง OT รวม</p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {fmt(d.totalOtHours)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              รวมอยู่ในชั่วโมงแรงงานแล้ว
            </p>
          </div>
          <Link
            href="/warehouse"
            className="rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <p className="text-xs text-muted-foreground">✅ รับเข้าคลัง FG</p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {d.fgReceivedInRange}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                งาน
              </span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              ตามวันที่รับเข้าในช่วงนี้
            </p>
          </Link>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          * ไม่นับบันทึกผลผลิตที่หัวหน้าตีกลับ (ไม่อนุมัติ)
        </p>
      </div>

      {/* ต้นทุนค่าแรง (DL cost) — ผู้บริหาร + บัญชีต้นทุน (COST) */}
      {showCost && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            ต้นทุนค่าแรงทางตรง (DL cost) · ปกติ {fmt(rate)} ฿/ชม. · OT{" "}
            {fmt(otRate)} ฿/ชม.
          </h2>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs text-muted-foreground">
              ต้นทุนค่าแรงรวมในช่วงที่เลือก
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              ฿{fmtBaht(dlCost)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              = ปกติ {fmt(normalPersonHours)} คน-ชม. × {fmt(rate)} ฿ (฿
              {fmtBaht(normalPersonHours * rate)}) + OT{" "}
              {fmt(d.totalOtPersonHours)} คน-ชม. × {fmt(otRate)} ฿ (฿
              {fmtBaht(d.totalOtPersonHours * otRate)})
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">สถานี</th>
                    <th className="px-3 py-2 text-right font-medium">ชม.</th>
                    <th className="px-3 py-2 text-right font-medium">คน-ชม.</th>
                    <th className="px-3 py-2 text-right font-medium">
                      คน-ชม. OT
                    </th>
                    <th className="px-3 py-2 text-right font-medium">ผลิตได้</th>
                    <th className="px-3 py-2 text-right font-medium">ของเสีย</th>
                    <th className="px-3 py-2 text-right font-medium">ค่าแรง (฿)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byStation.map((s) => (
                    <tr key={s.stationId} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2">
                        {s.stationName}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(s.hours)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(s.personHours)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.otPersonHours > 0 ? fmt(s.otPersonHours) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(s.output)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(s.loss)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        ฿
                        {fmtBaht(
                          laborCost(s.personHours, s.otPersonHours, rate, otRate),
                        )}
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
                      {fmt(d.totalPersonHours)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmt(d.totalOtPersonHours)}
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
              * ค่าแรงคิดจาก คน-ชม. (ชั่วโมง × จำนวนคน) × อัตราที่ตั้ง — ไม่ระบุจำนวนคน = คิด 1 คน ·
              บันทึกที่เลือกช่วงเวลา &ldquo;OT&rdquo; คิดด้วยค่าแรง OT (เว้นว่าง = ค่าแรงปกติ ×{" "}
              {DEFAULT_OT_MULTIPLIER}) — ใช้ประเมินต้นทุนเบื้องต้น
            </p>

            {labor && (
              <LaborBreakdown
                rows={labor.rows}
                error={labor.error}
                rate={rate}
                otRate={otRate}
                expectedTotal={dlCost}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
