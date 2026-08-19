"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobLot } from "./lot-actions";

/**
 * กรอก LOT No. (Batch NO.) ของงาน — ฝ่ายผลิต/ผู้บริหาร (migration 0049)
 *
 * ก้อน 2 ตัดช่องเลขล็อตออกจากหน้าสร้างงานเพราะฝ่ายวางแผนไม่รู้เลขล็อต
 * → ฝ่ายผลิตมากรอกที่นี่ก่อนกด "เริ่มผลิต"
 * เข้าสถานะ "กำลังผลิต" แล้วช่องจะล็อก (เอกสารการผลิตอ้างเลขล็อตนี้ไปแล้ว)
 */
export function JobLotForm({
  jobNo,
  jobId,
  lotNo,
  mfgDate,
  expDate,
  locked,
}: {
  jobNo: string;
  jobId: string;
  lotNo: string | null;
  mfgDate: string | null;
  expDate: string | null;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [lot, setLot] = useState(lotNo ?? "");
  const [mfg, setMfg] = useState(mfgDate ?? "");
  const [exp, setExp] = useState(expDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function cancel() {
    setOpen(false);
    setError(null);
    setLot(lotNo ?? "");
    setMfg(mfgDate ?? "");
    setExp(expDate ?? "");
  }

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await setJobLot(jobNo, jobId, lot, mfg, exp);
      if (res.error) return setError(res.error);
      setOpen(false);
      setSaved(true);
      router.refresh();
    });
  }

  // ---------- ล็อกแล้ว: แสดงค่าอย่างเดียว + บอกเหตุผล ----------
  if (locked) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm">
          <span className="text-muted-foreground">LOT No. (Batch NO.) · </span>
          <span className="font-medium">{lotNo ?? "— ไม่ได้กรอกไว้ —"}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          🔒 งานนี้เริ่มผลิตแล้ว — เลขล็อตถูกล็อกตามหลัก GMP
          {lotNo
            ? " (เอกสารการผลิตอ้างเลขนี้ไปแล้ว) แก้ไขต้องยื่นคำขอแก้ไขย้อนหลัง"
            : " ต้องยื่นคำขอแก้ไขย้อนหลังเพื่อเติมเลขล็อต"}
        </p>
      </div>
    );
  }

  // ---------- ยังไม่ได้กรอก + ยังไม่ล็อก: เตือนให้กรอกก่อนเริ่มผลิต ----------
  const missing = !lotNo;

  if (!open) {
    return (
      <div
        className={
          missing
            ? "rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
            : "rounded-xl border bg-card p-4"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm">
              <span className="text-muted-foreground">LOT No. (Batch NO.) · </span>
              <span className="font-medium">{lotNo ?? "— ยังไม่ได้กรอก —"}</span>
            </p>
            {missing && (
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                ⚠️ ฝ่ายผลิตต้องกรอกเลขล็อตก่อนกด &ldquo;เริ่มผลิต&rdquo; —
                เริ่มผลิตแล้วช่องนี้จะล็อก
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setSaved(false);
              setOpen(true);
            }}
            className={
              missing
                ? "rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                : "rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            }
          >
            {missing ? "✏️ กรอกเลขล็อต" : "แก้เลขล็อต"}
          </button>
        </div>

        {saved && (
          <p className="mt-2 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
            ✓ บันทึกเลขล็อตแล้ว
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">เลขล็อตของงาน {jobNo}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            LOT No. (Batch NO.) <span className="text-destructive">*</span>
          </label>
          <input
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            placeholder="เช่น 6801001"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">วันผลิต</label>
          <input
            type="date"
            value={mfg}
            onChange={(e) => setMfg(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">วันหมดอายุ</label>
          <input
            type="date"
            value={exp}
            onChange={(e) => setExp(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        เลขล็อตห้ามซ้ำกับงานอื่น · วันผลิต/วันหมดอายุจะเว้นไว้ก่อนก็ได้
      </p>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !lot.trim()}
          onClick={save}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : "บันทึกเลขล็อต"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={cancel}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
