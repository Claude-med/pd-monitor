"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LineClearance } from "@/lib/data/line-clearance";
import type { RouteMachine } from "@/lib/data/job-routes";
import {
  performClearance,
  checkClearance,
  type LcValues,
} from "./line-clearance-actions";

/**
 * Line Clearance ของขั้นตอนหนึ่ง — Part C.3 ก้อน 4
 *
 * 1 การ์ดต่อ 1 เครื่องจักรที่ผูกไว้กับขั้นตอนนี้ (เลือก 3 เครื่อง = ทำ LC 3 ใบ)
 * แยกหน้าที่: ฝ่ายผลิตติ๊ก/บันทึก · **หัวหน้าฝ่ายผลิตเป็นคนยืนยัน** (ต้องคนละคนกับผู้ทำ)
 * ไม่ต้องติ๊กครบ 3 ข้อแล้ว — อย่างน้อย 1 ข้อก็ยืนยันได้ (ตามที่ฝ่ายผลิตขอ)
 */

const ITEMS: {
  key: "cleared_old" | "cleaned" | "setup_done";
  label: string;
  timeKey?: "cleared_old_time" | "cleaned_time";
}[] = [
  {
    key: "cleared_old",
    label: "เคลียร์ของเก่า/รุ่นก่อนออกจากไลน์",
    timeKey: "cleared_old_time",
  },
  { key: "cleaned", label: "ทำความสะอาด (washing)", timeKey: "cleaned_time" },
  { key: "setup_done", label: "ตั้งเครื่อง (set-up)" },
];

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function LineClearancePanel({
  jobNo,
  jobRouteId,
  stationName,
  machines,
  clearances,
  canPerform,
  canCheck,
  currentProfileId,
}: {
  jobNo: string;
  jobRouteId: string;
  stationName: string;
  machines: RouteMachine[];
  clearances: LineClearance[];
  canPerform: boolean;
  canCheck: boolean;
  currentProfileId: string;
}) {
  const byMachine = new Map(clearances.map((c) => [c.machine_id, c]));
  const passedCount = machines.filter(
    (m) => byMachine.get(m.machine_id)?.passed,
  ).length;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Line Clearance (เตรียมสายการผลิต)</h2>
        <span className="text-xs text-muted-foreground">
          {stationName} · ผ่านแล้ว {passedCount}/{machines.length} เครื่อง
        </span>
      </div>

      {machines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่ได้เลือกเครื่องจักรของขั้นตอนนี้ — เลือกที่การ์ดด้านบนก่อน
          แล้วจะมีใบ Line Clearance ให้ทำทีละเครื่อง
        </p>
      ) : (
        <div className="space-y-3">
          {machines.map((m) => (
            <ClearanceCard
              key={m.machine_id}
              jobNo={jobNo}
              jobRouteId={jobRouteId}
              machine={m}
              clearance={byMachine.get(m.machine_id) ?? null}
              canPerform={canPerform}
              canCheck={canCheck}
              currentProfileId={currentProfileId}
            />
          ))}
        </div>
      )}

      {machines.length > 0 && passedCount < machines.length && (
        <p className="mt-3 text-xs text-muted-foreground">
          บันทึกผลผลิตของสถานีนี้ได้เฉพาะเครื่องที่ผ่าน Line Clearance แล้วเท่านั้น
        </p>
      )}
    </div>
  );
}

