import Link from "next/link";
import { getProfile } from "@/lib/auth/dal";
import { canSeeCost } from "@/lib/data/role-access";
import {
  getDashboardData,
  DEFAULT_LABOR_RATE,
  type PendingOrderCounts,
} from "@/lib/data/dashboard";
import { STATUS_COLOR } from "@/lib/data/job-constants";
import { RealtimeRefresh } from "@/components/realtime-refresh";

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

function StatCard({ card, value }: { card: Card; value: number }) {
  return (
    <Link
      href={card.href}
      title={card.hint}
      className="block rounded-lg border border-l-4 bg-card p-3 transition-colors hover:bg-accent/50"
      style={{ borderLeftColor: card.color }}
    >
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{card.label}</p>
    </Link>
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
  searchParams: Promise<{ from?: string; to?: string; rate?: string }>;
}) {
  const profile = await getProfile();
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

  const d = await getDashboardData(from, to);
  const c = d.counts;
  const dlCost = d.totalPersonHours * rate;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* กดรับเข้าคลังแล้วการ์ด "รอเข้าคลัง / เข้าคลังแล้ว" ต้องขยับเอง → ต้องฟัง fg_inventory ด้วย */}
      <RealtimeRefresh
        tables={["jobs", "production_records", "fg_inventory"]}
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
              = Plan + WIP · งานที่ยังไม่เข้าคลัง
            </p>
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
                <StatCard key={card.key} card={card} value={c[card.key]} />
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
                <StatCard key={card.key} card={card} value={c[card.key]} />
              ))}
            </div>
          </div>
        </div>

        {/* งานที่จบแล้ว + งานติดปัญหา — อยู่นอก Pending Order โดยตั้งใจ */}
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3 text-sm">
          <Link
            href="/warehouse"
            className="rounded-md border px-3 py-1.5 hover:bg-accent"
          >
            ✅ เข้าคลังแล้ว{" "}
            <span className="font-semibold tabular-nums">{c.inStock}</span>
          </Link>
          {d.problemCount > 0 && (
            <Link
              href="/board"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-destructive hover:bg-destructive/20"
            >
              ⚠️ ติดปัญหา{" "}
              <span className="font-semibold tabular-nums">
                {d.problemCount}
              </span>
            </Link>
          )}
        </div>
      </section>

      {/* ตัวกรองช่วงวันที่ (+ อัตราค่าแรง สำหรับผู้บริหาร/บัญชีต้นทุน)
          ⚠️ มีผลเฉพาะบล็อกด้านล่าง — Pending Order ด้านบนเป็นภาพ ณ ปัจจุบันเสมอ */}
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
        <p className="mt-2 text-xs text-muted-foreground">
          * ไม่นับบันทึกผลผลิตที่หัวหน้าตีกลับ (ไม่อนุมัติ)
        </p>
      </div>

      {/* ต้นทุนค่าแรง (DL cost) — ผู้บริหาร + บัญชีต้นทุน (COST) */}
      {showCost && (
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
              = {fmt(d.totalPersonHours)} คน-ชม. × {fmt(rate)} ฿/ชม.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">สถานี</th>
                    <th className="px-3 py-2 text-right font-medium">ชม.</th>
                    <th className="px-3 py-2 text-right font-medium">คน-ชม.</th>
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
                        {fmt(s.output)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(s.loss)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        ฿{fmtBaht(s.personHours * rate)}
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
              * ค่าแรงคิดจาก คน-ชม. (ชั่วโมง × จำนวนคน) × อัตราที่ตั้ง — ไม่ระบุจำนวนคน = คิด 1 คน (ปรับช่อง
              &ldquo;ค่าแรง&rdquo; ด้านบนได้) — ใช้ประเมินต้นทุนเบื้องต้น
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
