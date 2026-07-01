"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EditTargetType } from "@/lib/data/edit-request-constants";
import { requestEdit } from "./edit-request-actions";

export type EditField = {
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "select";
  current: string; // ค่าปัจจุบัน (string) — ใช้ prefill + เทียบว่าเปลี่ยนไหม
  options?: { value: string; label: string }[];
};

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export function EditRequestButton({
  targetType,
  targetId,
  jobNo,
  fields,
  hasPending,
}: {
  targetType: EditTargetType;
  targetId: string;
  jobNo: string;
  fields: EditField[];
  hasPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.current])),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (hasPending) {
    return (
      <span className="whitespace-nowrap rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
        ⏳ รออนุมัติแก้ไข
      </span>
    );
  }

  function submit() {
    setError(null);
    // เก็บเฉพาะฟิลด์ที่เปลี่ยนค่า
    const changes: Record<string, string | null> = {};
    for (const f of fields) {
      const nv = (vals[f.key] ?? "").trim();
      if (nv === f.current.trim()) continue;
      changes[f.key] = f.kind !== "text" && nv === "" ? null : nv;
    }
    if (Object.keys(changes).length === 0) {
      setError("ยังไม่มีการแก้ไข (ค่ายังเหมือนเดิม)");
      return;
    }
    if (!reason.trim()) {
      setError("กรุณาระบุเหตุผลการขอแก้ไข");
      return;
    }
    start(async () => {
      const res = await requestEdit(jobNo, targetType, targetId, changes, reason);
      if (res.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
        return;
      }
      setError(res.error ?? "ส่งคำขอไม่สำเร็จ");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-md border px-2 py-1 text-xs hover:bg-accent"
      >
        ✏️ ขอแก้ไข
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border bg-muted/30 p-3 text-left">
      <p className="text-xs font-medium text-muted-foreground">
        ขอแก้ไขย้อนหลัง (ต้องได้รับอนุมัติก่อน)
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {f.label}
            </label>
            {f.kind === "select" ? (
              <select
                value={vals[f.key] ?? ""}
                onChange={(e) =>
                  setVals((c) => ({ ...c, [f.key]: e.target.value }))
                }
                className={inputClass}
              >
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                step={f.kind === "number" ? "any" : undefined}
                value={vals[f.key] ?? ""}
                onChange={(e) =>
                  setVals((c) => ({ ...c, [f.key]: e.target.value }))
                }
                className={inputClass}
              />
            )}
          </div>
        ))}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          เหตุผลการขอแก้ไข *
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="ระบุเหตุผลเพื่อให้ผู้อนุมัติพิจารณา"
          className={inputClass}
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
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังส่ง…" : "ส่งคำขอแก้ไข"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
