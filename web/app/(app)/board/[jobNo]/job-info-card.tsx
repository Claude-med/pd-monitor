"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AppRole } from "@/lib/auth/dal";
import type { JobRow } from "@/lib/data/job-constants";
import { formatSubStatus } from "@/lib/data/job-constants";
import type { JobSubStatusOption } from "@/lib/data/job-sub-statuses";
import type { CustomerOption } from "@/lib/data/customers";
import { PACK_TYPES } from "@/lib/data/packaging-constants";
import {
  JOB_FIELD_RULES,
  canEditField,
  isFieldLocked,
  isLotLocked,
  type JobFieldKey,
} from "@/lib/data/job-field-rules";
import { StatusPicker } from "../status-picker";
import { updateJobDetails } from "./job-edit-actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

/** ช่องอ่านอย่างเดียว — ว่าง (null หรือ "") ต้องขึ้น "—" ไม่ใช่ช่องเปล่า */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const shown = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{shown}</dd>
    </div>
  );
}

/**
 * ช่องที่ role นี้แก้ไม่ได้ / ถูกล็อกด้วยสถานะ — โชว์ค่าเดิมพร้อมกุญแจต่อท้ายชื่อช่อง
 * เหตุผลอยู่ใน tooltip (`title`) ไม่กางเป็นบรรทัดเต็ม เพราะฟอร์มมีช่องล็อกได้หลายช่องพร้อมกัน
 */
function LockedField({
  label,
  value,
  reason,
}: {
  label: string;
  value: React.ReactNode;
  reason: string;
}) {
  const shown = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">
        {label}{" "}
        <span title={reason} className="cursor-help">
          🔒
        </span>
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-muted-foreground">{shown}</dd>
    </div>
  );
}

type Draft = Record<string, string>;

/** ค่าปัจจุบันของทุกช่องในรูปสตริง — ใช้เทียบหาว่าผู้ใช้แก้ช่องไหนบ้าง */
function toDraft(job: JobRow): Draft {
  return {
    sub_status: job.sub_status ?? "",
    plan_month: job.plan_month ?? "",
    due_date: job.due_date ?? "",
    customer_id: job.customer_id ?? "",
    cpo_date: job.cpo_date ?? "",
    request_no: job.request_no ?? "",
    planned_start: job.planned_start ?? "",
    planned_end: job.planned_end ?? "",
    quantity: job.quantity != null ? String(job.quantity) : "",
    pack_type: job.pack_type ?? "",
    pack_pattern_1: job.pack_patterns[0] ?? "",
    pack_pattern_2: job.pack_patterns[1] ?? "",
    pack_pattern_3: job.pack_patterns[2] ?? "",
    lot_no: job.lot_no ?? "",
    mfg_date: job.mfg_date ?? "",
    exp_date: job.exp_date ?? "",
  };
}

