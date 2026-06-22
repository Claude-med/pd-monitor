"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { availableTransitions } from "@/lib/data/job-constants";
import type { AppRole } from "@/lib/auth/dal";
import { changeStatus } from "../actions";

export function JobActions({
  jobId,
  jobNo,
  status,
  roles,
}: {
  jobId: string;
  jobNo: string;
  status: string;
  roles: AppRole[];
}) {
  const trans = availableTransitions(status, roles);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const router = useRouter();

  function run(to: string, r: string | null) {
    setError(null);
    start(async () => {
      const res = await changeStatus(jobId, jobNo, to, r);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setRejectOpen(null);
      setReason("");
      router.refresh();
    });
  }

  if (trans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        ไม่มีขั้นตอนที่สิทธิ์ของคุณทำได้ในสถานะนี้
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {trans.map((t) =>
          t.kind === "forward" ? (
            <button
              key={t.to}
              type="button"
              disabled={pending}
              onClick={() => run(t.to, null)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {t.label}
            </button>
          ) : (
            <button
              key={t.to}
              type="button"
              disabled={pending}
              onClick={() =>
                setRejectOpen((cur) => (cur === t.to ? null : t.to))
              }
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {t.label}
            </button>
          ),
        )}
      </div>

      {rejectOpen && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <label className="text-sm font-medium">
            เหตุผลการตีกลับ (จำเป็น)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="ระบุเหตุผลที่ไม่ผ่าน เพื่อให้ฝ่ายผลิตแก้ไข"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => run(rejectOpen, reason)}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              ยืนยันตีกลับ
            </button>
            <button
              type="button"
              onClick={() => {
                setRejectOpen(null);
                setReason("");
              }}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
