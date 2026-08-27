"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary ของทุกหน้าในแอป (Part C.4 ก้อน 1)
 *
 * ก่อนหน้านี้ทั้งโปรเจคไม่มี error.tsx เลย → error ฝั่ง server ใดๆ กลายเป็นจอ default ของ Next
 * ("This page couldn't load / A server error occurred") ที่ไม่บอกอะไร และไม่มีทางกลับ
 *
 * ⚠️ Next 16 prop คือ `unstable_retry` ไม่ใช่ `reset`
 *    (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md)
 * ⚠️ error boundary ต้องเป็น Client Component เสมอ
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // production จะได้ข้อความ generic + digest — ต้องเอา digest ไปหาใน server log
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <div className="text-4xl">⚠️</div>
      <h1 className="text-xl font-bold">หน้านี้โหลดไม่สำเร็จ</h1>
      <p className="text-sm text-muted-foreground">
        เกิดข้อผิดพลาดระหว่างเตรียมข้อมูล ลองกดโหลดใหม่อีกครั้ง
        ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิงด้านล่าง
      </p>
      {error.digest && (
        <p className="rounded-md bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
          รหัสอ้างอิง: {error.digest}
        </p>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          ลองใหม่
        </button>
        <Link
          href="/"
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          กลับหน้าแรก
        </Link>
      </div>
    </div>
  );
}
