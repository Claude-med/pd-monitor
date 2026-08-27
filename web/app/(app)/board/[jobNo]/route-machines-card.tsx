"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MACHINE_STATUS_LABEL,
  MACHINE_STATUS_COLOR,
  MACHINE_BLOCKED_STATUSES,
  daysUntil,
  type MachineStatus,
} from "@/lib/data/machine-constants";
import type { Machine } from "@/lib/data/machines";
import type { RouteMachine } from "@/lib/data/job-routes";
import {
  addRouteMachine,
  removeRouteMachine,
} from "@/lib/actions/job-route-machines";

/**
 * การ์ด "เครื่องจักรของขั้นตอนนี้" (Part C.3 ก้อน 3)
 *
 * 1 ขั้นตอนผูกได้หลายเครื่อง · เลือกจาก dropdown ที่กรองเฉพาะเครื่องของสถานีนั้น
 * รายละเอียดเครื่องแสดงแบบ **อ่านอย่างเดียว** — แก้ทะเบียนเครื่องทำที่หน้าเครื่องจักรที่เดียว
 * (ตั้งใจไม่ทำ 2 ทางเข้า แบบเดียวกับหน้ารวมฝ่ายคลังใน Part C.2)
 */
export function RouteMachinesCard({
  jobNo,
  jobRouteId,
  stationId,
  stationName,
  selected,
  allMachines,
  canEdit,
}: {
  jobNo: string;
  jobRouteId: string;
  stationId: string;
  stationName: string;
  selected: RouteMachine[];
  allMachines: Machine[];
  canEdit: boolean;
}) {
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const chosen = new Set(selected.map((m) => m.machine_id));
  // เลือกได้เฉพาะเครื่องของสถานีนี้ที่ยังไม่ถูกเลือก (เครื่องที่ซ่อม/ถึงกำหนดสอบเทียบ
  // ยังเลือกได้ที่นี่ — ด่านห้ามใช้อยู่ตอนบันทึกผลผลิต จะได้เห็นว่าเครื่องติดปัญหา)
  const options = allMachines.filter(
    (m) => m.is_active && m.station_id === stationId && !chosen.has(m.id),
  );

  function add() {
    if (!pick) return;
    setError(null);
    start(async () => {
      const res = await addRouteMachine(jobNo, jobRouteId, pick);
      if (res.ok) {
        setPick("");
        router.refresh();
        return;
      }
      setError(res.error ?? "เลือกเครื่องจักรไม่สำเร็จ");
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      const res = await removeRouteMachine(jobNo, id);
      if (res.ok) router.refresh();
      else setError(res.error ?? "ถอดเครื่องจักรไม่สำเร็จ");
    });
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">เครื่องจักรของขั้นตอนนี้</h2>
        <span className="text-xs text-muted-foreground">
          {stationName} · {selected.length} เครื่อง
        </span>
      </div>

      {selected.length > 0 ? (
        <div className="space-y-3">
          {selected.map((m) => (
            <MachineDetail
              key={m.id}
              m={m}
              canEdit={canEdit}
              pending={pending}
              onRemove={() => remove(m.id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          ยังไม่ได้เลือกเครื่องจักรของขั้นตอนนี้
          {canEdit ? " — เลือกจากช่องด้านล่าง" : ""}
        </p>
      )}

      {canEdit && (
        <div className="mt-4 border-t pt-4">
          {options.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  เพิ่มเครื่องจักร (เฉพาะเครื่องของสถานี &ldquo;{stationName}&rdquo;)
                </label>
                <select
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                  disabled={pending}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— เลือกเครื่องจักร —</option>
                  {options.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} · {m.name}
                      {MACHINE_BLOCKED_STATUSES.has(m.status as MachineStatus)
                        ? ` (${MACHINE_STATUS_LABEL[m.status]})`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={add}
                disabled={pending || !pick}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "กำลังบันทึก…" : "＋ เพิ่ม"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {allMachines.some((m) => m.is_active && m.station_id === stationId)
                ? "เลือกเครื่องของสถานีนี้ครบทุกเครื่องแล้ว"
                : `ยังไม่มีเครื่องจักรที่ประจำสถานี “${stationName}” — ไปเพิ่มที่หน้าเครื่องจักรก่อน`}
            </p>
          )}
          {error && (
            <p className="mt-2 text-sm text-destructive">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** รายละเอียดเครื่อง 1 ใบ — อ่านอย่างเดียว (แก้ทะเบียนทำที่หน้าเครื่องจักร) */
function MachineDetail({
  m,
  canEdit,
  pending,
  onRemove,
}: {
  m: RouteMachine;
  canEdit: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const blocked = MACHINE_BLOCKED_STATUSES.has(m.status as MachineStatus);

  return (
    <div
      className={
        "rounded-lg border p-3 " +
        (blocked ? "border-destructive/40 bg-destructive/5" : "bg-muted/20")
      }
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{m.code}</span>
          <span className="text-sm text-muted-foreground">{m.name}</span>
          <span
            className="rounded px-2 py-0.5 text-xs font-medium text-white"
            style={{
              backgroundColor: MACHINE_STATUS_COLOR[m.status] ?? "#64748b",
            }}
          >
            {MACHINE_STATUS_LABEL[m.status] ?? m.status}
          </span>
        </div>
        {canEdit &&
          (confirming ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={onRemove}
                disabled={pending}
                className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                ยืนยันถอด
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
              >
                ยกเลิก
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              🗑 ถอดออก
            </button>
          ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        <Field label="ห้อง" value={m.room} />
        <Field label="ทำความสะอาดล่าสุด" value={m.last_clean_date} />
        <Field
          label="กำหนดซ่อมบำรุง"
          value={m.next_maintenance_date}
          due={m.next_maintenance_date}
        />
        <Field
          label="กำหนดสอบเทียบ"
          value={m.next_calibration_date}
          due={m.next_calibration_date}
        />
        {m.note && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-[11px] text-muted-foreground">หมายเหตุ</dt>
            <dd className="mt-0.5">📝 {m.note}</dd>
          </div>
        )}
      </dl>

      {blocked && (
        <p className="mt-2 text-xs text-destructive">
          ⚠️ เครื่องนี้อยู่สถานะ {MACHINE_STATUS_LABEL[m.status]} — บันทึกผลผลิตด้วยเครื่องนี้ไม่ได้จนกว่าจะแก้สถานะที่หน้าเครื่องจักร
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  due,
}: {
  label: string;
  value: string | null;
  due?: string | null;
}) {
  const d = due ? daysUntil(due) : null;
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <span>{value ?? "—"}</span>
        {d !== null && d < 0 && (
          <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
            เลยกำหนด {Math.abs(d)} วัน
          </span>
        )}
        {d !== null && d >= 0 && d <= 7 && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
            อีก {d} วัน
          </span>
        )}
      </dd>
    </div>
  );
}
