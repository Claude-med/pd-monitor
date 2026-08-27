"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Station } from "@/lib/data/stations";
import {
  MACHINE_STATUSES,
  MACHINE_STATUS_LABEL,
  MACHINE_STATUS_COLOR,
  daysUntil,
  type MachineStatus,
} from "@/lib/data/machine-constants";
import type { Machine } from "@/lib/data/machines";
import {
  upsertMachine,
  setMachineStatus,
  type MachineValues,
} from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

const EMPTY: MachineValues = {
  id: null,
  code: "",
  name: "",
  station_id: "",
  room: "",
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

/**
 * ชิปสถานะกดเปลี่ยนได้บนการ์ด (0052) — เห็นเฉพาะคนมีสิทธิ์จัดการเครื่องจักร
 *
 * เปลี่ยนสถานะเป็นงานที่ทำบ่อยที่สุดของหน้านี้ ของเดิมต้องเปิดฟอร์มแก้ทั้งใบก่อน
 * (แพทเทิร์นเดียวกับ LotStatusPicker ในหน้าคลัง — RPC แคบ แก้เฉพาะคอลัมน์ status)
 */
function MachineStatusPicker({
  machineId,
  status,
}: {
  machineId: string;
  status: MachineStatus;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function pick(next: MachineStatus) {
    if (next === status || pending) return;
    setError(null);
    start(async () => {
      const res = await setMachineStatus(machineId, next);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      {/* ป้ายสถานะปัจจุบัน "ป้ายเดียว" ที่กดแล้วกางรายการให้เลือกได้เลยในคลิกเดียว
          (ของเดิมยิงปุ่มครบทั้ง 5 ค่าทุกการ์ด — 10 เครื่อง = 50 ชิปสี อ่านไม่ออกว่าอันไหนคือของจริง) */}
      <span className="relative inline-flex items-center">
        <select
          value={status}
          disabled={pending}
          onChange={(e) => pick(e.target.value as MachineStatus)}
          aria-label="สถานะเครื่องจักร"
          className="cursor-pointer appearance-none rounded py-0.5 pl-2 pr-6 text-xs font-medium text-white outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          style={{ backgroundColor: MACHINE_STATUS_COLOR[status] ?? "#64748b" }}
        >
          {MACHINE_STATUSES.map((s) => (
            // ⚠️ ต้องกำหนดสีพื้น/สีตัวอักษรของ option เอง ไม่งั้นบางเบราว์เซอร์
            //    ลากสีพื้นของ select (สีเข้ม) ไปทาบรายการจนอ่านไม่ออก
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

/** ช่องข้อมูลบนการ์ด — เห็นได้ทุก role ไม่ต้องกด "แก้ไข" */
function Field({
  label,
  value,
  empty = "—",
  children,
}: {
  label: string;
  value: string | null;
  empty?: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">
        {value ? (
          <span>{value}</span>
        ) : (
          <span className="text-muted-foreground">{empty}</span>
        )}
        {children}
      </dd>
    </div>
  );
}

export function MachinesView({
  machines,
  stations,
  canManage,
  canSchedule,
}: {
  machines: Machine[];
  /** ทะเบียนสถานีจริง — ตัวเลือกใน dropdown "สถานี" (Part C.3 ก้อน 1) */
  stations: Station[];
  canManage: boolean;
  /** ตั้งกำหนดซ่อมบำรุง/สอบเทียบได้ (วิศวกรรม/ผู้บริหาร) */
  canSchedule: boolean;
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
              <MachineForm
                initial={EMPTY}
                mode="create"
                stations={stations}
                canSchedule={canSchedule}
                onDone={() => setAdding(false)}
              />
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
              <div className="space-y-3 px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.code}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        {m.name}
                      </span>
                      {!m.is_active && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          ปิดใช้งาน
                        </span>
                      )}
                    </div>
                    {/* สถานะ — คนมีสิทธิ์กดเปลี่ยนได้ตรงนี้เลย ไม่ต้องเปิดฟอร์ม */}
                    <div className="mt-1.5">
                      {canManage ? (
                        <MachineStatusPicker
                          machineId={m.id}
                          status={m.status}
                        />
                      ) : (
                        <StatusBadge status={m.status} />
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditId((id) => (id === m.id ? null : m.id))
                      }
                      className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                    >
                      {editId === m.id ? "ปิด" : "แก้ไขทะเบียน"}
                    </button>
                  )}
                </div>

                {/* รายละเอียดครบบนการ์ด — เห็นได้ทุก role ไม่ต้องมีสิทธิ์แก้ไข */}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 sm:grid-cols-3">
                  <Field
                    label="สถานี"
                    value={m.station_name}
                    empty="— ไม่ระบุ —"
                  />
                  <Field label="ห้อง" value={m.room} empty="— ไม่ระบุ —" />
                  <Field
                    label="ทำความสะอาดล่าสุด"
                    value={m.last_clean_date}
                    empty="— ยังไม่บันทึก —"
                  />
                  <Field
                    label="กำหนดซ่อมบำรุงครั้งหน้า"
                    value={m.next_maintenance_date}
                    empty="— ยังไม่กำหนด —"
                  >
                    <DueBadge date={m.next_maintenance_date} label="ซ่อม" />
                  </Field>
                  <Field
                    label="กำหนดสอบเทียบครั้งหน้า"
                    value={m.next_calibration_date}
                    empty="— ยังไม่กำหนด —"
                  >
                    <DueBadge date={m.next_calibration_date} label="สอบเทียบ" />
                  </Field>
                  {m.note && (
                    <div className="col-span-2 sm:col-span-3">
                      <dt className="text-[11px] text-muted-foreground">
                        หมายเหตุ
                      </dt>
                      <dd className="mt-0.5 text-sm">📝 {m.note}</dd>
                    </div>
                  )}
                </dl>
              </div>
              {canManage && editId === m.id && (
                <div className="border-t p-5">
                  <MachineForm
                    initial={{
                      id: m.id,
                      code: m.code,
                      name: m.name,
                      station_id: m.station_id ?? "",
                      room: m.room ?? "",
                      status: m.status,
                      note: m.note ?? "",
                      last_clean_date: m.last_clean_date ?? "",
                      next_maintenance_date: m.next_maintenance_date ?? "",
                      next_calibration_date: m.next_calibration_date ?? "",
                    }}
                    mode="edit"
                    stations={stations}
                    canSchedule={canSchedule}
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
  mode,
  stations,
  canSchedule,
  onDone,
}: {
  initial: MachineValues;
  /** create = ฟอร์มเพิ่มเครื่องใหม่ (ไม่มีช่อง "ทำความสะอาดล่าสุด") */
  mode: "create" | "edit";
  stations: Station[];
  canSchedule: boolean;
  onDone: () => void;
}) {
  const [v, setV] = useState<MachineValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // สถานีที่เปิดใช้งาน + สถานีเดิมของเครื่องนี้ (เผื่อถูกปิดใช้งานไปแล้ว จะได้ไม่หายจาก dropdown)
  const stationOptions = stations.filter(
    (s) => s.is_active || s.id === initial.station_id,
  );

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
            value={v.station_id}
            onChange={(e) => set("station_id", e.target.value)}
            className={inputClass}
          >
            <option value="">— ไม่ระบุ —</option>
            {stationOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_active ? "" : " (ปิดใช้งาน)"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>ห้อง</label>
          <input
            value={v.room}
            onChange={(e) => set("room", e.target.value)}
            placeholder="เช่น ห้องตอก 1 / Room 204"
            className={inputClass}
          />
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

        {/* ทำความสะอาดล่าสุด: มีเฉพาะตอน "แก้ไข" (ตอนเพิ่มเครื่องใหม่ยังไม่มีประวัติ) */}
        {mode === "edit" && (
          <div>
            <label className={labelClass}>ทำความสะอาดล่าสุด</label>
            <input
              type="date"
              value={v.last_clean_date}
              onChange={(e) => set("last_clean_date", e.target.value)}
              className={inputClass}
            />
          </div>
        )}

        {/* กำหนดซ่อม/สอบเทียบ: แก้ได้เฉพาะฝ่ายวิศวกรรม/ผู้บริหาร */}
        {canSchedule ? (
          <>
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
              <label className={labelClass}>
                กำหนดสอบเทียบ (calibration) ครั้งหน้า
              </label>
              <input
                type="date"
                value={v.next_calibration_date}
                onChange={(e) => set("next_calibration_date", e.target.value)}
                className={inputClass}
              />
            </div>
          </>
        ) : (
          mode === "edit" && (
            <div className="sm:col-span-2 rounded-md border border-dashed p-3">
              <p className={labelClass}>
                กำหนดซ่อมบำรุง / สอบเทียบ (กำหนดโดยฝ่ายวิศวกรรม)
              </p>
              <p className="text-sm">
                ซ่อมบำรุงครั้งหน้า:{" "}
                <span className="font-medium">
                  {v.next_maintenance_date || "— ยังไม่กำหนด —"}
                </span>
                {" · "}
                สอบเทียบครั้งหน้า:{" "}
                <span className="font-medium">
                  {v.next_calibration_date || "— ยังไม่กำหนด —"}
                </span>
              </p>
            </div>
          )
        )}
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
