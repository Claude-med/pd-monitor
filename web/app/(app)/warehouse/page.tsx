import Link from "next/link";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import {
  currentMonthTh,
  inMonth,
  listFgJobs,
  sumByUnit,
} from "@/lib/data/fg";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { WarehouseView, type FgViewMode } from "./warehouse-view";

export const metadata = { title: "คลัง / FG — PD Monitor" };

const MONTH_RE = /^\d{4}-\d{2}$/;

/** "2026-09" → "ก.ย. 2569" */
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

function UnitTotals({ rows }: { rows: { unit: string; qty: number }[] }) {
  if (rows.length === 0) return <p className="mt-1 text-2xl font-bold">0</p>;
  return (
    <div className="mt-1 space-y-0.5">
      {rows.map((r) => (
        <p key={r.unit} className="text-lg font-bold leading-tight">
          {r.qty.toLocaleString("th-TH")}{" "}
          <span className="text-sm font-medium text-muted-foreground">{r.unit}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * คลัง / FG — Part G ก้อน 5
 * เดิมการ์ดนับสะสมตั้งแต่เปิดระบบ + บวกยอดข้ามหน่วย ⇒ ตัวเลขโตไม่หยุดและไม่มีความหมาย
 * ตอนนี้: "รอรับเข้า" + "คงคลังตอนนี้" เป็นยอดปัจจุบัน · "รับเข้า/จ่ายออก" ดูรายเดือน · ยอดแยกตามหน่วย
 * รายการด้านล่างค่าเริ่มต้นแสดงเฉพาะ "ของที่ยังอยู่ในคลัง" — จ่ายออกหมดแล้วหายจากหน้านี้เอง
 */
export default async function WarehousePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : currentMonthTh();
  const view: FgViewMode =
    sp.view === "month" || sp.view === "all" ? sp.view : "stock";

  const profile = await getProfile();
  const canManage = hasAnyRole(profile?.roles ?? [], ["warehouse", "manager"]);
  const jobs = await listFgJobs();

  const pending = jobs.filter((j) => !j.fg);
  const receivedInMonth = sumByUnit(
    jobs
      .filter((j) => j.fg && inMonth(j.fg.received_date, month))
      .map((j) => ({ unit: j.fg!.unit, qty: j.fg!.qty })),
  );
  const dispatchedInMonth = sumByUnit(
    jobs.flatMap((j) =>
      j.fg
        ? j.dispatches
            .filter((d) => inMonth(d.dispatched_date, month))
            .map((d) => ({ unit: j.fg!.unit, qty: d.qty }))
        : [],
    ),
  );
  const onHand = sumByUnit(
    jobs.filter((j) => j.fg).map((j) => ({ unit: j.fg!.unit, qty: j.on_hand })),
  );
  const lotsInStock = jobs.filter((j) => j.fg && j.on_hand > 0).length;

  const shown =
    view === "all"
      ? jobs
      : view === "month"
        ? jobs.filter(
            (j) =>
              j.fg &&
              (inMonth(j.fg.received_date, month) ||
                j.dispatches.some((d) => inMonth(d.dispatched_date, month))),
          )
        : jobs.filter((j) => !j.fg || j.on_hand > 0);

  const tab = (v: FgViewMode, label: string) => (
    <Link
      href={`/warehouse?month=${month}&view=${v}`}
      className={`rounded-md px-3 py-1.5 text-sm ${
        view === v
          ? "bg-primary text-primary-foreground"
          : "border hover:bg-accent"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["jobs", "fg_inventory", "fg_dispatches"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">คลัง / FG</h1>
        <p className="text-sm text-muted-foreground">
          สินค้าสำเร็จรูป (Finished Goods) · รับงานที่ผ่าน QA เข้าคลัง · จ่ายออก · ยอดคงคลัง
          {canManage ? "" : " (ดูอย่างเดียว — รับเข้า/จ่ายออกได้เฉพาะฝ่ายคลัง/ผู้บริหาร)"}
        </p>
      </div>

      {/* เลือกเดือน — ฟอร์ม GET ธรรมดา (ไม่ต้องใช้ JS) */}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            เดือนที่ดูยอดรับเข้า / จ่ายออก
          </label>
          <input
            type="month"
            name="month"
            defaultValue={month}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <input type="hidden" name="view" value={view} />
        <button
          type="submit"
          className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          ดู
        </button>
        {month !== currentMonthTh() && (
          <Link
            href={`/warehouse?view=${view}`}
            className="px-2 py-2 text-sm text-muted-foreground hover:underline"
          >
            กลับเดือนนี้
          </Link>
        )}
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">รอรับเข้าคลัง (ค้างทั้งหมด)</p>
          <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {pending.length} <span className="text-sm font-medium">งาน</span>
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">รับเข้า · {monthLabel(month)}</p>
          <UnitTotals rows={receivedInMonth} />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">จ่ายออก · {monthLabel(month)}</p>
          <UnitTotals rows={dispatchedInMonth} />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            คงคลังตอนนี้ · {lotsInStock} รายการ
          </p>
          <UnitTotals rows={onHand} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tab("stock", "ของในคลัง + รอรับเข้า")}
        {tab("month", `เคลื่อนไหว ${monthLabel(month)}`)}
        {tab("all", "ทั้งหมด")}
      </div>

      <WarehouseView jobs={shown} canManage={canManage} mode={view} />
    </div>
  );
}
