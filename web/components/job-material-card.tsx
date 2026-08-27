"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  MATERIAL_READY_STATUSES,
  MATERIAL_TYPE_COLOR,
  MATERIAL_TYPE_SHORT,
  READY_STATUS_COLOR,
  READY_STATUS_LABEL,
  type MaterialReadyStatus,
} from "@/lib/data/job-material-constants";
import type { JobMaterialRow } from "@/lib/data/job-materials";
import { setJobMaterialStatus } from "@/lib/actions/job-materials";
// ⚠️ formatQty ต้อง import จาก lib/format เท่านั้น — ห้ามประกาศ/re-export ในไฟล์ "use client" นี้
//    ไม่งั้นฝั่ง server (เช่น /trace) เรียกแล้ว throw (ดูคอมเมนต์ที่ lib/format.ts)
import { fmtDateTime, formatQty } from "@/lib/format";

/**
 * การ์ด "รายการเบิกวัตถุดิบ/บรรจุภัณฑ์" 1 ใบ (Part C.2)
 *
 * ใช้ร่วมกัน 2 หน้า — หน้ารายละเอียดงาน และหน้ารวมของฝ่ายคลัง
 * จึงอยู่ใน components/ ไม่ใช่โฟลเดอร์ route (ห้ามก็อปการ์ดไว้ 2 ชุด
 * ระบบเบิกเดิมเขียนการ์ดมือถือ + ตารางจอกว้างซ้ำกันในไฟล์เดียว 390 บรรทัด)
 */

/** ชิปประเภท RM / PM */
export function MaterialTypeBadge({ type }: { type: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
      style={{ backgroundColor: MATERIAL_TYPE_COLOR[type] ?? "#64748b" }}
    >
      {MATERIAL_TYPE_SHORT[type] ?? type}
    </span>
  );
}

/** ป้ายสถานะแบบอ่านอย่างเดียว — คนที่ไม่ใช่ฝ่ายคลังเห็นอันนี้ */
export function ReadyStatusBadge({ status }: { status: string }) {
  return (
    <span
      className="rounded px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: READY_STATUS_COLOR[status] ?? "#64748b" }}
    >
      {READY_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/**
 * ป้ายสถานะที่ "กดครั้งเดียวกางเลือกได้เลย" — เห็นเฉพาะฝ่ายคลัง/ผู้บริหาร
 * (แพทเทิร์นเดียวกับ MachineStatusPicker ในหน้าเครื่องจักร 0052)
 */
export function ReadyStatusPicker({
  id,
  jobNo,
  status,
}: {
  id: string;
  jobNo: string;
  status: MaterialReadyStatus;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function pick(next: MaterialReadyStatus) {
    if (next === status || pending) return;
    setError(null);
    start(async () => {
      const res = await setJobMaterialStatus(id, jobNo, next);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <span className="relative inline-flex items-center">
        <select
          value={status}
          disabled={pending}
          onChange={(e) => pick(e.target.value as MaterialReadyStatus)}
          aria-label="สถานะความพร้อมของวัตถุดิบ/บรรจุภัณฑ์"
          className="cursor-pointer appearance-none rounded py-0.5 pl-2 pr-6 text-xs font-medium text-white outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          style={{ backgroundColor: READY_STATUS_COLOR[status] ?? "#64748b" }}
        >
          {MATERIAL_READY_STATUSES.map((s) => (
            // ⚠️ ต้องกำหนดสีพื้น/สีตัวอักษรของ option เอง ไม่งั้นบางเบราว์เซอร์
            //    ลากสีพื้นของ select ไปทาบรายการจนอ่านไม่ออก
            <option key={s.key} value={s.key} className="bg-background text-foreground">
              {s.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 text-[9px] text-white"
        >
          ▼
        </span>
      </span>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

export function JobMaterialCard({
  item,
  jobNo,
  canSetStatus,
  headerExtra,
  actions,
}: {
  item: JobMaterialRow;
  jobNo: string;
  /** ⚠️ ต้องเป็นสิทธิ์กดสถานะล้วน ๆ — อย่าเผลอ or กับสิทธิ์แก้ไข
   *  ฝ่ายผลิตต้อง "เห็นสถานะแต่กดไม่ได้" */
  canSetStatus: boolean;
  headerExtra?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      {headerExtra}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <MaterialTypeBadge type={item.item_type} />
            <span className="font-medium break-words">{item.item_name}</span>
          </div>
          <p className="mt-1 text-sm tabular-nums text-muted-foreground">
            {formatQty(item.qty, item.qty_unit)}
          </p>
        </div>
        {canSetStatus ? (
          <ReadyStatusPicker
            id={item.id}
            jobNo={jobNo}
            status={item.status}
          />
        ) : (
          <ReadyStatusBadge status={item.status} />
        )}
      </div>

      {item.note && (
        <p className="mt-1.5 text-xs text-muted-foreground">📝 {item.note}</p>
      )}

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        บันทึกโดย {item.created_by_name ?? "—"}
        {item.status === "ready" && item.status_changed_at && (
          <>
            {" · "}พร้อม โดย {item.status_changed_by_name ?? "—"} เมื่อ{" "}
            {fmtDateTime(item.status_changed_at)}
          </>
        )}
      </p>

      {actions && <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  );
}
