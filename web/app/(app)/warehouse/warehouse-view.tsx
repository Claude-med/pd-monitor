"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FgJob } from "@/lib/data/fg";
import { receiveFg } from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function WarehouseView({
  jobs,
  canManage,
}: {
  jobs: FgJob[];
  canManage: boolean;
}) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        ยังไม่มีงานที่ถึงสถานะ FG — งานจะขึ้นที่นี่หลัง QA ปล่อยผ่าน
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
  const [editing, setEditing] = useState(false);
  const received = !!job.fg;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/board/${job.job_no}`}
              className="font-medium hover:underline"
            >
              {job.job_no}
            </Link>
            <span className="truncate text-sm text-muted-foreground">
              {job.product_name ?? "—"}
            </span>
            {received ? (
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
                {job.fg!.qty.toLocaleString("th-TH")} {job.fg!.unit}
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
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing((s) => !s)}
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
          >
            {editing ? "ปิด" : received ? "แก้คลัง" : "รับเข้าคลัง"}
          </button>
        )}
      </div>

      {canManage && editing && (
        <div className="mt-3 border-t pt-3">
          <FgForm job={job} onDone={() => setEditing(false)} />
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
