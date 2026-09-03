"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteUser } from "./actions";

/**
 * ปุ่มลบบัญชีผู้ใช้ (ทีละบัญชี) — อยู่ท้ายแผงแก้ไขของแต่ละคนในส่วน "ผู้ใช้ทั้งหมด"
 * กด "ลบบัญชี" → ถามยืนยันซ้ำ + ต้องกรอกรหัสผ่านของผู้กด (กันลบผิดคน)
 *
 * โครงเดียวกับ DeleteJobButton (board/[jobNo]/delete-job-button.tsx) — inline confirm panel
 * ⚠️ ใครลบใครได้ ตัดสินที่ admin_delete_user() ใน DB (0082) ที่นี่แค่หน้าจอ
 */
export function DeleteUserButton({
  profileId,
  authUserId,
  fullName,
}: {
  profileId: string;
  authUserId: string | null;
  fullName: string;
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
      const res = await deleteUser(profileId, authUserId, password);
      if (!res.ok) return setError(res.error ?? "ลบบัญชีไม่สำเร็จ");
      // ลบสำเร็จแต่มีคำเตือน (ลบบัญชีล็อกอินไม่ผ่าน) → ค้างข้อความไว้ให้อ่านก่อน
      if (res.error) return setError(res.error);
      reset();
      router.refresh(); // แถวนี้จะหายจากรายชื่อเอง
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
      >
        🗑️ ลบบัญชีนี้
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-red-300 bg-red-50/60 p-3 dark:bg-red-950/20">
      <p className="text-sm font-medium text-red-800 dark:text-red-300">
        ยืนยันลบบัญชี &ldquo;{fullName}&rdquo;?
      </p>
      <p className="text-xs text-red-700 dark:text-red-400">
        บัญชีนี้จะ <span className="font-medium">ล็อกอินไม่ได้อีก</span> และหายจากรายชื่อผู้ใช้ ·
        ประวัติการทำงานและลายเซ็นเดิม (บันทึกผลผลิต · ผลตรวจ · Audit) ยังถูกเก็บไว้ครบตามข้อกำหนด GMP
        — ย้อนกลับไม่ได้ · กรอกรหัสผ่านเพื่อยืนยัน
      </p>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          ยืนยันรหัสผ่านของคุณ (จำเป็น)
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
          {pending ? "กำลังลบ…" : "ยืนยันลบบัญชี"}
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
