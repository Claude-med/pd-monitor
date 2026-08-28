"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Deviation } from "@/lib/data/deviations";
import {
  DEVIATION_SEVERITY,
  DEVIATION_STATUS,
  DEVIATION_TYPES,
  SEVERITY_LABEL,
  SEVERITY_COLOR,
  DEV_STATUS_LABEL,
  DEV_STATUS_COLOR,
  DEV_TYPE_LABEL,
  NOTE_ROLE_META,
  isDeviationOpen,
  INCIDENT_CASE_TYPE,
  INCIDENT_DEPARTMENTS,
  CASE_NO_LABEL,
  DEPT_LABEL,
} from "@/lib/data/deviation-constants";
import { fmtDateTime } from "@/lib/format";
import {
  openDeviation,
  updateDeviation,
  qaReviewDeviation,
  addDeviationComment,
  submitDeviationResolution,
} from "./deviation-actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";
const readOnlyClass =
  "rounded-md border border-dashed border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground";

export function Deviations({
  jobId,
  jobNo,
  deviations,
  canOpen,
  canClose,
  canReview,
  currentRoleGroup,
}: {
  jobId: string;
  jobNo: string;
  deviations: Deviation[];
  canOpen: boolean;
  /** ปิด/ยกเลิกเคสได้ (QA/ผู้บริหาร) */
  canClose: boolean;
  /** ทำขั้น "QA ตรวจสอบ" ได้ — ค่าเดียวกับ canClose แต่แยกชื่อให้อ่านรู้เรื่อง */
  canReview: boolean;
  /**
   * ฝ่ายของผู้ใช้ — ต้องคำนวณด้วย roleGroupOf() เท่านั้น (ตรงกับ current_role_group() ใน DB)
   * ใช้ตัดสินว่าจะโชว์ปุ่ม "ส่งกลับให้ QA" ของแผนกนี้ไหม
   */
  currentRoleGroup: string;
}) {
  // ⚠️ ต้องตรงกับ has_open_deviation() ใน DB — ด่าน QA→FG ใช้ตัวนั้นตัดสิน
  const openCount = deviations.filter((d) => isDeviationOpen(d.status)).length;

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">⚠️ Incident Case / เหตุผิดปกติ</h2>
        <span className="text-xs text-muted-foreground">
          {deviations.length} รายการ
          {openCount > 0 && (
            <span className="ml-1 text-destructive">· เปิดค้าง {openCount}</span>
          )}
        </span>
      </div>

      {openCount > 0 && (
        <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          มี Incident Case เปิดค้าง — ต้องปิดหรือยกเลิกให้ครบก่อน QA จึงจะปล่อยผ่านเข้าคลัง (FG) ได้
        </p>
      )}

      {/* รายการ deviation */}
      {deviations.length > 0 ? (
        <ul className="space-y-2">
          {deviations.map((d) => (
            <DeviationItem
              key={d.id}
              jobNo={jobNo}
              dev={d}
              canClose={canClose}
              canReview={canReview}
              currentRoleGroup={currentRoleGroup}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">ไม่มี Incident Case</p>
      )}

      {/* เปิด Incident Case ใหม่ */}
      {canOpen && (
        <div className="mt-4">
          <OpenForm jobId={jobId} jobNo={jobNo} />
        </div>
      )}
    </section>
  );
}

function severityBadge(severity: string) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: SEVERITY_COLOR[severity] ?? "#64748b" }}
    >
      {SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

function statusBadge(status: string) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: DEV_STATUS_COLOR[status] ?? "#64748b" }}
    >
      {DEV_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function DeviationItem({
  jobNo,
  dev,
  canClose,
  canReview,
  currentRoleGroup,
}: {
  jobNo: string;
  dev: Deviation;
  canClose: boolean;
  canReview: boolean;
  currentRoleGroup: string;
}) {
  const [editing, setEditing] = useState(false);
  const done = !isDeviationOpen(dev.status);
  // แผนกของผู้ใช้ถูกมอบหมายและยังไม่ได้บันทึกผล → ถึงจะโชว์ปุ่มส่งกลับ
  const myDept = dev.departments.find((d) => d.role_group === currentRoleGroup);
  const canRespond =
    dev.status === "in_progress" && !!myDept && !myDept.responded_at;
  const respondedCount = dev.departments.filter((d) => d.responded_at).length;

  return (
    <li
      className="rounded-md border border-l-4 bg-card p-3 text-sm"
      style={{ borderLeftColor: SEVERITY_COLOR[dev.severity] ?? "#64748b" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(dev.status)}
        {severityBadge(dev.severity)}
        {dev.case_type && dev.case_no && (
          <span className="rounded border border-foreground/20 px-1.5 py-0.5 font-mono text-xs font-semibold">
            {CASE_NO_LABEL[dev.case_type] ?? dev.case_type} {dev.case_no}
          </span>
        )}
        <span className="font-medium">{dev.title}</span>
        <span className="text-xs text-muted-foreground">
          · {DEV_TYPE_LABEL[dev.dev_type] ?? dev.dev_type}
        </span>
      </div>

      {dev.description && <p className="mt-1.5">{dev.description}</p>}

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {dev.reporter_name && <span>เปิดโดย: {dev.reporter_name}</span>}
        {dev.machine_label && <span>เครื่อง: {dev.machine_label}</span>}
        {dev.due_date && <span>กำหนดปิด: {dev.due_date}</span>}
        <span>{fmtDateTime(dev.created_at)}</span>
      </div>

      {(dev.root_cause || dev.capa) && (
        <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2 text-xs">
          {/* root cause เลิกใช้ตั้งแต่ Part C.4 — โชว์เฉพาะเคสเก่าที่เคยกรอกไว้ */}
          {dev.root_cause && (
            <p>
              <span className="font-medium">สาเหตุ (ข้อมูลเดิม):</span> {dev.root_cause}
            </p>
          )}
          {dev.capa && (
            <p>
              <span className="font-medium">การแก้ไขเบื้องต้น:</span> {dev.capa}
            </p>
          )}
          {done && dev.closed_at && (
            <p className="text-muted-foreground">
              ปิดเมื่อ {fmtDateTime(dev.closed_at)}
            </p>
          )}
        </div>
      )}

      {/* D2: แจ้งว่าแก้ไขแล้ว รอ QA ตรวจสอบ */}
      {!done && dev.resolution_submitted_at && (
        <p className="mt-2 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
          🔄 แจ้งแก้ไขเรียบร้อยแล้ว — รอ QA อนุมัติ
          {dev.resolution_by_name ? ` · โดย ${dev.resolution_by_name}` : ""} ·{" "}
          {fmtDateTime(dev.resolution_submitted_at)}
        </p>
      )}

      {/* แผนกที่ QA มอบหมาย — ✓ ตอบแล้ว / ⏳ รอ (Part C.4 ก้อน 5) */}
      {dev.departments.length > 0 && (
        <div className="mt-2 rounded-md border bg-muted/30 p-2">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              แผนกที่รับผิดชอบ
            </span>
            <span className="text-xs text-muted-foreground">
              ตอบแล้ว {respondedCount}/{dev.departments.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dev.departments.map((d) => (
              <span
                key={d.id}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  d.responded_at
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "text-muted-foreground"
                }`}
                title={d.response_note ?? undefined}
              >
                {d.responded_at ? "✓" : "⏳"} {DEPT_LABEL[d.role_group] ?? d.role_group}
                {d.responded_at && d.responder_name ? ` · ${d.responder_name}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* D1: หมายเหตุแยกตามฝ่าย (append-only timeline) */}
      {dev.comments.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {dev.comments.map((c) => {
            const meta = NOTE_ROLE_META[c.role_group] ?? {
              label: c.role_group,
              color: "#64748b",
            };
            return (
              <li key={c.id} className="rounded-md bg-muted/40 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="rounded px-1.5 py-0.5 font-medium text-white"
                    style={{ backgroundColor: meta.color }}
                  >
                    {meta.label}
                  </span>
                  {c.author_name && (
                    <span className="text-muted-foreground">{c.author_name}</span>
                  )}
                  <span className="text-muted-foreground">
                    · {fmtDateTime(c.created_at)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
              </li>
            );
          })}
        </ul>
      )}

      {!done && (
        <div className="mt-2 space-y-2">
          {/* ขั้นที่ 2 ของ flow — QA คัดแยกประเภท/เลขที่ แล้วส่งให้แผนก */}
          {canReview && (dev.status === "qa_review" || dev.status === "in_progress") && (
            <QaReviewForm jobNo={jobNo} dev={dev} />
          )}

          {dev.status === "qa_review" && !canReview && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              ⏳ รอ QA ตรวจสอบ — QA จะเป็นคนระบุประเภทเอกสาร เลขที่
              และแผนกที่ต้องรับผิดชอบ
            </p>
          )}

          {/* Part D — ปุ่มเดียวต่อบทบาท (เดิมทุกคนเห็น "อัปเดต / ปิด")
              QA/ผู้บริหาร                 → "ตรวจสอบผลแก้ไข" (แก้สถานะ/ความรุนแรง/ปิดเคสได้)
              แผนกที่ถูกมอบหมายและยังไม่ตอบ → "รายงานผลแก้ไข" (เขียนผลแล้วส่ง QA ในคลิกเดียว)
              คนอื่น / เคสยังรอ QA คัดแยก   → ไม่มีปุ่ม เห็นแต่ช่องหมายเหตุ */}
          {(canReview || canRespond) && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditing((e) => !e)}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
              >
                {editing
                  ? "ปิดฟอร์ม"
                  : canReview
                    ? "ตรวจสอบผลแก้ไข"
                    : "รายงานผลแก้ไข"}
              </button>
            </div>
          )}
          {myDept?.responded_at && (
            <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              ✓ ฝ่ายคุณส่งผลแก้ไขให้ QA แล้ว
            </p>
          )}
          {editing &&
            (canReview ? (
              <UpdateForm
                jobNo={jobNo}
                dev={dev}
                canClose={canClose}
                onDone={() => setEditing(false)}
              />
            ) : (
              <ReportForm
                jobNo={jobNo}
                dev={dev}
                onDone={() => setEditing(false)}
              />
            ))}
          <CommentBox jobNo={jobNo} deviationId={dev.id} />
        </div>
      )}
    </li>
  );
}

/** D1: กล่องเพิ่มหมายเหตุของฝ่ายตน (append-only) */
function CommentBox({
  jobNo,
  deviationId,
}: {
  jobNo: string;
  deviationId: string;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    if (!body.trim()) return;
    setError(null);
    start(async () => {
      const res = await addDeviationComment(jobNo, deviationId, body);
      if (res.ok) {
        setBody("");
        router.refresh();
        return;
      }
      setError(res.error ?? "เพิ่มหมายเหตุไม่สำเร็จ");
    });
  }

  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <label className={labelClass}>เพิ่มหมายเหตุของฝ่ายคุณ</label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="บันทึกสิ่งที่ฝ่ายคุณตรวจพบ/ดำเนินการ (ไม่ทับของฝ่ายอื่น)"
        className={inputClass}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      <button
        type="button"
        disabled={pending || !body.trim()}
        onClick={submit}
        className="mt-2 rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
      >
        {pending ? "กำลังบันทึก…" : "＋ เพิ่มหมายเหตุ"}
      </button>
    </div>
  );
}

/** D2: ปุ่ม "แก้ไขเรียบร้อย — ส่งให้ QA ตรวจสอบ" */
/**
 * Part D — "รายงานผลแก้ไข" ของแผนกที่ถูกมอบหมาย
 *
 * เขียนผลแล้วส่งกลับให้ QA ในคลิกเดียว (เดิมต้องกด "อัปเดต / ปิด" แล้วออกมากด
 * ปุ่ม "ส่งกลับให้ QA" อีกที) · สถานะกับความรุนแรงโชว์ให้เห็นแต่แก้ไม่ได้ — เป็นสิทธิ์ของ QA
 */
function ReportForm({
  jobNo,
  dev,
  onDone,
}: {
  jobNo: string;
  dev: Deviation;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const statusLabel =
    DEVIATION_STATUS.find((s) => s.key === dev.status)?.label ?? dev.status;
  const severityLabel =
    DEVIATION_SEVERITY.find((s) => s.key === dev.severity)?.label ?? dev.severity;

  function submit() {
    setError(null);
    start(async () => {
      const res = await submitDeviationResolution(jobNo, dev.id, note);
      if (res.ok) {
        setNote("");
        router.refresh();
        onDone();
        return;
      }
      setError(res.error ?? "ส่งให้ QA ไม่สำเร็จ");
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-sky-300/60 bg-sky-50/50 p-3 dark:bg-sky-950/20">
      <p className="text-xs font-medium text-sky-900 dark:text-sky-300">
        รายงานผลแก้ไขของฝ่ายคุณ — กดส่งแล้วเคสกลับไปหา QA ทันที
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* สถานะ/ความรุนแรง: เห็นได้แต่แก้ไม่ได้ — เป็นสิทธิ์ของ QA */}
        <div>
          <label className={labelClass}>สถานะ 🔒</label>
          <div className={readOnlyClass}>{statusLabel}</div>
        </div>
        <div>
          <label className={labelClass}>ความรุนแรง 🔒</label>
          <div className={readOnlyClass}>{severityLabel}</div>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>สรุปสิ่งที่แก้ไข</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="เช่น เปลี่ยนตะแกรงใหม่ + สอบเทียบเครื่องแล้ว"
            className={inputClass}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        สถานะและความรุนแรงปรับได้เฉพาะ QA — ฝ่ายที่รับผิดชอบกรอกได้แค่ผลการแก้ไข
      </p>

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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังส่ง…" : "ส่งผลแก้ไขให้ QA"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

function UpdateForm({
  jobNo,
  dev,
  canClose,
  onDone,
}: {
  jobNo: string;
  dev: Deviation;
  canClose: boolean;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    status: dev.status as string,
    capa: dev.capa ?? "",
    severity: dev.severity as string,
    note: "",
  });
  // Part D: ตัดช่อง "กำหนดปิด" ออกจากฟอร์มนี้ — ไม่ส่ง p_due_date ไป RPC แล้ว
  // (update_deviation ใช้ coalesce(p_due_date, due_date) ค่าเดิมจึงคงอยู่)
  // ปิดก่อนที่แผนกจะส่งกลับครบ = ข้ามขั้น ต้องมีเหตุผลกำกับไว้ในประวัติ
  const skipping = v.status === "closed" && dev.status !== "qa_verify";
  const needNote = skipping || v.status === "cancelled";
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof typeof v>(k: K, val: string) {
    setV((c) => ({ ...c, [k]: val }));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await updateDeviation(jobNo, { id: dev.id, ...v });
      if (res.ok) {
        router.refresh();
        onDone();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        QA ตรวจสอบผลแก้ไข — ปรับสถานะ/ความรุนแรง หรือปิดเคส
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>สถานะ</label>
          <select
            value={v.status}
            onChange={(e) => set("status", e.target.value)}
            className={inputClass}
          >
            {DEVIATION_STATUS.map((s) => {
              const qaOnly = s.key === "closed" || s.key === "cancelled";
              return (
                <option key={s.key} value={s.key} disabled={qaOnly && !canClose}>
                  {s.label}
                  {qaOnly && !canClose ? " (เฉพาะ QA/ผู้บริหาร)" : ""}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label className={labelClass}>ความรุนแรง</label>
          <select
            value={v.severity}
            onChange={(e) => set("severity", e.target.value)}
            className={inputClass}
          >
            {DEVIATION_SEVERITY.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>การแก้ไขเบื้องต้น{v.status === "closed" ? " *" : ""}</label>
          <textarea
            value={v.capa}
            onChange={(e) => set("capa", e.target.value)}
            rows={2}
            className={inputClass}
          />
        </div>
        {needNote && (
          <div className="sm:col-span-2">
            <label className={labelClass}>
              {v.status === "cancelled" ? "เหตุผลที่ยกเลิก *" : "เหตุผลที่ปิดข้ามขั้น *"}
            </label>
            <input
              value={v.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder={
                v.status === "cancelled"
                  ? "เช่น เปิดผิดงาน / ไม่ใช่เหตุผิดปกติ"
                  : "เช่น แผนกยืนยันด้วยวาจาแล้ว / ไม่ต้องรอผลเพิ่ม"
              }
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {skipping
                ? "เคสนี้ยังไม่ผ่านขั้น \"แผนกส่งกลับ\" — เหตุผลจะถูกบันทึกลงประวัติ (audit)"
                : "เหตุผลจะถูกบันทึกลงประวัติ (audit) และ timeline ของเคส"}
            </p>
          </div>
        )}
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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

/**
 * ขั้นที่ 2 ของ flow — QA ตรวจสอบ (Part C.4 ก้อน 5)
 * QA คัดแยกประเภทเอกสาร (DEV/OOS/NC) + ใส่เลขที่ + ติ๊กแผนกที่ต้องรับผิดชอบ
 * เรียกซ้ำได้ตอนสถานะ in_progress เพื่อแก้รายชื่อแผนก (ถอดแผนกที่ยังไม่ตอบออกได้)
 */
function QaReviewForm({ jobNo, dev }: { jobNo: string; dev: Deviation }) {
  const first = dev.status === "qa_review";
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    case_type: dev.case_type ?? "",
    case_no: dev.case_no ?? "",
    due_date: dev.due_date ?? "",
    note: "",
  });
  const [depts, setDepts] = useState<string[]>(
    dev.departments.map((d) => d.role_group),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof typeof v>(k: K, val: string) {
    setV((c) => ({ ...c, [k]: val }));
  }

  function toggleDept(key: string) {
    setDepts((c) => (c.includes(key) ? c.filter((d) => d !== key) : [...c, key]));
  }

  function run(decision: "assign" | "cancel") {
    setError(null);
    start(async () => {
      const res = await qaReviewDeviation(jobNo, {
        id: dev.id,
        decision,
        case_type: v.case_type,
        case_no: v.case_no,
        departments: depts,
        due_date: v.due_date,
        note: v.note,
      });
      if (res.ok) {
        setOpen(false);
        setV((c) => ({ ...c, note: "" }));
        router.refresh();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  /**
   * 🐞 Part D — useState อ่านค่าตั้งต้นแค่ตอน mount เท่านั้น
   * หลัง router.refresh() React ยังเก็บ state เดิมไว้ (key ของ DeviationItem ไม่เปลี่ยน)
   * ทำให้แผนกที่เพิ่งถอดออกยัง "ติ๊กค้าง" และถ้ากดบันทึกซ้ำจะถูกใส่กลับเข้าไปจริงๆ
   * → ล้างค่าจาก props ใหม่ทุกครั้งที่เปิดฟอร์ม
   */
  function openForm() {
    setDepts(dev.departments.map((d) => d.role_group));
    setV({
      case_type: dev.case_type ?? "",
      case_no: dev.case_no ?? "",
      due_date: dev.due_date ?? "",
      note: "",
    });
    setError(null);
    setOpen(true);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openForm}
        className="rounded-md border border-violet-400 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-300"
      >
        {first ? "🔎 QA ตรวจสอบเคสนี้" : "🔎 แก้ไขการมอบหมาย"}
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-violet-400/50 bg-violet-50/50 p-3 dark:bg-violet-950/20">
      <p className="text-xs font-medium text-violet-900 dark:text-violet-300">
        QA ตรวจสอบ — ระบุประเภทเอกสาร เลขที่ และแผนกที่ต้องแก้ไข
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>ประเภทเคส *</label>
          <select
            value={v.case_type}
            onChange={(e) => set("case_type", e.target.value)}
            className={inputClass}
          >
            <option value="">— เลือกประเภท —</option>
            {INCIDENT_CASE_TYPE.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>
            {v.case_type ? CASE_NO_LABEL[v.case_type] : "เลขที่เอกสาร"} *
          </label>
          <input
            value={v.case_no}
            onChange={(e) => set("case_no", e.target.value)}
            placeholder="เช่น 68-001"
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            เลขจากระบบเอกสารคุณภาพ — พิมพ์เอง ระบบไม่ออกเลขให้
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>แผนกที่รับผิดชอบ * (เลือกได้หลายแผนก)</label>
          <div className="flex flex-wrap gap-2">
            {INCIDENT_DEPARTMENTS.map((d) => {
              const picked = depts.includes(d.key);
              const responded = dev.departments.find(
                (x) => x.role_group === d.key,
              )?.responded_at;
              return (
                <label
                  key={d.key}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                    picked ? "border-primary bg-primary/10 font-medium" : ""
                  } ${responded ? "opacity-60" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={picked}
                    disabled={!!responded}
                    onChange={() => toggleDept(d.key)}
                    className="h-3.5 w-3.5"
                  />
                  {d.code} · {d.label}
                  {responded ? " (ตอบแล้ว)" : ""}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            เคสจะเข้าสถานะ &quot;รอ QA อนุมัติ&quot; เมื่อทุกแผนกที่ติ๊กไว้บันทึกผลครบ ·
            แผนกที่ตอบแล้วถอดออกไม่ได้ (เป็นหลักฐานที่บันทึกไว้แล้ว)
          </p>
        </div>

        <div>
          <label className={labelClass}>กำหนดปิด</label>
          <input
            type="date"
            value={v.due_date}
            onChange={(e) => set("due_date", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>หมายเหตุ / เหตุผลที่ยกเลิก</label>
          <input
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run("assign")}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : "ส่งให้แผนกที่เกี่ยวข้อง"}
        </button>
        {first && (
          <button
            type="button"
            disabled={pending || !v.note.trim()}
            onClick={() => run("cancel")}
            className="rounded-md border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            ยกเลิกเคสนี้
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ปิดฟอร์ม
        </button>
      </div>
    </div>
  );
}

function OpenForm({ jobId, jobNo }: { jobId: string; jobNo: string }) {
  const [open, setOpen] = useState(false);
  // Part C.4: ไม่มี "กำหนดปิด" ตอนเปิดแล้ว — QA เป็นคนใส่ตอนตรวจสอบ
  const [v, setV] = useState({
    title: "",
    dev_type: "process",
    severity: "minor",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof typeof v>(k: K, val: string) {
    setV((c) => ({ ...c, [k]: val }));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await openDeviation(jobNo, { job_id: jobId, ...v });
      if (res.ok) {
        setV({ title: "", dev_type: "process", severity: "minor", description: "" });
        setOpen(false);
        router.refresh();
        return;
      }
      setError(res.error ?? "เปิดไม่สำเร็จ");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
      >
        ＋ เปิด Incident Case
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>หัวข้อ *</label>
          <input
            value={v.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="เช่น เครื่องตอกค้างระหว่างผลิต"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ประเภท</label>
          <select
            value={v.dev_type}
            onChange={(e) => set("dev_type", e.target.value)}
            className={inputClass}
          >
            {DEVIATION_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>ความรุนแรง</label>
          <select
            value={v.severity}
            onChange={(e) => set("severity", e.target.value)}
            className={inputClass}
          >
            {DEVIATION_SEVERITY.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>รายละเอียด</label>
          <textarea
            value={v.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            className={inputClass}
          />
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          เปิดแล้วเคสจะเข้าสถานะ &quot;รอ QA ตรวจสอบ&quot; และแจ้งเตือน QA ทันที —
          QA จะเป็นคนระบุประเภทเอกสาร เลขที่ แผนกที่รับผิดชอบ และกำหนดปิด
        </p>
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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังเปิด…" : "เปิด Incident Case"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
