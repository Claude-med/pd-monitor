"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LineClearance } from "@/lib/data/line-clearance";
import { performClearance, checkClearance } from "./line-clearance-actions";

const ITEMS: { key: "cleared_old" | "cleaned" | "setup_done"; label: string }[] = [
  { key: "cleared_old", label: "เคลียร์ของเก่า/รุ่นก่อนออกจากไลน์" },
  { key: "cleaned", label: "ทำความสะอาด (washing)" },
  { key: "setup_done", label: "ตั้งเครื่อง (set-up)" },
];

export function LineClearancePanel({
  jobNo,
  jobId,
  clearance,
  canPerform,
  canCheck,
  currentProfileId,
}: {
  jobNo: string;
  jobId: string;
  clearance: LineClearance | null;
  canPerform: boolean;
  canCheck: boolean;
  currentProfileId: string;
}) {
  const [open, setOpen] = useState(!clearance && canPerform);
  const [v, setV] = useState({
    cleared_old: clearance?.cleared_old ?? false,
    cleaned: clearance?.cleaned ?? false,
    setup_done: clearance?.setup_done ?? false,
    setup_minutes: clearance?.setup_minutes != null ? String(clearance.setup_minutes) : "",
    note: clearance?.note ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const passed = clearance?.passed ?? false;
  const performed = !!clearance?.performed_by_id;
  const allItems = !!clearance && clearance.cleared_old && clearance.cleaned && clearance.setup_done;
  const isPerformer = clearance?.performed_by_id === currentProfileId;
  const canSign =
    canCheck && performed && allItems && !clearance?.checked_by_id && !isPerformer;

  function save() {
    setError(null);
    start(async () => {
      const res = await performClearance(jobNo, jobId, v);
      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  function sign() {
    setError(null);
    start(async () => {
      const res = await checkClearance(jobNo, jobId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "ตรวจรับไม่สำเร็จ");
    });
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Line Clearance (เตรียมสายการผลิต)</h2>
        {passed ? (
          <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
            ผ่านแล้ว ✓
          </span>
        ) : performed ? (
          <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">
            รอผู้ตรวจรับเซ็น
          </span>
        ) : (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            ยังไม่ได้ทำ
          </span>
        )}
      </div>

      {!passed && (
        <p className="mb-3 text-xs text-muted-foreground">
          ต้องทำ Line Clearance ให้ผ่าน (ติ๊กครบ 3 ข้อ + ผู้ตรวจรับเซ็น) ก่อนจึงจะกด “เริ่มผลิต” ได้
        </p>
      )}

      {/* สรุปสถานะปัจจุบัน */}
      {clearance && (
        <div className="space-y-1.5 text-sm">
          {ITEMS.map((it) => (
            <div key={it.key} className="flex items-center gap-2">
              <span className={clearance[it.key] ? "text-emerald-600" : "text-muted-foreground"}>
                {clearance[it.key] ? "✓" : "○"}
              </span>
              <span className={clearance[it.key] ? "" : "text-muted-foreground"}>{it.label}</span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {clearance.setup_minutes != null && `เวลา set-up ${clearance.setup_minutes} นาที · `}
            ผู้เคลียร์: {clearance.performed_by_name ?? "—"}
            {clearance.checked_by_name
              ? ` · ผู้ตรวจรับ: ${clearance.checked_by_name}`
              : " · ยังไม่มีผู้ตรวจรับ"}
          </p>
          {clearance.note && (
            <p className="text-xs text-muted-foreground">หมายเหตุ: {clearance.note}</p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ปุ่มตรวจรับ (ลายเซ็นที่สอง) */}
      {performed && !clearance?.checked_by_id && (
        <div className="mt-3">
          {canSign ? (
            <button
              type="button"
              disabled={pending}
              onClick={sign}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              ✍️ ตรวจรับ (เซ็นยืนยัน)
            </button>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {!allItems
                ? "ติ๊กให้ครบ 3 ข้อก่อน จึงจะตรวจรับได้"
                : isPerformer
                  ? "ผู้ตรวจรับต้องเป็นคนละคนกับผู้เคลียร์ (รออีกคนมาเซ็น)"
                  : "รอผู้มีสิทธิ์ (ผลิต/QC/QA/ผู้บริหาร) ตรวจรับ"}
            </p>
          )}
        </div>
      )}

      {/* ฟอร์มบันทึก/แก้ไขการเคลียร์ไลน์ */}
      {canPerform && (
        <div className="mt-4">
          {open ? (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              {ITEMS.map((it) => (
                <label key={it.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={v[it.key]}
                    onChange={(e) => setV((c) => ({ ...c, [it.key]: e.target.checked }))}
                  />
                  {it.label}
                </label>
              ))}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    เวลา set-up (นาที)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={v.setup_minutes}
                    onChange={(e) => setV((c) => ({ ...c, setup_minutes: e.target.value }))}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    หมายเหตุ
                  </label>
                  <input
                    value={v.note}
                    onChange={(e) => setV((c) => ({ ...c, note: e.target.value }))}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              {clearance?.checked_by_id && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  หมายเหตุ: บันทึกใหม่จะล้างลายเซ็นผู้ตรวจรับเดิม ต้องตรวจรับใหม่
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={save}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "กำลังบันทึก…" : "บันทึกการเคลียร์ไลน์"}
                </button>
                {clearance && (
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                  >
                    ปิด
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              {clearance ? "แก้ไข/บันทึกใหม่" : "+ บันทึกการเคลียร์ไลน์"}
            </button>
          )}
        </div>
      )}

      {!clearance && !canPerform && (
        <p className="text-sm text-muted-foreground">
          ยังไม่ได้ทำ Line Clearance — รอฝ่ายผลิตบันทึก
        </p>
      )}
    </div>
  );
}
