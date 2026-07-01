"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STATIONS, STATION_LABEL } from "@/lib/data/station-constants";
import {
  MACHINE_STATUSES,
  MACHINE_STATUS_LABEL,
  MACHINE_STATUS_COLOR,
  daysUntil,
} from "@/lib/data/machine-constants";
import type { Machine } from "@/lib/data/machines";
import { upsertMachine, type MachineValues } from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

const EMPTY: MachineValues = {
  id: null,
  code: "",
  name: "",
  station: "",
  status: "available",
  note: "",
  last_clean_date: "",
  next_maintenance_date: "",
  next_calibration_date: "",
};

function StatusBadge({ status }: { status: string }) {
  const color = MACHINE_STATUS_COLOR[status] ?? "#64748b";
  return (
    <span
      className="rounded px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: color }}
    >
      {MACHINE_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** ป้ายเตือนกำหนดซ่อม/สอบเทียบ (เลยกำหนด=แดง · ใกล้=เหลือง) */
function DueBadge({ date, label }: { date: string | null; label: string }) {
  const d = daysUntil(date);
  if (d === null) return null;
  if (d < 0)
    return (
      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
        เลยกำหนด{label} {Math.abs(d)} วัน
      </span>
    );
  if (d <= 7)
    return (
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
        ใกล้ครบ{label} (อีก {d} วัน)
      </span>
    );
  return null;
}

export function MachinesView({
  machines,
  canManage,
}: {
  machines: Machine[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="rounded-xl border bg-card">
          <button
            type="button"
            onClick={() => {
              setAdding((s) => !s);
              setEditId(null);
            }}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <span className="font-semibold">＋ เพิ่มเครื่องจักร</span>
            <span className="text-sm text-muted-foreground">
              {adding ? "ซ่อน" : "เปิด"}
            </span>
          </button>
          {adding && (
            <div className="border-t p-5">
              <MachineForm initial={EMPTY} onDone={() => setAdding(false)} />
            </div>
          )}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        เครื่องจักรทั้งหมด {machines.length} เครื่อง
      </p>

      {machines.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          ยังไม่มีเครื่องจักรในระบบ
          {canManage ? " — กด “＋ เพิ่มเครื่องจักร” ด้านบน" : ""}
        </p>
      ) : (
        <div className="space-y-3">
          {machines.map((m) => (
            <div key={m.id} className="rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.code}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {m.name}
                    </span>
                    {m.station && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                        {STATION_LABEL[m.station] ?? m.station}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <DueBadge date={m.next_maintenance_date} label="ซ่อม" />
                    <DueBadge date={m.next_calibration_date} label="สอบเทียบ" />
                  </div>
                  {m.note && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      📝 {m.note}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={m.status} />
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditId((id) => (id === m.id ? null : m.id))
                      }
                      className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                    >
                      {editId === m.id ? "ปิด" : "แก้ไข"}
                    </button>
                  )}
                </div>
              </div>
              {canManage && editId === m.id && (
                <div className="border-t p-5">
                  <MachineForm
                    initial={{
                      id: m.id,
                      code: m.code,
                      name: m.name,
                      station: m.station ?? "",
                      status: m.status,
                      note: m.note ?? "",
                      last_clean_date: m.last_clean_date ?? "",
                      next_maintenance_date: m.next_maintenance_date ?? "",
                      next_calibration_date: m.next_calibration_date ?? "",
                    }}
                    onDone={() => setEditId(null)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MachineForm({
  initial,
  onDone,
}: {
  initial: MachineValues;
  onDone: () => void;
}) {
  const [v, setV] = useState<MachineValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof MachineValues>(k: K, val: string) {
    setV((cur) => ({ ...cur, [k]: val }));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await upsertMachine(v);
      if (res.ok) {
        router.refresh();
        onDone();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>รหัสเครื่อง (code) *</label>
          <input
            value={v.code}
            onChange={(e) => set("code", e.target.value)}
            placeholder="เช่น MC-001"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ชื่อเครื่อง *</label>
          <input
            value={v.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="เช่น เครื่องตอกเม็ด A"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>สถานี</label>
          <select
            value={v.station}
            onChange={(e) => set("station", e.target.value)}
            className={inputClass}
          >
            <option value="">— ไม่ระบุ —</option>
            {STATIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>สถานะ</label>
          <select
            value={v.status}
            onChange={(e) => set("status", e.target.value)}
            className={inputClass}
          >
            {MACHINE_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>ทำความสะอาดล่าสุด</label>
          <input
            type="date"
            value={v.last_clean_date}
            onChange={(e) => set("last_clean_date", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>กำหนดซ่อมบำรุงครั้งหน้า</label>
          <input
            type="date"
            value={v.next_maintenance_date}
            onChange={(e) => set("next_maintenance_date", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>กำหนดสอบเทียบ (calibration) ครั้งหน้า</label>
          <input
            type="date"
            value={v.next_calibration_date}
            onChange={(e) => set("next_calibration_date", e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>หมายเหตุ</label>
          <input
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
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
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : v.id ? "บันทึกการแก้ไข" : "เพิ่มเครื่องจักร"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-5 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
