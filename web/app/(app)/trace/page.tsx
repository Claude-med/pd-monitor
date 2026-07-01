import Link from "next/link";
import { searchTrace, type JobTrace } from "@/lib/data/genealogy";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/data/job-constants";
import { RealtimeRefresh } from "@/components/realtime-refresh";

export const metadata = { title: "ไล่ย้อนล็อต (Traceability) — PD Monitor" };

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("th-TH");
}

function statusBadge(status: string) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: STATUS_COLOR[status] ?? "#64748b" }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function JobTraceCard({ t }: { t: JobTrace }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      {/* หัว: งาน + FG */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/board/${encodeURIComponent(t.job_no)}`}
          className="font-semibold text-primary hover:underline"
        >
          {t.job_no}
        </Link>
        {statusBadge(t.status)}
        {t.deviation_open > 0 && (
          <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
            ⚠️ deviation เปิดค้าง {t.deviation_open}
          </span>
        )}
        <Link
          href={`/board/${encodeURIComponent(t.job_no)}/ebr`}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          ดู eBR →
        </Link>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <span className="text-xs text-muted-foreground">ผลิตภัณฑ์</span>
          <p className="font-medium">{t.product_name ?? "—"}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">ลูกค้า</span>
          <p className="font-medium">{t.customer ?? "—"}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">ออเดอร์</span>
          <p className="font-medium">{t.order_no ?? "—"}</p>
        </div>
      </div>

      {/* ผังสายโซ่: RM lots → JOB → FG lot */}
      <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {/* วัตถุดิบที่ใช้ */}
        <div className="flex-1 rounded-lg border border-dashed bg-muted/20 p-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            วัตถุดิบที่เบิกใช้ (RM/PM lot)
          </p>
          {t.rm_lots.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {t.rm_lots.map((m) => (
                <li key={m.requisition_id} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{m.material_code}</span>
                  <span className="text-muted-foreground">{m.material_name}</span>
                  <span className="rounded bg-background px-1.5 py-0.5 text-xs">
                    ล็อต {m.lot_no}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {fmt(m.qty)} {m.unit}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">— ยังไม่มีการเบิก</p>
          )}
        </div>

        <div className="flex items-center justify-center text-muted-foreground">→</div>

        {/* FG ที่ออก */}
        <div className="flex-1 rounded-lg border bg-emerald-500/5 p-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            ผลิตออกมา (FG lot)
          </p>
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-xs text-muted-foreground">ล็อตผลิต:</span>{" "}
              <span className="font-medium">{t.fg_lot_no ?? "—"}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              ผลิต {t.mfg_date ?? "—"} · หมดอายุ {t.exp_date ?? "—"}
            </p>
            {t.fg_qty != null && (
              <p className="text-xs">
                รับเข้าคลัง {fmt(t.fg_qty)} {t.fg_unit ?? ""}
                {t.fg_location ? ` · ${t.fg_location}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function TracePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const result = q ? await searchTrace(q) : null;
  const nothing =
    result && result.forward.length === 0 && result.reverse.length === 0;

  return (
    <div className="space-y-6">
      <RealtimeRefresh tables={["jobs", "fg_inventory", "material_requisitions"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ไล่ย้อนล็อต (Traceability)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ค้นด้วย <b>เลขงาน</b> หรือ <b>เลขล็อต</b> (ล็อตผลิต FG หรือล็อตวัตถุดิบ RM)
          เพื่อไล่สายโซ่ <b>วัตถุดิบ → งาน → FG</b> และย้อนกลับ (เผื่อเรียกคืน/ร้องเรียน)
        </p>
      </div>

      {/* ช่องค้นหา */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            เลขงาน / เลขล็อต
          </label>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="เช่น JOB-2569-0001 หรือ L1 / LOT-A"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          ค้นหา
        </button>
      </form>

      {!q && (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          พิมพ์เลขงานหรือเลขล็อตด้านบนเพื่อเริ่มไล่ย้อน
        </p>
      )}

      {nothing && (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          ไม่พบงาน/ล็อตที่ตรงกับ &quot;{q}&quot;
        </p>
      )}

      {/* ขาไปข้างหน้า: งาน/FG ที่ตรง → วัตถุดิบที่ใช้ */}
      {result && result.forward.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">
            ผลจากงาน / ล็อตผลิต ({result.forward.length})
          </h2>
          {result.forward.map((t) => (
            <JobTraceCard key={t.job_id} t={t} />
          ))}
        </section>
      )}

      {/* ขาย้อนกลับ: ล็อตวัตถุดิบ → งานที่ใช้ (recall) */}
      {result && result.reverse.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-semibold">ย้อนจากล็อตวัตถุดิบ — งานที่ใช้ล็อตนี้ (เผื่อเรียกคืน)</h2>
          {result.reverse.map((rev) => (
            <div key={rev.material_lot_id} className="space-y-2">
              <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm">
                <span className="font-medium">{rev.material_code}</span>{" "}
                {rev.material_name} · ล็อต <b>{rev.lot_no}</b> — ใช้ใน {rev.jobs.length} งาน
              </div>
              {rev.jobs.length > 0 ? (
                rev.jobs.map((t) => <JobTraceCard key={t.job_id} t={t} />)
              ) : (
                <p className="px-3 text-sm text-muted-foreground">
                  ล็อตนี้ยังไม่ถูกเบิกใช้ในงานใด
                </p>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
