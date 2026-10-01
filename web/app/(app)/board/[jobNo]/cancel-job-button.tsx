"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelJob, restoreJob } from "../actions";
import { displayJobNo } from "@/lib/format";

/**
 * ปุ่มยกเลิกงาน / คืนงาน (0109 · แทนปุ่มลบงานเดิม)
 *   mode "cancel"  — หัวหน้าแผนกก่อนเริ่มผลิต · ผู้บริหาร/ผู้ดูแลทุกสถานะยกเว้น FG (canCancelJob)
 *   mode "restore" — ผู้บริหาร/ผู้ดูแล คืนงานที่ยกเลิกผิด (canRestoreJob)
 * กดแล้วเปิดแผงยืนยัน: ต้องกรอกเหตุผล + รหัสผ่าน (กันกดผิดงาน · เหตุผลเก็บลง audit)
 */
export function CancelJobButton({
  jobId,
  jobNo,
  mode = "cancel",
}: {
  jobId: string;
  jobNo: string;
  mode?: "cancel" | "restore";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const isCancel = mode === "cancel";
  const what = isCancel ? "ยกเลิกงาน" : "คืนงาน";

  function reset() {
    setOpen(false);
    setReason("");
    setPassword("");
    setError(null);
  }

  function confirm() {
    setError(null);
    start(async () => {
      const action = isCancel ? cancelJob : restoreJob;
      const res = await action(jobId, jobNo, reason, password);
      if (res?.error) return setError(res.error);
      // อยู่หน้าเดิม — งานยังอยู่ แค่สถานะเปลี่ยน
      reset();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          isCancel
            ? "rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            : "rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        }
      >
        {isCancel ? "🚫 ยกเลิกงานนี้" : "↩️ คืนงานนี้ (ยกเลิกผิด)"}
      </button>
    );
  }

  const tone = isCancel
    ? "border-red-300 bg-red-50/60 dark:bg-red-950/20"
    : "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20";
  const ready = reason.trim().length >= 5 && password.trim().length > 0;

  return (
    <div className={`space-y-3 rounded-md border p-3 ${tone}`}>
      <p className="text-sm font-medium">
        ยืนยัน{what} {displayJobNo(jobNo)}?
      </p>
      <p className="text-xs text-muted-foreground">
        {isCancel
          ? "งานจะถูกย้ายออกจากบอร์ด และแก้ไขอะไรไม่ได้อีก · ข้อมูลทั้งหมด (บันทึกผลผลิต · ผลตรวจ · ลายเซ็น) ยังเก็บไว้ครบ ดูย้อนหลังได้ · คำขอแก้ไขที่ค้างอยู่จะถูกปิดให้อัตโนมัติ"
          : "งานจะกลับไปสถานะก่อนถูกยกเลิก และกลับมาแสดงบนบอร์ดตามปกติ"}
      </p>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          เหตุผล (จำเป็น · อย่างน้อย 5 ตัวอักษร)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={isCancel ? "เช่น ลูกค้ายกเลิกคำสั่งผลิต / สร้างงานซ้ำ" : "เช่น กดยกเลิกผิดงาน"}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          ยืนยันรหัสผ่าน (จำเป็น)
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="รหัสผ่านบัญชีของคุณ"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !ready}
          onClick={confirm}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            isCancel ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
          }`}
        >
          {pending ? "กำลังบันทึก…" : `ยืนยัน${what}`}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={reset}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          ปิด
        </button>
      </div>
    </div>
  );
}
