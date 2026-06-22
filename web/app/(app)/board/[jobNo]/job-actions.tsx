"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  availableTransitions,
  type Transition,
} from "@/lib/data/job-constants";
import type { AppRole } from "@/lib/auth/dal";
import { changeStatus, signDecision } from "../actions";

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
  const [openKey, setOpenKey] = useState<string | null>(null); // transition.to ที่เปิดแผงอยู่
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();

  function reset() {
    setOpenKey(null);
    setReason("");
    setPassword("");
  }

  // เปลี่ยนสถานะธรรมดา (ไม่ต้องลงนาม)
  function runForward(to: string) {
    setError(null);
    start(async () => {
      const res = await changeStatus(jobId, jobNo, to, null);
      if (res?.error) return setError(res.error);
      reset();
      router.refresh();
    });
  }

  // ลงนามตัดสินคุณภาพ QC/QA (ยืนยันรหัสผ่าน)
  function runSign(t: Transition) {
    setError(null);
    const decision = t.kind === "forward" ? "approve" : "reject";
    start(async () => {
      const res = await signDecision(
        jobId,
        jobNo,
        t.stage!,
        decision,
        reason,
        password,
      );
      if (res?.error) return setError(res.error);
      reset();
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
        {trans.map((t) => {
          const isReject = t.kind === "reject";
          const btnClass = isReject
            ? "rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            : "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";

          // ต้องลงนาม → ปุ่มเปิด/ปิดแผง · ไม่ต้องลงนาม → ทำทันที
          const onClick = t.esign
            ? () => setOpenKey((cur) => (cur === t.to ? null : t.to))
            : () => runForward(t.to);

          return (
            <button
              key={t.to}
              type="button"
              disabled={pending}
              onClick={onClick}
              className={btnClass}
            >
              {t.esign ? "🖊️ " : ""}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* แผงลงนาม (e-signature) — โผล่เมื่อกดปุ่ม QC/QA ที่ต้องลงนาม */}
      {trans.map((t) =>
        t.esign && openKey === t.to ? (
          <div
            key={`panel-${t.to}`}
            className="space-y-3 rounded-md border bg-muted/30 p-3"
          >
            <p className="text-sm font-medium">
              ลงนาม{t.kind === "forward" ? "อนุมัติ" : "ตีกลับ"} ({t.stage?.toUpperCase()})
            </p>

            {t.kind === "reject" && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  เหตุผลที่ไม่ผ่าน (จำเป็น)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="ระบุเหตุผลเพื่อให้ฝ่ายผลิตแก้ไข"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                ยืนยันรหัสผ่านเพื่อลงนาม (จำเป็น)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="รหัสผ่านบัญชีของคุณ"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                ระบบบันทึกลายเซ็น (ใคร/ผลตัดสิน/เวลา) เพื่อการตรวจสอบย้อนหลัง
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={
                  pending ||
                  !password.trim() ||
                  (t.kind === "reject" && !reason.trim())
                }
                onClick={() => runSign(t)}
                className={
                  t.kind === "reject"
                    ? "rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    : "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                }
              >
                {pending ? "กำลังลงนาม…" : "ยืนยันลงนาม"}
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        ) : null,
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
