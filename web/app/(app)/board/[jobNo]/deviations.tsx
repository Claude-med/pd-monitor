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
} from "@/lib/data/deviation-constants";
import { STATION_LABEL } from "@/lib/data/station-constants";
import { openDeviation, updateDeviation } from "./deviation-actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export type FailCheck = { id: string; station: string; param: string };

export function Deviations({
  jobId,
  jobNo,
  deviations,
  failChecks,
  canOpen,
  canClose,
}: {
  jobId: string;
  jobNo: string;
  deviations: Deviation[];
  failChecks: FailCheck[];
  canOpen: boolean;
  canClose: boolean;
}) {
  const openCount = deviations.filter((d) => d.status !== "closed").length;

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">⚠️ Deviation / เหตุผิดปกติ</h2>
        <span className="text-xs text-muted-foreground">
          {deviations.length} รายการ
          {openCount > 0 && (
            <span className="ml-1 text-destructive">· เปิดค้าง {openCount}</span>
          )}
        </span>
      </div>

      {openCount > 0 && (
        <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          มี deviation เปิดค้าง — ต้องปิดให้ครบก่อน QA จึงจะปล่อยผ่านเข้าคลัง (FG) ได้
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
              canOpen={canOpen}
              canClose={canClose}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">ไม่มี deviation</p>
      )}

      {/* quick-open จากผลตรวจระหว่างผลิตที่ไม่ผ่าน */}
      {canOpen && failChecks.length > 0 && (
        <div className="mt-4 rounded-md border border-dashed bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            ผลตรวจระหว่างผลิตที่ "ไม่ผ่าน" — เปิด deviation ได้เลย:
          </p>
          <div className="flex flex-wrap gap-2">
            {failChecks.map((c) => (
              <FailQuickOpen key={c.id} jobId={jobId} jobNo={jobNo} check={c} />
            ))}
          </div>
        </div>
      )}

      {/* เปิด deviation ใหม่ */}
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
  canOpen,
  canClose,
}: {
  jobNo: string;
  dev: Deviation;
  canOpen: boolean;
  canClose: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const closed = dev.status === "closed";

  return (
    <li
      className="rounded-md border border-l-4 bg-card p-3 text-sm"
      style={{ borderLeftColor: SEVERITY_COLOR[dev.severity] ?? "#64748b" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(dev.status)}
        {severityBadge(dev.severity)}
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
        <span>{new Date(dev.created_at).toLocaleString("th-TH")}</span>
      </div>

      {(dev.root_cause || dev.capa) && (
        <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2 text-xs">
          {dev.root_cause && (
            <p>
              <span className="font-medium">สาเหตุ:</span> {dev.root_cause}
            </p>
          )}
          {dev.capa && (
            <p>
              <span className="font-medium">การแก้ไข/ป้องกัน (CAPA):</span> {dev.capa}
            </p>
          )}
          {closed && dev.closed_at && (
            <p className="text-muted-foreground">
              ปิดเมื่อ {new Date(dev.closed_at).toLocaleString("th-TH")}
            </p>
          )}
        </div>
      )}

      {canOpen && !closed && (
        <div className="mt-2">
          {editing ? (
            <UpdateForm
              jobNo={jobNo}
              dev={dev}
              canClose={canClose}
              onDone={() => setEditing(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
            >
              อัปเดต / ปิด
            </button>
          )}
        </div>
      )}
    </li>
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
    root_cause: dev.root_cause ?? "",
    capa: dev.capa ?? "",
    severity: dev.severity as string,
    due_date: dev.due_date ?? "",
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>สถานะ</label>
          <select
            value={v.status}
            onChange={(e) => set("status", e.target.value)}
            className={inputClass}
          >
            {DEVIATION_STATUS.map((s) => (
              <option key={s.key} value={s.key} disabled={s.key === "closed" && !canClose}>
                {s.label}
                {s.key === "closed" && !canClose ? " (เฉพาะ QA/ผู้บริหาร)" : ""}
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
          <label className={labelClass}>สาเหตุ (root cause){v.status === "closed" ? " *" : ""}</label>
          <textarea
            value={v.root_cause}
            onChange={(e) => set("root_cause", e.target.value)}
            rows={2}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>การแก้ไข/ป้องกัน CAPA{v.status === "closed" ? " *" : ""}</label>
          <textarea
            value={v.capa}
            onChange={(e) => set("capa", e.target.value)}
            rows={2}
            className={inputClass}
          />
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

function FailQuickOpen({
  jobId,
  jobNo,
  check,
}: {
  jobId: string;
  jobNo: string;
  check: FailCheck;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function open() {
    setError(null);
    start(async () => {
      const res = await openDeviation(jobNo, {
        job_id: jobId,
        title: `ผลตรวจไม่ผ่าน: ${check.param}`,
        description: `สถานี ${STATION_LABEL[check.station] ?? check.station} — หัวข้อ ${check.param}`,
        dev_type: "in_process_fail",
        severity: "major",
        inprocess_check_id: check.id,
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(res.error ?? "เปิดไม่สำเร็จ");
    });
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        onClick={open}
        className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        {pending ? "กำลังเปิด…" : `＋ ${check.param}`}
      </button>
      {error && <span className="mt-0.5 text-[11px] text-destructive">{error}</span>}
    </span>
  );
}

function OpenForm({ jobId, jobNo }: { jobId: string; jobNo: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    title: "",
    dev_type: "process",
    severity: "minor",
    description: "",
    due_date: "",
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
        setV({ title: "", dev_type: "process", severity: "minor", description: "", due_date: "" });
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
        ＋ เปิด deviation
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
        <div>
          <label className={labelClass}>กำหนดปิด</label>
          <input
            type="date"
            value={v.due_date}
            onChange={(e) => set("due_date", e.target.value)}
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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังเปิด…" : "เปิด deviation"}
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
