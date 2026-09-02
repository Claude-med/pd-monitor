"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  APPROVAL_STATUS_META,
  type ProductionRecordRow,
} from "@/lib/data/production-constants";
import { reviewRecord, reviewRecords } from "./record-actions";

/**
 * ช่อง "การอนุมัติ" ของบันทึกผลผลิต (Part E — ก้อน 4)
 *
 * แม่แบบมาจาก ReviewBar ของผลตรวจ in-process (quality-checks.tsx) เพราะเป็นการ
 * อนุมัติรายแถวเหมือนกัน — ต่างที่ผู้อนุมัติคือ "หัวหน้าฝ่ายผลิต" ไม่ใช่หัวหน้า QC
 *
 * กติกาที่สะท้อนมาจาก DB (0080 — DB เป็นด่านบังคับจริง):
 *   · อนุมัติได้เฉพาะแถวที่ยัง pending
 *   · ผู้อนุมัติต้องคนละคนกับผู้บันทึก (สองลายเซ็นตามแนว GMP)
 *   · การไม่อนุมัติต้องระบุเหตุผล
 */

function StatusBadge({ record }: { record: ProductionRecordRow }) {
  const meta = APPROVAL_STATUS_META[record.status];
  return (
    <span
      className="whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium text-white"
      title={
        record.approver_name
          ? `${meta.label} โดย ${record.approver_name}`
          : meta.label
      }
      style={{ backgroundColor: meta.color }}
    >
      {meta.label}
    </span>
  );
}

export function RecordApprovalCell({
  record,
  jobNo,
  canApprove,
  currentProfileId,
}: {
  record: ProductionRecordRow;
  jobNo: string;
  canApprove: boolean;
  currentProfileId: string;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function run(decision: "approve" | "reject") {
    setError(null);
    start(async () => {
      const res = await reviewRecord(jobNo, record.id, decision, note);
      if (res.ok) {
        setRejecting(false);
        setNote("");
        router.refresh();
        return;
      }
      setError(res.error ?? "ดำเนินการไม่สำเร็จ");
    });
  }

  // พิจารณาไปแล้ว — โชว์ผลอย่างเดียว (พร้อมเหตุผลถ้าไม่อนุมัติ)
  if (record.status !== "pending") {
    return (
      <span className="flex flex-col gap-1">
        <StatusBadge record={record} />
        {record.approve_note && (
          <span className="text-xs text-muted-foreground">
            เหตุผล: {record.approve_note}
          </span>
        )}
      </span>
    );
  }

  const isRecorder =
    record.created_by_id === currentProfileId ||
    record.operator_id === currentProfileId;

  if (!canApprove || isRecorder) {
    return (
      <span className="flex flex-col gap-1">
        <StatusBadge record={record} />
        <span className="text-xs text-muted-foreground">
          {isRecorder
            ? "ผู้อนุมัติต้องเป็นคนละคนกับผู้บันทึก"
            : "รอหัวหน้าฝ่ายผลิตพิจารณา"}
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => run("approve")}
          className="whitespace-nowrap rounded-md border border-emerald-500/40 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
        >
          ✓ อนุมัติ
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setRejecting((v) => !v)}
          className="whitespace-nowrap rounded-md border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          ✕ ไม่อนุมัติ
        </button>
      </span>
      {rejecting && (
        <span className="flex flex-col gap-1">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เหตุผลที่ไม่อนุมัติ (บังคับ)"
            className="w-44 rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            disabled={pending || !note.trim()}
            onClick={() => run("reject")}
            className="w-fit rounded-md bg-destructive px-2 py-0.5 text-xs text-destructive-foreground disabled:opacity-50"
          >
            ยืนยันไม่อนุมัติ
          </button>
        </span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------
 * การเลือกหลายรายการ
 *
 * ตารางบันทึกผลผลิตเรนเดอร์ฝั่ง server (page.tsx) แต่การติ๊กเลือกต้องมี state ฝั่ง client
 * → ใช้ context: provider เป็น Client Component ครอบตารางที่ server เรนเดอร์ไว้
 *   ส่วน checkbox แต่ละแถวเป็น Client Component เล็ก ๆ ที่อ่าน context เดียวกัน
 * ---------------------------------------------------------------- */

type SelectionCtx = {
  selected: string[];
  toggle: (id: string) => void;
  setSelected: (ids: string[]) => void;
  pendingIds: string[];
};

const Ctx = createContext<SelectionCtx | null>(null);

export function ApprovalSelectionProvider({
  pendingIds,
  children,
}: {
  pendingIds: string[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const value = useMemo<SelectionCtx>(
    () => ({
      selected,
      pendingIds,
      setSelected,
      toggle: (id) =>
        setSelected((cur) =>
          cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
        ),
    }),
    [selected, pendingIds],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** ช่องติ๊กของแต่ละแถว — โผล่เฉพาะแถวที่ยังรออนุมัติและผู้ใช้อนุมัติได้จริง */
export function RecordPickCheckbox({ id }: { id: string }) {
  const ctx = useContext(Ctx);
  if (!ctx || !ctx.pendingIds.includes(id)) return null;
  return (
    <input
      type="checkbox"
      aria-label="เลือกรายการนี้เพื่ออนุมัติ"
      checked={ctx.selected.includes(id)}
      onChange={() => ctx.toggle(id)}
    />
  );
}

/**
 * แถบอนุมัติหลายรายการ — หน้างานบันทึกวันละหลายแถว × หลายสถานี กดทีละใบไม่ไหว
 * แถวที่ตัวเองเป็นผู้บันทึกจะถูก DB ข้ามให้เอง แล้วรายงานจำนวนกลับมา
 */
export function BulkApprovalBar({ jobNo }: { jobNo: string }) {
  const ctx = useContext(Ctx);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!ctx || ctx.pendingIds.length === 0) return null;
  const { selected, pendingIds, setSelected } = ctx;
  const allPicked = pendingIds.every((id) => selected.includes(id));

  function submit() {
    setMsg(null);
    setError(null);
    start(async () => {
      const res = await reviewRecords(jobNo, selected, "approve", "");
      if (res.ok) {
        setSelected([]);
        setMsg(
          `อนุมัติแล้ว ${res.approved} รายการ` +
            (res.skipped
              ? ` · ข้าม ${res.skipped} รายการ (เป็นบันทึกของคุณเอง หรือถูกพิจารณาไปแล้ว)`
              : ""),
        );
        router.refresh();
        return;
      }
      setError(res.error ?? "ดำเนินการไม่สำเร็จ");
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={allPicked}
          onChange={() => setSelected(allPicked ? [] : pendingIds)}
        />
        เลือกทั้งหมดที่รออนุมัติ ({pendingIds.length})
      </label>
      <button
        type="button"
        disabled={pending || selected.length === 0}
        onClick={submit}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? "กำลังอนุมัติ…" : `อนุมัติที่เลือก (${selected.length})`}
      </button>
      {msg && (
        <span className="text-xs text-emerald-700 dark:text-emerald-400">
          {msg}
        </span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
