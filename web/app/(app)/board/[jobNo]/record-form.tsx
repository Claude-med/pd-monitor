"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  validateRecord,
  WORK_SHIFTS,
  WORK_PERIODS,
  QTY_UNITS,
  type RecordFormValues,
} from "@/lib/data/production-constants";
import {
  MACHINE_STATUS_LABEL,
  MACHINE_BLOCKED_STATUSES,
  type MachineStatus,
} from "@/lib/data/machine-constants";
import type { RouteMachine } from "@/lib/data/job-routes";
import { addRecord } from "./record-actions";
import {
  newClientId,
  pendingForJob,
  removePending,
  upsertPending,
  type PendingRecord,
} from "@/lib/offline-queue";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: RecordFormValues = {
  record_date: today(),
  shift: "",
  work_period: "",
  input_qty: "",
  input_unit: "",
  output_qty: "",
  output_unit: "",
  loss_qty: "",
  loss_unit: "",
  minutes: "",
  note: "",
  machine_id: "",
  headcount: "",
};

type FieldErrors = Partial<Record<keyof RecordFormValues, string>>;

// สถานะการบันทึก
//  idle = ว่าง · saving = กำลังส่ง · retrying = เน็ตมีปัญหา กำลังลองใหม่
//  saved = สำเร็จ · queued = ค้างไว้ (รอเน็ตกลับมา/กดลองเอง)
type SaveState = "idle" | "saving" | "retrying" | "saved" | "queued";

const BACKOFF_MS = [1500, 3000, 6000]; // หน่วงก่อน retry แต่ละครั้ง (มี 3 รอบ retry)
const MAX_ATTEMPTS = BACKOFF_MS.length + 1; // = 4 (รวมครั้งแรก)

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

const numClass = (err?: string) =>
  `w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
    err ? "border-destructive" : "border-input"
  }`;

/**
 * ช่องยอด + dropdown หน่วยต่อท้าย (Part C.3 ก้อน 5)
 * อยู่นอก RecordForm โดยตั้งใจ — ประกาศ component ระหว่าง render จะสร้าง type ใหม่ทุกครั้ง
 * ทำให้ React unmount/mount ช่อง input ใหม่ทุกตัวอักษรที่พิมพ์ (โฟกัสหลุด)
 */
