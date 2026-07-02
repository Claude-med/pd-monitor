"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteJob } from "../actions";

/**
 * ปุ่มลบงาน (ข้อ 2) — เห็นเฉพาะผู้บริหาร/ผู้ดูแล
 * กด "ลบงาน" → ถามยืนยันซ้ำ + ต้องกรอกรหัสผ่าน (กันลบผิดงาน)
 */
export function DeleteJobButton({
  jobId,
  jobNo,
}: {
  jobId: string;
  jobNo: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function reset() {
    setOpen(false);
    setPassword("");
    setError(null);
  }

  function confirmDelete() {
    setError(null);
    start(async () => {
      const res = await deleteJob(jobId, jobNo, password);
      if (res?.error) return setError(res.error);
      // ลบสำเร็จ → กลับหน้าบอร์ด (งานนี้ไม่มีแล้ว)
      router.push("/board");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        🗑️ ลบงานนี้
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-red-300 bg-red-50/60 p-3 dark:bg-red-950/20">
      <p className="text-sm font-medium text-red-800 dark:text-red-300">
        ยืนยันลบงาน {jobNo}?
      </p>
      <p className="text-xs text-red-700 dark:text-red-400">
        การลบจะลบข้อมูลทั้งหมดของงานนี้ถาวร (บันทึกผลผลิต · ใบเบิก · ผลตรวจ QC/QA · เคลียร์ไลน์ · เหตุผิดปกติ · คลัง FG)
        และย้อนกลับไม่ได้ — กรอกรหัสผ่านเพื่อยืนยัน
      </p>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          ยืนยันรหัสผ่านเพื่อลบ (จำเป็น)
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
          disabled={pending || !password.trim()}
          onClick={confirmDelete}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "กำลังลบ…" : "ยืนยันลบงาน"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={reset}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
