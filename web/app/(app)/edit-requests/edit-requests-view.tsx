"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EditRequest } from "@/lib/data/edit-requests";
import type { AppRole } from "@/lib/auth/dal";
import {
  EDIT_TARGET_LABEL,
  canReviewEdit,
  fieldLabel,
} from "@/lib/data/edit-request-constants";
import { fmtDateTime } from "@/lib/format";
import { reviewEditRequest } from "./actions";

export function EditRequestsView({
  items,
  befores,
  roles,
}: {
  items: EditRequest[];
  befores: Record<string, Record<string, string>>;
  roles: AppRole[];
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
        ไม่มีคำขอแก้ไขที่รออนุมัติ
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {items.map((r) => (
        <RequestCard
          key={r.id}
          req={r}
          before={befores[r.id] ?? {}}
          canReview={canReviewEdit(roles, r.target_type)}
        />
      ))}
    </div>
  );
}

function RequestCard({
  req,
  before,
  canReview,
}: {
  req: EditRequest;
  before: Record<string, string>;
  canReview: boolean;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function run(decision: "approve" | "reject") {
    setError(null);
    if (decision === "reject" && !note.trim()) {
      setError("กรุณาระบุเหตุผลที่ปฏิเสธ");
      return;
    }
    start(async () => {
      const res = await reviewEditRequest(req.id, decision, note);
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(res.error ?? "ดำเนินการไม่สำเร็จ");
    });
  }

  const changeKeys = Object.keys(req.changes);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {EDIT_TARGET_LABEL[req.target_type]}
          </span>
          {req.job_no && (
            <Link
              href={`/board/${encodeURIComponent(req.job_no)}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {req.job_no}
            </Link>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {req.requester_name ?? "—"} · {fmtDateTime(req.requested_at)}
        </span>
      </div>

      {/* diff ค่าเดิม → ค่าใหม่ */}
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">ฟิลด์</th>
              <th className="px-2 py-1.5 font-medium">ค่าเดิม</th>
              <th className="px-2 py-1.5 font-medium">ค่าใหม่</th>
            </tr>
          </thead>
          <tbody>
            {changeKeys.map((k) => (
              <tr key={k} className="border-b last:border-0">
                <td className="px-2 py-1.5">{fieldLabel(k)}</td>
                <td className="px-2 py-1.5 text-muted-foreground line-through">
                  {before[k] === "" || before[k] == null ? "—" : before[k]}
                </td>
                <td className="px-2 py-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  {req.changes[k] === null || req.changes[k] === ""
                    ? "—"
                    : String(req.changes[k])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">เหตุผล: </span>
        {req.reason}
      </p>

      {canReview ? (
        <div className="mt-3 space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="หมายเหตุผู้อนุมัติ (จำเป็นเมื่อปฏิเสธ)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run("approve")}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "กำลังดำเนินการ…" : "✅ อนุมัติ + แก้ให้"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run("reject")}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              ปฏิเสธ
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          🔒 คำขอนี้ต้องให้ผู้จัดการอนุมัติ
        </p>
      )}
    </div>
  );
}
