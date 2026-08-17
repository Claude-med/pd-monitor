"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { syncJobRoute } from "./route-actions";

/**
 * แถบเตือน "งานนี้ไม่มีขั้นตอนการผลิต" + ปุ่มซ่อม (Part 2.1)
 *
 * งานที่สร้างตอนผลิตภัณฑ์ยังไม่ได้ตั้ง route จะไม่มีสถานีให้เลือกเลย
 * และด่าน "ต้องตรวจ in-process QC ก่อนส่ง QC" จะไม่ทำงาน — ต้องซ่อมก่อนเริ่มผลิต
 */
export function MissingRouteBanner({
  jobNo,
  jobId,
  canFix,
}: {
  jobNo: string;
  jobId: string;
  canFix: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function fix() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await syncJobRoute(jobNo, jobId);
      if (res.ok) {
        setDone(res.count ?? 0);
        router.refresh();
        return;
      }
      setError(res.error ?? "เติมขั้นตอนการผลิตไม่สำเร็จ");
    });
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <p className="font-medium text-amber-800 dark:text-amber-300">
        ⚠️ งานนี้ยังไม่มีขั้นตอนการผลิต
      </p>
      <p className="mt-1 text-sm text-amber-800/90 dark:text-amber-300/90">
        เกิดจากตอนสร้างงาน ผลิตภัณฑ์ยังไม่ได้ตั้งขั้นตอนการผลิตไว้ ทำให้
        <strong> บันทึกผลผลิต / ตรวจ in-process QC ไม่ได้</strong> และ
        <strong> ด่านตรวจ QC ก่อนส่งงานจะไม่ทำงาน</strong>
      </p>

      {canFix ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={fix}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "กำลังเติม…" : "🔄 ดึงขั้นตอนการผลิตล่าสุดมาใส่งานนี้"}
          </button>
          <Link
            href="/recipes"
            className="rounded-md border border-amber-600/40 px-3 py-1.5 text-xs hover:bg-amber-500/10"
          >
            ไปตั้งขั้นตอนการผลิตที่หน้าผลิตภัณฑ์ →
          </Link>
        </div>
      ) : (
        <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-300/80">
          แจ้งฝ่ายวางแผน/ผู้บริหารให้กดเติมขั้นตอนการผลิตให้งานนี้
        </p>
      )}

      {done !== null && (
        <p className="mt-2 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          ✓ เติมขั้นตอนการผลิตแล้ว {done.toLocaleString("th-TH")} สถานี
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
