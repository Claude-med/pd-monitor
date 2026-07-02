"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { validateRecord, type RecordFormValues } from "@/lib/data/station-constants";
import {
  MACHINE_BLOCKED_STATUSES,
  type MachineStatus,
} from "@/lib/data/machine-constants";
import type { Machine } from "@/lib/data/machines";
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
  station_id: "",
  record_date: today(),
  input_qty: "",
  output_qty: "",
  loss_qty: "",
  hours: "",
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

/** ตัวเลือกสถานีสำหรับฟอร์ม — id/ชื่อ + กลุ่มหลัก (enum) ไว้กรองเครื่องจักร */
export type RecordStationOption = { id: string; name: string; group: string };

export function RecordForm({
  jobId,
  jobNo,
  machines,
  stationOptions,
}: {
  jobId: string;
  jobNo: string;
  machines: Machine[];
  stationOptions: RecordStationOption[];
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

  const stationNameById = new Map(stationOptions.map((s) => [s.id, s.name]));
  // กลุ่มหลัก (enum) ของสถานีที่เลือก — ใช้กรองเครื่องจักรให้ตรงกลุ่ม
  const selectedGroup = stationOptions.find((s) => s.id === v.station_id)?.group;

  function recordSummary(r: PendingRecord): string {
    const name = stationNameById.get(r.values.station_id) ?? "—";
    return `${name} · ตั้งต้น ${r.values.input_qty || "—"} / ผลิตได้ ${
      r.values.output_qty || "—"
    }`;
  }

  // เครื่องที่เลือกได้: เปิดใช้งาน + ไม่อยู่สถานะซ่อม/ถึงกำหนดสอบเทียบ
  // + ตรงกลุ่มสถานีที่เลือก (หรือเครื่องที่ไม่ผูกสถานี) — เครื่องที่ซ่อมจะไม่ขึ้นให้เลือก
  const machineOptions = machines.filter(
    (m) =>
      m.is_active &&
      !MACHINE_BLOCKED_STATUSES.has(m.status as MachineStatus) &&
      (v.station_id === "" || m.station === selectedGroup || m.station === null),
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
          const res = await addRecord(rec.jobId, rec.jobNo, rec.values, rec.clientId);
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
      values: v,
      queuedAt: new Date().toISOString(),
    };

    const result = await trySave(rec);
    if (cancelled.current) return;

    if (result === true) {
      setSaveState("saved");
      setV({
        ...EMPTY,
        record_date: v.record_date,
        station_id: v.station_id,
        machine_id: v.machine_id,
      });
      setFieldErrors({});
      router.refresh();
    } else if (result === "permanent") {
      setSaveState("idle");
    } else {
      // ค้างไว้ — ข้อมูลปลอดภัยในคิว จะลองใหม่เมื่อเน็ตกลับมา
      setSaveState("queued");
      setV({
        ...EMPTY,
        record_date: v.record_date,
        station_id: v.station_id,
        machine_id: v.machine_id,
      });
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
        const res = await addRecord(rec.jobId, rec.jobNo, rec.values, rec.clientId);
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

  const numClass = (err?: string) =>
    `w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
      err ? "border-destructive" : "border-input"
    }`;

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* สถานี (ตาม route ของสูตร) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              สถานีผลิต *
            </label>
            {stationOptions.length > 0 ? (
              <select
                value={v.station_id}
                onChange={(e) => set("station_id", e.target.value)}
                className={numClass(fieldErrors.station_id)}
              >
                <option value="">— เลือกสถานี —</option>
                {stationOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                ยังไม่มีสถานีในระบบ — ตั้งค่าสถานี/สูตรที่หน้า “สูตรการผลิต / BOM” ก่อน
              </p>
            )}
            {fieldErrors.station_id && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.station_id}</p>
            )}
          </div>

          {/* วันที่ */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              วันที่บันทึก *
            </label>
            <input
              type="date"
              max={today()}
              value={v.record_date}
              onChange={(e) => set("record_date", e.target.value)}
              className={numClass(fieldErrors.record_date)}
            />
            {fieldErrors.record_date && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.record_date}</p>
            )}
          </div>

          {/* เครื่องจักรที่ใช้ (ออปชัน) */}
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              เครื่องจักรที่ใช้
            </label>
            <select
              value={v.machine_id}
              onChange={(e) => set("machine_id", e.target.value)}
              className={numClass()}
            >
              <option value="">— ไม่ระบุเครื่อง —</option>
              {machineOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} · {m.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {v.station_id
                ? "แสดงเฉพาะเครื่องของสถานีนี้ที่พร้อมใช้ — เครื่องที่ซ่อม/ถึงกำหนดสอบเทียบจะไม่ขึ้นให้เลือก"
                : "เลือกสถานีก่อนเพื่อกรองเครื่องให้ตรง — เครื่องที่ซ่อม/ถึงกำหนดสอบเทียบจะไม่ขึ้นให้เลือก"}
            </p>
          </div>

          {/* input */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ยอดตั้งต้น (input) *
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={v.input_qty}
              onChange={(e) => set("input_qty", e.target.value)}
              className={numClass(fieldErrors.input_qty)}
            />
            {fieldErrors.input_qty && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.input_qty}</p>
            )}
          </div>

          {/* output */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ยอดผลิตได้ (output) *
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={v.output_qty}
              onChange={(e) => set("output_qty", e.target.value)}
              className={numClass(fieldErrors.output_qty)}
            />
            {fieldErrors.output_qty && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.output_qty}</p>
            )}
          </div>

          {/* loss */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ของเสีย (loss)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={v.loss_qty}
              onChange={(e) => set("loss_qty", e.target.value)}
              className={numClass(fieldErrors.loss_qty)}
            />
            {fieldErrors.loss_qty && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.loss_qty}</p>
            )}
          </div>

          {/* hours */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ชั่วโมงทำงาน
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              max="24"
              value={v.hours}
              onChange={(e) => set("hours", e.target.value)}
              className={numClass(fieldErrors.hours)}
            />
            {fieldErrors.hours && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.hours}</p>
            )}
          </div>

          {/* headcount */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              จำนวนคน
            </label>
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
              <p className="mt-1 text-xs text-destructive">{fieldErrors.headcount}</p>
            )}
          </div>
        </div>

        {/* note */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            หมายเหตุ
          </label>
          <textarea
            rows={2}
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="บันทึกเพิ่มเติม (ถ้ามี)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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