function ClearanceCard({
  jobNo,
  jobRouteId,
  machine,
  clearance,
  canPerform,
  canCheck,
  currentProfileId,
}: {
  jobNo: string;
  jobRouteId: string;
  machine: RouteMachine;
  clearance: LineClearance | null;
  canPerform: boolean;
  canCheck: boolean;
  currentProfileId: string;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<LcValues>({
    cleared_old: clearance?.cleared_old ?? false,
    cleaned: clearance?.cleaned ?? false,
    setup_done: clearance?.setup_done ?? false,
    setup_minutes:
      clearance?.setup_minutes != null ? String(clearance.setup_minutes) : "",
    cleared_old_time: clearance?.cleared_old_time ?? "",
    cleaned_time: clearance?.cleaned_time ?? "",
    room: clearance?.room ?? machine.room ?? "",
    headcount: clearance?.headcount != null ? String(clearance.headcount) : "",
    note: clearance?.note ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const passed = clearance?.passed ?? false;
  const performed = !!clearance?.performed_by_id;
  const anyItem =
    !!clearance &&
    (clearance.cleared_old || clearance.cleaned || clearance.setup_done);
  const isPerformer = clearance?.performed_by_id === currentProfileId;
  const canSign =
    canCheck && performed && anyItem && !clearance?.checked_by_id && !isPerformer;

  function save() {
    setError(null);
    start(async () => {
      const res = await performClearance(
        jobNo,
        jobRouteId,
        machine.machine_id,
        v,
      );
      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  function sign() {
    if (!clearance) return;
    setError(null);
    start(async () => {
      const res = await checkClearance(jobNo, clearance.id);
      if (res.ok) router.refresh();
      else setError(res.error ?? "ยืนยันไม่สำเร็จ");
    });
  }

  function set<K extends keyof LcValues>(k: K, val: LcValues[K]) {
    setV((c) => ({ ...c, [k]: val }));
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{machine.code}</span>
          <span className="text-sm text-muted-foreground">{machine.name}</span>
        </div>
        {passed ? (
          <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
            ผ่านแล้ว ✓
          </span>
        ) : performed ? (
          <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">
            รอหัวหน้ายืนยัน
          </span>
        ) : (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            ยังไม่ได้ทำ
          </span>
        )}
      </div>

      {/* สรุปสถานะปัจจุบัน */}
      {clearance && (
        <div className="space-y-1.5 text-sm">
          {ITEMS.map((it) => {
            const t = it.timeKey ? clearance[it.timeKey] : null;
            return (
              <div key={it.key} className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    clearance[it.key]
                      ? "text-emerald-600"
                      : "text-muted-foreground"
                  }
                >
                  {clearance[it.key] ? "✓" : "○"}
                </span>
                <span className={clearance[it.key] ? "" : "text-muted-foreground"}>
                  {it.label}
                </span>
                {t && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    🕒 {t}
                  </span>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            {clearance.room && `ห้อง ${clearance.room} · `}
            {clearance.headcount != null && `${clearance.headcount} คน · `}
            {clearance.setup_minutes != null &&
              `set-up ${clearance.setup_minutes} นาที · `}
            ผู้ทำ: {clearance.performed_by_name ?? "—"}
            {clearance.checked_by_name
              ? ` · ผู้ยืนยัน: ${clearance.checked_by_name}`
              : " · ยังไม่มีผู้ยืนยัน"}
          </p>
          {clearance.note && (
            <p className="text-xs text-muted-foreground">
              หมายเหตุ: {clearance.note}
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ปุ่มยืนยัน (ลายเซ็นที่สอง) */}
      {performed && !clearance?.checked_by_id && (
        <div className="mt-3">
          {canSign ? (
            <button
              type="button"
              disabled={pending}
              onClick={sign}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              ✍️ ยืนยัน (หัวหน้าฝ่ายผลิต)
            </button>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {!anyItem
                ? "ติ๊กอย่างน้อย 1 ข้อก่อน จึงจะยืนยันได้"
                : isPerformer
                  ? "ผู้ยืนยันต้องเป็นคนละคนกับผู้ทำ (รอหัวหน้าฝ่ายผลิตมายืนยัน)"
                  : "รอหัวหน้าฝ่ายผลิตยืนยัน"}
            </p>
          )}
        </div>
      )}

      {/* ฟอร์มบันทึก/แก้ไข */}
      {canPerform && (
        <div className="mt-3">
          {open ? (
            <div className="space-y-3 rounded-lg border bg-background p-4">
              {ITEMS.map((it) => (
                <div key={it.key} className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={v[it.key]}
                      onChange={(e) => set(it.key, e.target.checked)}
                    />
                    {it.label}
                  </label>
                  {it.timeKey && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">เวลา</span>
                      <input
                        type="time"
                        value={v[it.timeKey]}
                        onChange={(e) => set(it.timeKey!, e.target.value)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </span>
                  )}
                </div>
              ))}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={labelClass}>ห้อง</label>
                  <input
                    value={v.room}
                    onChange={(e) => set("room", e.target.value)}
                    placeholder="เช่น ห้องตอก 1"
                    className={inputClass}
                  />
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
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>เวลา set-up (นาที)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={v.setup_minutes}
                    onChange={(e) => set("setup_minutes", e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>หมายเหตุ</label>
                <input
                  value={v.note}
                  onChange={(e) => set("note", e.target.value)}
                  placeholder="เช่น ชื่อพนักงานที่ทำจริง"
                  className={inputClass}
                />
              </div>

              {clearance?.checked_by_id && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  หมายเหตุ: บันทึกใหม่จะล้างลายเซ็นผู้ยืนยันเดิม ต้องยืนยันใหม่
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
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                >
                  ปิด
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
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
