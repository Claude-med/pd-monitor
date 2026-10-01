"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signDecision } from "../board/actions";
import {
  reviewInprocessCheck,
  reviewQaSample,
} from "../board/[jobNo]/quality-actions";

// Part I ก้อน 4 — ปุ่มอนุมัติ/ไม่อนุมัติ "ท้ายการ์ด" ในหน้าตรวจ QC/QA
//   เรียก server action ตัวเดียวกับหน้างานทุกปุ่ม ⇒ สิทธิ์ · สองลายเซ็น · ด่าน GMP ชุดเดียวกัน
//   ลงนามทั้งงาน (QC/QA) ต้องกรอกรหัสผ่านซ้ำเหมือนเดิม (e-signature)

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const approveBtn =
  "rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50";
const rejectBtn =
  "rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";

/** ผลตรวจ in-process — หัวหน้า QC (ไม่อนุมัติต้องมีเหตุผล · DB ห้ามอนุมัติผลของตัวเอง) */
export function InprocessReviewButtons({ jobNo, id }: { jobNo: string; id: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function run(decision: "approve" | "reject") {
    setError(null);
    start(async () => {
      const res = await reviewInprocessCheck(jobNo, id, decision, note);
      if (res.error) return setError(res.error);
      setRejecting(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {rejecting ? (
        <>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เหตุผลที่ไม่อนุมัติ (จำเป็น)"
            className={inputClass}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !note.trim()}
              onClick={() => run("reject")}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              ยืนยันไม่อนุมัติ
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              ยกเลิก
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run("approve")}
            className={approveBtn}
          >
            {pending ? "กำลังบันทึก…" : "✓ อนุมัติ"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRejecting(true)}
            className={rejectBtn}
          >
            ✕ ไม่อนุมัติ
          </button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * จุดเก็บตัวอย่าง — หัวหน้า QA เลือกผลสุดท้าย (ไม่จำเป็นต้องตรงกับที่ลูกน้องเสนอ)
 * "อนุมัติ ไม่ผ่าน" → DB เปิด Incident Case ให้เอง (0096)
 */
export function SampleReviewButtons({ jobNo, id }: { jobNo: string; id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function run(result: "pass" | "fail") {
    setError(null);
    start(async () => {
      const res = await reviewQaSample(jobNo, id, result);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run("pass")}
          className={approveBtn}
        >
          ✅ อนุมัติ ผ่าน
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run("fail")}
          className={rejectBtn}
        >
          ❌ อนุมัติ ไม่ผ่าน
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * ลงนาม QC / QA ทั้งงาน — อนุมัติ (ส่งต่อ) / ไม่อนุมัติ (ตีกลับไปผลิต)
 * blocked = ยังมีสิ่งขวางการปล่อยผ่าน → ปิดปุ่มอนุมัติไว้ (ตีกลับยังทำได้)
 * canApprove = false → ไม่แสดงปุ่มอนุมัติเลย (พนักงาน QA: ปล่อยผ่าน FG ได้เฉพาะหัวหน้า QA)
 */
export function SignButtons({
  jobId,
  jobNo,
  stage,
  blocked,
  canApprove = true,
}: {
  jobId: string;
  jobNo: string;
  stage: "qc" | "qa";
  blocked: boolean;
  canApprove?: boolean;
}) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const approveLabel = stage === "qc" ? "QC ผ่าน → ส่ง QA" : "QA ปล่อยผ่าน → FG";

  function reset() {
    setMode(null);
    setReason("");
    setPassword("");
  }

  function run() {
    if (!mode) return;
    setError(null);
    start(async () => {
      const res = await signDecision(jobId, jobNo, stage, mode, reason, password);
      if (res?.error) return setError(res.error);
      reset();
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {canApprove && (
            <button
              type="button"
              disabled={pending || blocked}
              onClick={() => setMode("approve")}
              className={approveBtn}
              title={blocked ? "ยังมีสิ่งที่ต้องเคลียร์ก่อน (ดูรายการด้านบน)" : undefined}
            >
              🖊️ อนุมัติ ({approveLabel})
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode("reject")}
            className={rejectBtn}
          >
            🖊️ ไม่อนุมัติ (ตีกลับไปผลิต)
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium">
            ลงนาม{mode === "approve" ? "อนุมัติ" : "ไม่อนุมัติ"} ({stage.toUpperCase()})
          </p>
          {mode === "reject" && (
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="เหตุผลที่ไม่ผ่าน (จำเป็น) — ฝ่ายผลิตจะเห็นเพื่อแก้ไข"
              className={inputClass}
            />
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="ยืนยันรหัสผ่านเพื่อลงนาม (จำเป็น)"
            className={inputClass}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                pending || !password.trim() || (mode === "reject" && !reason.trim())
              }
              onClick={run}
              className={
                mode === "reject"
                  ? "rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  : approveBtn
              }
            >
              {pending ? "กำลังลงนาม…" : "ยืนยันลงนาม"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              ยกเลิก
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            ระบบบันทึกลายเซ็น (ใคร/ผลตัดสิน/เวลา) ลง &ldquo;การลงนามล่าสุด&rdquo; เพื่อการตรวจสอบย้อนหลัง
          </p>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
