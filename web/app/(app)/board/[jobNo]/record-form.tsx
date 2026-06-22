"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  STATIONS,
  validateRecord,
  type RecordFormValues,
} from "@/lib/data/station-constants";
import { addRecord } from "./record-actions";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: RecordFormValues = {
  station: "",
  record_date: today(),
  input_qty: "",
  output_qty: "",
  loss_qty: "",
  hours: "",
  note: "",
};

type FieldErrors = Partial<Record<keyof RecordFormValues, string>>;

export function RecordForm({ jobId, jobNo }: { jobId: string; jobNo: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<RecordFormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof RecordFormValues>(k: K, val: string) {
    setV((cur) => ({ ...cur, [k]: val }));
    setOk(false);
  }

  function submit() {
    setFormError(null);
    setOk(false);
    // validate ฝั่ง client ก่อน (feedback ทันที)
    const { errors, parsed } = validateRecord(v);
    setFieldErrors(errors);
    if (!parsed) return;

    start(async () => {
      const res = await addRecord(jobId, jobNo, v);
      if (res?.ok) {
        setOk(true);
        setV({ ...EMPTY, record_date: v.record_date, station: v.station });
        setFieldErrors({});
        router.refresh();
        return;
      }
      if (res?.fieldErrors) setFieldErrors(res.fieldErrors);
      setFormError(res?.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        + บันทึกผลผลิต
      </button>
    );
  }

  const numClass = (err?: string) =>
    `w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
      err ? "border-destructive" : "border-input"
    }`;

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* สถานี */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            สถานีผลิต *
          </label>
          <select
            value={v.station}
            onChange={(e) => set("station", e.target.value)}
            className={numClass(fieldErrors.station)}
          >
            <option value="">— เลือกสถานี —</option>
            {STATIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.icon} {s.label}
              </option>
            ))}
          </select>
          {fieldErrors.station && (
            <p className="mt-1 text-xs text-destructive">{fieldErrors.station}</p>
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
      {ok && (
        <p className="rounded-md bg-green-100 px-3 py-2 text-sm text-green-800">
          บันทึกแล้ว ✓
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setV(EMPTY);
            setFieldErrors({});
            setFormError(null);
            setOk(false);
          }}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ปิด
        </button>
      </div>
    </div>
  );
}