function QtyField({
  label,
  required,
  qty,
  unit,
  onQty,
  onUnit,
  err,
}: {
  label: string;
  required?: boolean;
  qty: string;
  unit: string;
  onQty: (val: string) => void;
  onUnit: (val: string) => void;
  err?: string;
}) {
  return (
    <div>
      <label className={labelClass}>
        {label} {required && "*"}
      </label>
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={qty}
          onChange={(e) => onQty(e.target.value)}
          className={numClass(err)}
        />
        <select
          value={unit}
          onChange={(e) => onUnit(e.target.value)}
          className="w-28 shrink-0 rounded-md border border-input bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">หน่วย</option>
          {QTY_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}

/**
 * ฟอร์มบันทึกผลผลิตรายวัน — Part C.3 ก้อน 5
 *
 * ตัดช่อง "สถานีผลิต" ออกแล้ว: ขั้นตอนมาจากแท็บที่เลือกอยู่ (jobRouteId)
 * เครื่องจักรเลือกจาก "เครื่องของขั้นตอนนี้" ที่ผูกไว้ (0061) ไม่ใช่ทะเบียนเครื่องทั้งหมด
 */
export function RecordForm({
  jobId,
  jobNo,
  jobRouteId,
  stationName,
  machines,
}: {
  jobId: string;
  jobNo: string;
  jobRouteId: string;
  stationName: string;
  machines: RouteMachine[];
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<RecordFormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<PendingRecord[]>([]);
  const router = useRouter();

  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const refreshPending = useCallback(() => {
    setPending(pendingForJob(jobId));
  }, [jobId]);

  function set<K extends keyof RecordFormValues>(k: K, val: string) {
    setV((cur) => ({ ...cur, [k]: val }));
    if (saveState === "saved") setSaveState("idle");
  }

  const busy = saveState === "saving" || saveState === "retrying";

  function recordSummary(r: PendingRecord): string {
    return `ต้องการ ${r.values.input_qty || "—"} / ผลิตได้ ${
      r.values.output_qty || "—"
    }`;
  }

  // เครื่องที่เลือกได้ = เครื่องของขั้นตอนนี้ที่ไม่อยู่สถานะซ่อม/ถึงกำหนดสอบเทียบ
  const machineOptions = machines.filter(
    (m) => !MACHINE_BLOCKED_STATUSES.has(m.status as MachineStatus),
  );
  const blockedMachines = machines.filter((m) =>
    MACHINE_BLOCKED_STATUSES.has(m.status as MachineStatus),
  );

  // พยายามบันทึก 1 รายการแบบทนเน็ต (retry + backoff)
  // คืน true ถ้าสำเร็จ · false ถ้าค้าง (เน็ตยังมีปัญหา) · "permanent" ถ้าข้อมูล/สิทธิ์ผิด
  const trySave = useCallback(
    async (rec: PendingRecord): Promise<boolean | "permanent"> => {
      upsertPending(rec); // เก็บลงเครื่องทันที (รีโหลด/ปิดจอก็ไม่หาย)
      refreshPending();
      for (let a = 1; a <= MAX_ATTEMPTS; a++) {
        if (cancelled.current) return false;
        setAttempt(a);
        setSaveState(a === 1 ? "saving" : "retrying");
        try {
          const res = await addRecord(
            rec.jobId,
            rec.jobNo,
            rec.jobRouteId,
            rec.values,
            rec.clientId,
          );
          if (res?.ok) {
            removePending(rec.clientId);
            refreshPending();
            return true;
          }
          // ผิดแบบถาวร (validation/สิทธิ์/สถานะงาน) — retry ไม่ช่วย
          removePending(rec.clientId);
          refreshPending();
          if (res?.fieldErrors) setFieldErrors(res.fieldErrors);
          setFormError(res?.error ?? "บันทึกไม่สำเร็จ");
          return "permanent";
        } catch {
          // เน็ต/เซิร์ฟเวอร์ล่มชั่วคราว → หน่วงแล้วลองใหม่ (ยังไม่ถึงรอบสุดท้าย)
          if (a < MAX_ATTEMPTS) {
            await delay(BACKOFF_MS[a - 1]);
            continue;
          }
        }
      }
      return false; // ครบรอบแล้วยังไม่สำเร็จ → ค้างไว้ในคิว
    },
    [refreshPending],
  );

  async function submit() {
    setFormError(null);
    // validate ฝั่ง client ก่อน (feedback ทันที)
    const { errors, parsed } = validateRecord(v);
    setFieldErrors(errors);
    if (!parsed) return;

    const rec: PendingRecord = {
      clientId: newClientId(),
      jobId,
      jobNo,
      jobRouteId,
      values: v,
      queuedAt: new Date().toISOString(),
    };

    const result = await trySave(rec);
    if (cancelled.current) return;

    // คงค่าที่มักซ้ำกันทุกรอบไว้ (วันที่/กะ/ช่วงเวลา/เครื่อง/หน่วย) ให้กรอกรอบต่อไปเร็วขึ้น
    const keep: RecordFormValues = {
      ...EMPTY,
      record_date: v.record_date,
      shift: v.shift,
      work_period: v.work_period,
      machine_id: v.machine_id,
      input_unit: v.input_unit,
      output_unit: v.output_unit,
      loss_unit: v.loss_unit,
    };

    if (result === true) {
      setSaveState("saved");
      setV(keep);
      setFieldErrors({});
      router.refresh();
    } else if (result === "permanent") {
      setSaveState("idle");
    } else {
      // ค้างไว้ — ข้อมูลปลอดภัยในคิว จะลองใหม่เมื่อเน็ตกลับมา
      setSaveState("queued");
      setV(keep);
      setFieldErrors({});
    }
  }

  // ลองบันทึกรายการที่ค้างทั้งหมดของงานนี้ (เรียกตอนเน็ตกลับมา/กดเอง/เปิดหน้า)
  const retryQueued = useCallback(async () => {
    const list = pendingForJob(jobId);
    if (list.length === 0) return;
    let anyOk = false;
    for (const rec of list) {
      if (cancelled.current) return;
      try {
        const res = await addRecord(
          rec.jobId,
          rec.jobNo,
          rec.jobRouteId,
          rec.values,
          rec.clientId,
        );
        if (res?.ok) {
          removePending(rec.clientId);
          anyOk = true;
        } else if (res?.error) {
          // ผิดถาวร — เอาออกจากคิว (เก็บไว้ก็ไม่สำเร็จ) แล้วแจ้ง
          removePending(rec.clientId);
          setFormError(`รายการค้างบันทึกไม่ได้: ${res.error}`);
          anyOk = true;
        }
      } catch {
        // ยังเน็ตไม่ดี — ปล่อยค้างไว้รอบหน้า
      }
    }
    refreshPending();
    if (anyOk && !cancelled.current) {
      if (pendingForJob(jobId).length === 0) setSaveState("idle");
      router.refresh();
    }
  }, [jobId, refreshPending, router]);

  // เปิดหน้า: โหลดคิวค้าง + ลองบันทึกถ้าออนไลน์ · ฟัง event เน็ตกลับมา
  useEffect(() => {
    // ตั้งใจ setState ตอน mount เพื่อโหลดคิว offline ที่ค้างจาก localStorage ขึ้นมาแสดง
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPending();
    if (typeof navigator !== "undefined" && navigator.onLine) {
      void retryQueued();
    }
    const onOnline = () => void retryQueued();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refreshPending, retryQueued]);

  function discardPending(clientId: string) {
    if (!window.confirm("ทิ้งรายการที่ค้างนี้? (ข้อมูลที่กรอกจะหายถาวร)")) return;
    removePending(clientId);
    refreshPending();
  }

  // แบนเนอร์รายการค้าง (โชว์เสมอ แม้ฟอร์มปิดอยู่)
  const pendingBanner = pending.length > 0 && (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">
        ⏳ มีรายการที่ยังบันทึกไม่สำเร็จ {pending.length} รายการ (เก็บไว้ในเครื่องแล้ว ไม่หาย)
      </p>
      <ul className="space-y-1">
        {pending.map((r) => (
          <li
            key={r.clientId}
            className="flex items-center justify-between gap-2 text-xs text-amber-800"
          >
            <span className="truncate">{recordSummary(r)}</span>
            <button
              type="button"
              onClick={() => discardPending(r.clientId)}
              className="shrink-0 rounded border border-amber-400 px-2 py-0.5 text-amber-700 hover:bg-amber-100"
            >
              ทิ้ง
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void retryQueued()}
        className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
      >
        ลองบันทึกอีกครั้ง
      </button>
    </div>
  );

  if (!open) {
    return (
      <div className="space-y-3">
        {pendingBanner}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          + บันทึกผลผลิต
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pendingBanner}
      <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
        <p className="text-xs text-muted-foreground">
          บันทึกของขั้นตอน <span className="font-medium">{stationName}</span>
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>วันที่บันทึก *</label>
            <input
              type="date"
              value={v.record_date}
              max={today()}
              onChange={(e) => set("record_date", e.target.value)}
              className={numClass(fieldErrors.record_date)}
            />
            {fieldErrors.record_date && (
              <p className="mt-1 text-xs text-destructive">
                {fieldErrors.record_date}
              </p>
            )}
          </div>
          <div>
            <label className={labelClass}>กะ</label>
            <select
              value={v.shift}
              onChange={(e) => set("shift", e.target.value)}
              className={inputClass}
            >
              <option value="">— ไม่ระบุ —</option>
              {WORK_SHIFTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>ช่วงเวลาปกติ / OT</label>
            <select
              value={v.work_period}
              onChange={(e) => set("work_period", e.target.value)}
              className={inputClass}
            >
              <option value="">— ไม่ระบุ —</option>
              {WORK_PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>เครื่องจักรที่ใช้</label>
          <select
            value={v.machine_id}
            onChange={(e) => set("machine_id", e.target.value)}
            className={inputClass}
          >
            <option value="">— ไม่ระบุ —</option>
            {machineOptions.map((m) => (
              <option key={m.machine_id} value={m.machine_id}>
                {m.code} · {m.name}
              </option>
            ))}
          </select>
          {machines.length === 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              ยังไม่ได้เลือกเครื่องจักรของขั้นตอนนี้ — เลือกที่การ์ดด้านบนก่อน
            </p>
          )}
          {blockedMachines.length > 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              ไม่แสดง{" "}
              {blockedMachines
                .map((m) => `${m.code} (${MACHINE_STATUS_LABEL[m.status]})`)
                .join(" · ")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <QtyField
            label="ยอดที่ต้องการ"
            required
            qty={v.input_qty}
            unit={v.input_unit}
            onQty={(val) => set("input_qty", val)}
            onUnit={(val) => set("input_unit", val)}
            err={fieldErrors.input_qty}
          />
          <QtyField
            label="ยอดผลิตได้ (output)"
            required
            qty={v.output_qty}
            unit={v.output_unit}
            onQty={(val) => set("output_qty", val)}
            onUnit={(val) => set("output_unit", val)}
            err={fieldErrors.output_qty}
          />
          <QtyField
            label="ของเสีย (loss)"
            qty={v.loss_qty}
            unit={v.loss_unit}
            onQty={(val) => set("loss_qty", val)}
            onUnit={(val) => set("loss_unit", val)}
            err={fieldErrors.loss_qty}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>นาทีทำงาน (0–1440)</label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              max="1440"
              value={v.minutes}
              onChange={(e) => set("minutes", e.target.value)}
              className={numClass(fieldErrors.minutes)}
            />
            {fieldErrors.minutes && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.minutes}</p>
            )}
          </div>
          <div>
            <label className={labelClass}>จำนวนคน</label>
            <input
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              value={v.headcount}
              onChange={(e) => set("headcount", e.target.value)}
              className={numClass(fieldErrors.headcount)}
            />
            {fieldErrors.headcount && (
              <p className="mt-1 text-xs text-destructive">
                {fieldErrors.headcount}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className={labelClass}>หมายเหตุ</label>
          <input
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="บันทึกเพิ่มเติม (ถ้ามี)"
            className={inputClass}
          />
        </div>

        {formError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        {saveState === "saved" && (
          <p className="rounded-md bg-green-100 px-3 py-2 text-sm text-green-800">
            บันทึกแล้ว ✓
          </p>
        )}
        {saveState === "retrying" && (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-800">
            เน็ตมีปัญหา — กำลังลองบันทึกใหม่อัตโนมัติ (ครั้งที่ {attempt}/{MAX_ATTEMPTS})…
          </p>
        )}
        {saveState === "queued" && (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-800">
            เน็ตยังไม่กลับมา — เก็บรายการไว้ในเครื่องแล้ว จะบันทึกให้อัตโนมัติเมื่อเน็ตกลับมา (ดูแถบด้านบน)
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saveState === "saving"
              ? "กำลังบันทึก…"
              : saveState === "retrying"
                ? "กำลังลองใหม่…"
                : "บันทึก"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setV(EMPTY);
              setFieldErrors({});
              setFormError(null);
              setSaveState("idle");
            }}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