export function JobInfoCard({
  job,
  roles,
  isManager,
  subStatuses,
  customers,
  materialCount,
}: {
  job: JobRow;
  roles: AppRole[];
  isManager: boolean;
  subStatuses: JobSubStatusOption[];
  customers: CustomerOption[];
  /** จำนวนใบเบิกที่คลังจ่ายแล้ว — ใช้เตือนก่อนแก้ Batch Size */
  materialCount: number;
}) {
  const base = toDraft(job);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(base);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const lotLocked = isLotLocked(job.status);
  const hasBatch = !!job.lot_no;

  /** ช่องนี้กรอกได้ไหมในโหมดฟอร์ม (สิทธิ์ + ด่านล็อก + ผู้บริหารข้ามด่านได้) */
  function editable(key: JobFieldKey): boolean {
    if (!canEditField(key, roles)) return false;
    if (key === "lot_no" || key === "mfg_date" || key === "exp_date") {
      // ด่านของ set_job_lot (0049) — ผู้บริหารก็ข้ามไม่ได้
      if (lotLocked) return false;
      // วันผลิต/วันหมดอายุผูกกับล็อต ถ้ายังไม่มีล็อตและคนนี้กรอกล็อตไม่ได้ ก็แก้ไม่ได้
      if (key !== "lot_no" && !hasBatch && !canEditField("lot_no", roles)) return false;
      return true;
    }
    if (isFieldLocked(key, job.status)) return isManager;
    return true;
  }

  /** เหตุผลที่ช่องนี้แก้ไม่ได้ — บอกให้ผู้ใช้รู้ว่าติดอะไร ไม่ใช่แค่ซ่อนช่อง */
  function lockReason(key: JobFieldKey): string {
    if (!canEditField(key, roles)) return "ฝ่ายของคุณไม่มีสิทธิ์แก้ช่องนี้";
    if (key === "lot_no" || key === "mfg_date" || key === "exp_date") {
      if (lotLocked) return "งานเริ่มผลิตแล้ว — ล็อกตามหลัก GMP";
      if (!hasBatch) return "รอฝ่ายผลิตกรอก LOT No. ก่อน";
    }
    if (isFieldLocked(key, job.status)) {
      return `งานถึงขั้น "${job.status === "finished_goods" ? "เข้าคลัง" : "กำลังผลิต"}" แล้ว — ต้องให้ผู้บริหารแก้พร้อมเหตุผล`;
    }
    return "แก้ไม่ได้";
  }

  const anyEditable = (Object.keys(JOB_FIELD_RULES) as JobFieldKey[]).some(editable);

  // ช่องที่ผู้ใช้แก้จริง (เทียบกับค่าเดิม) — ส่งเฉพาะพวกนี้ให้ DB
  const dirtyKeys = (Object.keys(base) as JobFieldKey[]).filter(
    (k) => (draft[k] ?? "") !== (base[k] ?? ""),
  );
  // ผู้บริหารแก้ช่องที่ถูกล็อก → บังคับกรอกเหตุผล (ลงประวัติ audit)
  const lockedDirty = dirtyKeys.filter((k) => isFieldLocked(k, job.status));
  const needReason = lockedDirty.length > 0;

  function set(key: JobFieldKey, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function cancel() {
    setDraft(base);
    setReason("");
    setError(null);
    setOpen(false);
  }

  function save() {
    setError(null);
    setSaved(null);
    if (dirtyKeys.length === 0) return setError("ยังไม่มีช่องไหนถูกแก้");
    if (needReason && !reason.trim())
      return setError("กรุณาระบุเหตุผลของการแก้ช่องที่ถูกล็อก");

    // ส่งเป็น null เมื่อผู้ใช้ล้างค่า เพื่อให้ DB เก็บ null ไม่ใช่สตริงว่าง
    const fields: Record<string, string | null> = {};
    for (const k of dirtyKeys) fields[k] = draft[k].trim() === "" ? null : draft[k];

    start(async () => {
      const res = await updateJobDetails(job.job_no, job.id, fields, reason);
      if (res.error) return setError(res.error);
      setOpen(false);
      setReason("");
      setSaved(res.message ?? "บันทึกแล้ว");
      router.refresh();
    });
  }

  // ---------------- โหมดอ่าน ----------------
  if (!open) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-3 flex items-start justify-between gap-2">
            <p className="text-sm font-semibold">ข้อมูลงาน</p>
            {anyEditable && (
              <button
                type="button"
                onClick={() => {
                  setDraft(base);
                  setSaved(null);
                  setOpen(true);
                }}
                className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                ✏️ แก้ไขข้อมูล
              </button>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {/* Job No. = jobs.job_no ตรงๆ — orders.order_no คือ 'ORD-' + job_no เสมอ (0048)
                จึงไม่ต้องตัด prefix ด้วย string ให้เสี่ยงพลาด */}
            <Field label="Job No." value={job.job_no} />
            <Field label="ลูกค้า" value={job.customer} />
            <Field label="ใบคำขอ" value={job.request_no} />
            <Field label="C.P.O DATE" value={job.cpo_date} />
            <Field label="กำหนดส่ง (due date)" value={job.due_date} />
            <Field
              label="Status"
              value={formatSubStatus(job.sub_status, job.plan_month)}
            />
            <Field label="ผลิตภัณฑ์" value={job.product_name} />
            <Field label="รหัสยา" value={job.product_code} />
            <Field label="ชนิด" value={job.dosage_form} />
            <Field label="Reg No." value={job.reg_no} />
            <Field
              label="Batch Size"
              value={
                job.quantity != null
                  ? `${job.quantity.toLocaleString("th-TH")} ${job.unit ?? ""}`.trim()
                  : null
              }
            />
            <Field label="LOT No. (Batch NO.)" value={job.lot_no} />
            <Field
              label="แผนเริ่ม–เสร็จ"
              value={
                job.planned_start || job.planned_end
                  ? `${job.planned_start ?? "—"} → ${job.planned_end ?? "—"}`
                  : null
              }
            />
            <Field label="วันผลิต" value={job.mfg_date} />
            <Field label="วันหมดอายุ" value={job.exp_date} />
            <Field label="รูปแบบบรรจุ" value={job.pack_type} />
            {/* Pack Size — แยกบรรทัด (1)(2)(3) ให้เห็นว่าเป็นคนละช่อง (ตรงกับใบแจ้งผลิต F.PLN.01) */}
            <Field
              label="Pack Size"
              value={
                job.pack_patterns.length ? (
                  <span className="block space-y-0.5">
                    {job.pack_patterns.map((p, i) => (
                      <span key={i} className="block">
                        ({i + 1}) {p}
                      </span>
                    ))}
                  </span>
                ) : null
              }
            />
          </dl>
        </div>
        {saved && (
          <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
            ✓ {saved}
          </p>
        )}
      </div>
    );
  }

  // ---------------- โหมดฟอร์ม ----------------
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">แก้ไขข้อมูลงาน {job.job_no}</p>
        <button
          type="button"
          onClick={cancel}
          aria-label="ปิด"
          className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          ✕
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* ช่องที่มาจากทะเบียน/ระบบ — ไม่มี role ไหนแก้ได้ */}
        <LockedField label="Job No." value={job.job_no} reason="ระบบออกเลขให้ ห้ามแก้" />
        <LockedField
          label="ผลิตภัณฑ์ · Reg No."
          value={`${job.product_name ?? "—"}${job.reg_no ? ` · ${job.reg_no}` : ""}`}
          reason="แก้ที่หน้าทะเบียนผลิตภัณฑ์เท่านั้น"
        />

        {/* ลูกค้า */}
        {editable("customer_id") ? (
          <div>
            <label className={labelClass}>ลูกค้า</label>
            <select
              value={draft.customer_id}
              onChange={(e) => set("customer_id", e.target.value)}
              className={inputClass}
            >
              <option value="">— เลือกลูกค้า —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <LockedField label="ลูกค้า" value={job.customer} reason={lockReason("customer_id")} />
        )}

        {/* ใบคำขอ */}
        {editable("request_no") ? (
          <div>
            <label className={labelClass}>ใบคำขอ</label>
            <input
              value={draft.request_no}
              onChange={(e) => set("request_no", e.target.value)}
              className={inputClass}
            />
          </div>
        ) : (
          <LockedField label="ใบคำขอ" value={job.request_no} reason={lockReason("request_no")} />
        )}

        {/* C.P.O DATE */}
        {editable("cpo_date") ? (
          <div>
            <label className={labelClass}>C.P.O DATE</label>
            <input
              type="date"
              value={draft.cpo_date}
              onChange={(e) => set("cpo_date", e.target.value)}
              className={inputClass}
            />
          </div>
        ) : (
          <LockedField label="C.P.O DATE" value={job.cpo_date} reason={lockReason("cpo_date")} />
        )}

        {/* กำหนดส่ง */}
        {editable("due_date") ? (
          <div>
            <label className={labelClass}>กำหนดส่ง (due date)</label>
            <input
              type="date"
              value={draft.due_date}
              onChange={(e) => set("due_date", e.target.value)}
              className={inputClass}
            />
          </div>
        ) : (
          <LockedField label="กำหนดส่ง" value={job.due_date} reason={lockReason("due_date")} />
        )}

        {/* Batch Size (หน่วยล็อกตามทะเบียนยา ห้ามแก้ที่นี่) */}
        {editable("quantity") ? (
          <div>
            <label className={labelClass}>
              Batch Size {job.unit ? `(${job.unit})` : ""}
            </label>
            <input
              type="number"
              min={1}
              value={draft.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              className={inputClass}
            />
            {materialCount > 0 && draft.quantity !== base.quantity && (
              <p className="mt-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                ⚠️ งานนี้มีรายการเบิกวัตถุดิบ/บรรจุภัณฑ์{" "}
                {materialCount.toLocaleString("th-TH")} รายการ —
                แก้ Batch Size แล้วอย่าลืมทบทวนจำนวนที่เบิก
              </p>
            )}
          </div>
        ) : (
          <LockedField
            label="Batch Size"
            value={
              job.quantity != null
                ? `${job.quantity.toLocaleString("th-TH")} ${job.unit ?? ""}`.trim()
                : null
            }
            reason={lockReason("quantity")}
          />
        )}

        {/* Status + เดือนแผน — เต็มความกว้าง เพราะมีช่องค้นหา + ปุ่มจัดการ */}
        <div className="sm:col-span-2">
          <label className={labelClass}>Status</label>
          {editable("sub_status") ? (
            <StatusPicker
              options={subStatuses}
              value={draft.sub_status}
              planMonth={draft.plan_month || null}
              onChange={(name, month) =>
                setDraft((d) => ({
                  ...d,
                  sub_status: name,
                  plan_month: month ?? "",
                }))
              }
            />
          ) : (
            <LockedField
              label="Status"
              value={formatSubStatus(job.sub_status, job.plan_month)}
              reason={lockReason("sub_status")}
            />
          )}
        </div>

        {/* LOT No. */}
        {editable("lot_no") ? (
          <div>
            <label className={labelClass}>LOT No. (Batch NO.)</label>
            <input
              value={draft.lot_no}
              onChange={(e) => set("lot_no", e.target.value)}
              placeholder="เช่น 6801001"
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              เลขล็อตห้ามซ้ำกับงานอื่น · เริ่มผลิตแล้วช่องนี้จะล็อก
            </p>
          </div>
        ) : (
          <LockedField
            label="LOT No. (Batch NO.)"
            value={job.lot_no}
            reason={lockReason("lot_no")}
          />
        )}

        {/* แผนเริ่ม–เสร็จ */}
        {editable("planned_start") ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>แผนเริ่ม</label>
              <input
                type="date"
                value={draft.planned_start}
                onChange={(e) => set("planned_start", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>แผนเสร็จ</label>
              <input
                type="date"
                value={draft.planned_end}
                onChange={(e) => set("planned_end", e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        ) : (
          <LockedField
            label="แผนเริ่ม–เสร็จ"
            value={
              job.planned_start || job.planned_end
                ? `${job.planned_start ?? "—"} → ${job.planned_end ?? "—"}`
                : null
            }
            reason={lockReason("planned_start")}
          />
        )}

        {/* วันผลิต / วันหมดอายุ */}
        {editable("mfg_date") ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>วันผลิต</label>
              <input
                type="date"
                value={draft.mfg_date}
                onChange={(e) => set("mfg_date", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>วันหมดอายุ</label>
              <input
                type="date"
                value={draft.exp_date}
                onChange={(e) => set("exp_date", e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        ) : (
          <LockedField
            label="วันผลิต / วันหมดอายุ"
            value={`${job.mfg_date ?? "—"} · ${job.exp_date ?? "—"}`}
            reason={lockReason("mfg_date")}
          />
        )}

        {/* รูปแบบบรรจุ */}
        {editable("pack_type") ? (
          <div>
            <label className={labelClass}>รูปแบบบรรจุ</label>
            <select
              value={draft.pack_type}
              onChange={(e) => set("pack_type", e.target.value)}
              className={inputClass}
            >
              <option value="">— ไม่ระบุ —</option>
              {PACK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {/* ค่าเดิมที่ไม่อยู่ในตัวเลือกแล้ว (เช่น "กระปุก" ที่ตัดไปตอน Part 3) ต้องคงไว้ */}
              {draft.pack_type &&
                !PACK_TYPES.includes(draft.pack_type as (typeof PACK_TYPES)[number]) && (
                  <option value={draft.pack_type}>{draft.pack_type} (เลิกใช้แล้ว)</option>
                )}
            </select>
          </div>
        ) : (
          <LockedField label="รูปแบบบรรจุ" value={job.pack_type} reason={lockReason("pack_type")} />
        )}

        {/* Pack Size 1–3 */}
        <div className="sm:col-span-2">
          {editable("pack_pattern_1") ? (
            <>
              <label className={labelClass}>Pack Size (สูงสุด 3 ขนาด)</label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["pack_pattern_1", "pack_pattern_2", "pack_pattern_3"] as const).map(
                  (k, i) => (
                    <input
                      key={k}
                      value={draft[k]}
                      onChange={(e) => set(k, e.target.value)}
                      placeholder={`ขนาดบรรจุ (${i + 1}) — เช่น 666 x 30 x 10's`}
                      className={inputClass}
                    />
                  ),
                )}
              </div>
            </>
          ) : (
            <LockedField
              label="Pack Size"
              value={job.pack_patterns.length ? job.pack_patterns.join(" · ") : null}
              reason={lockReason("pack_pattern_1")}
            />
          )}
        </div>
      </div>

      {/* ผู้บริหารแก้ช่องที่ถูกล็อก → บังคับเหตุผล ลงประวัติ audit */}
      {needReason && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <label className={labelClass}>
            เหตุผลที่ต้องแก้ช่องที่ถูกล็อก ({lockedDirty
              .map((k) => JOB_FIELD_RULES[k].label)
              .join(" · ")}) <span className="text-destructive">*</span>
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ฝ่ายขายแจ้งแก้จำนวนสั่งผลิตหลังเปิดงาน"
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            เหตุผลนี้จะถูกบันทึกในประวัติการแก้ไข (Audit) ตามหลัก GMP
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || dirtyKeys.length === 0}
          onClick={save}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={cancel}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          ยกเลิก
        </button>
        <span className="text-xs text-muted-foreground">
          {dirtyKeys.length > 0
            ? `แก้ไว้ ${dirtyKeys.length} ช่อง — บันทึกทีเดียวทั้งหมด`
            : "ยังไม่ได้แก้ช่องไหน"}
        </span>
      </div>
    </div>
  );
}
