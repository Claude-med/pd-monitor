"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FgDispatch, FgJob } from "@/lib/data/fg";
import { displayJobNo } from "@/lib/format";
import { addFgDispatch, deleteFgDispatch, receiveFg } from "./actions";

/** มุมมองรายการ (Part G ก้อน 5) — stock = ของในคลัง + รอรับเข้า (ค่าเริ่มต้น) */
export type FgViewMode = "stock" | "month" | "all";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function WarehouseView({
  jobs,
  canManage,
  mode,
}: {
  jobs: FgJob[];
  canManage: boolean;
  mode: FgViewMode;
}) {
  if (jobs.length === 0) {
    const msg =
      mode === "stock"
        ? "ไม่มีของค้างในคลังและไม่มีงานรอรับเข้า — งานจะขึ้นที่นี่หลัง QA ปล่อยผ่าน"
        : mode === "month"
          ? "เดือนนี้ไม่มีการรับเข้าหรือจ่ายออก"
          : "ยังไม่มีงานที่ถึงสถานะ FG — งานจะขึ้นที่นี่หลัง QA ปล่อยผ่าน";
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        {msg}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((j) => (
        <FgJobCard key={j.job_id} job={j} canManage={canManage} />
      ))}
    </div>
  );
}

function FgJobCard({ job, canManage }: { job: FgJob; canManage: boolean }) {
  const [panel, setPanel] = useState<"none" | "receive" | "dispatch">("none");
  const [showHistory, setShowHistory] = useState(false);
  const received = !!job.fg;
  const soldOut = received && job.on_hand <= 0;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/board/${job.job_no}`}
              className="font-medium hover:underline"
            >
              {displayJobNo(job.job_no)}
            </Link>
            <span className="truncate text-sm text-muted-foreground">
              {job.product_name ?? "—"}
            </span>
            {soldOut ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                จ่ายออกหมดแล้ว
              </span>
            ) : received ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                รับเข้าคลังแล้ว
              </span>
            ) : (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                รอรับเข้าคลัง
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {job.customer ? <>ลูกค้า {job.customer} · </> : null}
            {job.lot_no ? <>ล็อต {job.lot_no} · </> : null}
            สั่ง {job.order_qty?.toLocaleString("th-TH") ?? "—"} {job.order_unit ?? ""}
          </p>
          {received && (
            <p className="mt-1 text-sm">
              <span className="font-semibold">
                คงเหลือ {job.on_hand.toLocaleString("th-TH")} {job.fg!.unit}
              </span>
              <span className="text-muted-foreground">
                {" "}
                (รับเข้า {job.fg!.qty.toLocaleString("th-TH")}
                {job.dispatched_qty > 0
                  ? ` · จ่ายออก ${job.dispatched_qty.toLocaleString("th-TH")}`
                  : ""}
                )
              </span>
              {job.fg!.location ? (
                <span className="text-muted-foreground"> · ที่ {job.fg!.location}</span>
              ) : null}
              {job.fg!.received_date ? (
                <span className="text-muted-foreground"> · {job.fg!.received_date}</span>
              ) : null}
            </p>
          )}
          {received && job.fg!.note ? (
            <p className="text-xs text-muted-foreground">{job.fg!.note}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {received && job.dispatches.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory((s) => !s)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              {showHistory ? "ซ่อนประวัติ" : `ประวัติจ่ายออก (${job.dispatches.length})`}
            </button>
          )}
          {canManage && received && !soldOut && (
            <button
              type="button"
              onClick={() => setPanel((p) => (p === "dispatch" ? "none" : "dispatch"))}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              {panel === "dispatch" ? "ปิด" : "📤 จ่ายออก"}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => setPanel((p) => (p === "receive" ? "none" : "receive"))}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              {panel === "receive" ? "ปิด" : received ? "แก้คลัง" : "รับเข้าคลัง"}
            </button>
          )}
        </div>
      </div>

      {canManage && panel === "receive" && (
        <div className="mt-3 border-t pt-3">
          <FgForm job={job} onDone={() => setPanel("none")} />
        </div>
      )}
      {canManage && panel === "dispatch" && (
        <div className="mt-3 border-t pt-3">
          <DispatchForm job={job} onDone={() => setPanel("none")} />
        </div>
      )}
      {showHistory && (
        <div className="mt-3 space-y-1.5 border-t pt-3">
          {job.dispatches.map((d) => (
            <DispatchRow key={d.id} d={d} unit={job.fg?.unit ?? ""} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}

/** วันนี้ "YYYY-MM-DD" ตามเวลาไทย */
function todayTh(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

/** ฟอร์มจ่ายออก (Part G · 0097) — หน่วยตามรายการรับเข้า · จ่ายเกินคงเหลือไม่ได้ */
function DispatchForm({ job, onDone }: { job: FgJob; onDone: () => void }) {
  const [v, setV] = useState({
    qty: "",
    dispatched_date: todayTh(),
    doc_no: "",
    customer: job.customer ?? "",
    note: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof typeof v>(k: K, val: string) {
    setV((c) => ({ ...c, [k]: val }));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await addFgDispatch({ job_id: job.job_id, ...v });
      if (res.ok) {
        router.refresh();
        onDone();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            จำนวนจ่ายออก * (คงเหลือ {job.on_hand.toLocaleString("th-TH")} {job.fg?.unit})
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            max={job.on_hand}
            value={v.qty}
            onChange={(e) => set("qty", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>วันที่จ่ายออก *</label>
          <input
            type="date"
            value={v.dispatched_date}
            onChange={(e) => set("dispatched_date", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>เลขที่เอกสาร (ใบส่งของ/ใบเบิก)</label>
          <input
            value={v.doc_no}
            onChange={(e) => set("doc_no", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ส่งให้ (ลูกค้า)</label>
          <input
            value={v.customer}
            onChange={(e) => set("customer", e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>หมายเหตุ</label>
          <input
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !v.qty}
          onClick={submit}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : "บันทึกจ่ายออก"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

/** ใบจ่ายออก 1 แถว + ลบ (ต้องระบุเหตุผล · ยอดกลับเข้าคงคลัง) */
function DispatchRow({
  d,
  unit,
  canManage,
}: {
  d: FgDispatch;
  unit: string;
  canManage: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function confirmDelete() {
    setError(null);
    start(async () => {
      const res = await deleteFgDispatch(d.id, reason);
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(res.error ?? "ลบไม่สำเร็จ");
    });
  }

  return (
    <div className="rounded-md bg-muted/30 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          📤 {d.dispatched_date} ·{" "}
          <span className="font-semibold">
            {d.qty.toLocaleString("th-TH")} {unit}
          </span>
          {d.customer ? <span className="text-muted-foreground"> · {d.customer}</span> : null}
          {d.doc_no ? <span className="text-muted-foreground"> · เลขที่ {d.doc_no}</span> : null}
          {d.note ? <span className="text-muted-foreground"> · {d.note}</span> : null}
        </span>
        {canManage && !deleting && (
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="rounded-md border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10"
          >
            🗑 ลบ
          </button>
        )}
      </div>
      {deleting && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เหตุผลที่ลบ เช่น บันทึกซ้ำ"
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={pending || !reason.trim()}
            onClick={confirmDelete}
            className="rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "กำลังลบ…" : "ยืนยันลบ"}
          </button>
          <button
            type="button"
            onClick={() => setDeleting(false)}
            className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
          >
            ยกเลิก
          </button>
          {error && <p className="w-full text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function FgForm({ job, onDone }: { job: FgJob; onDone: () => void }) {
  const [v, setV] = useState({
    qty: job.fg ? String(job.fg.qty) : "",
    unit: job.fg?.unit ?? job.order_unit ?? "เม็ด",
    location: job.fg?.location ?? "",
    lot_no: job.fg?.lot_no ?? job.lot_no ?? "",
    note: job.fg?.note ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof typeof v>(k: K, val: string) {
    setV((c) => ({ ...c, [k]: val }));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await receiveFg({ job_id: job.job_id, ...v });
      if (res.ok) {
        router.refresh();
        onDone();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>จำนวนรับเข้า *</label>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={v.qty}
            onChange={(e) => set("qty", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>หน่วย</label>
          <input
            value={v.unit}
            onChange={(e) => set("unit", e.target.value)}
            placeholder="เม็ด / กล่อง / แผง"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ตำแหน่งจัดเก็บ</label>
          <input
            value={v.location}
            onChange={(e) => set("location", e.target.value)}
            placeholder="เช่น ชั้น A-01"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ล็อต</label>
          <input
            value={v.lot_no}
            onChange={(e) => set("lot_no", e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>หมายเหตุ</label>
          <input
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : job.fg ? "บันทึกการแก้ไข" : "รับเข้าคลัง"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
