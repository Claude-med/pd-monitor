"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  REQ_STATUS_LABEL,
  REQ_STATUS_COLOR,
} from "@/lib/data/requisition-constants";
import type { RequisitionRow, SelectableLot } from "@/lib/data/requisitions";
import {
  requestMaterial,
  issueRequisition,
  cancelRequisition,
} from "./requisition-actions";

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="rounded px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: REQ_STATUS_COLOR[status] ?? "#64748b" }}
    >
      {REQ_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Requisitions({
  jobId,
  jobNo,
  jobStatus,
  requisitions,
  lots,
  canRequest,
  canIssue,
  currentProfileId,
}: {
  jobId: string;
  jobNo: string;
  jobStatus: string;
  requisitions: RequisitionRow[];
  lots: SelectableLot[];
  canRequest: boolean;
  canIssue: boolean;
  currentProfileId: string;
}) {
  const [open, setOpen] = useState(false);
  const [lotId, setLotId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    start(async () => {
      const res = await requestMaterial(jobNo, jobId, lotId, qty, note);
      if (res.ok) {
        setLotId("");
        setQty("");
        setNote("");
        setOpen(false);
        router.refresh();
        return;
      }
      setError(res.error ?? "ขอเบิกไม่สำเร็จ");
    });
  }

  function act(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error ?? "ทำรายการไม่สำเร็จ");
    });
  }

  // เตือนช่วงที่ควรมีวัตถุดิบแล้ว (มีแผน/กำลังผลิต) แต่ยังไม่ได้เบิก/จ่าย
  const issuedCount = requisitions.filter((r) => r.status === "issued").length;
  const requestedCount = requisitions.filter((r) => r.status === "requested").length;
  const shouldHaveMaterials = jobStatus === "planned" || jobStatus === "in_production";
  let warn: { tone: "warn" | "info"; text: string } | null = null;
  if (shouldHaveMaterials && issuedCount === 0) {
    warn =
      requestedCount > 0
        ? {
            tone: "info",
            text: `มีใบเบิกรอฝ่ายคลังจ่าย ${requestedCount} รายการ — ยังไม่ได้จ่ายจริง (สต็อกยังไม่ถูกตัด)`,
          }
        : {
            tone: "warn",
            text: "⚠️ ยังไม่ได้เบิกวัตถุดิบสำหรับงานนี้ — ควรเบิกก่อน/ระหว่างเริ่มผลิต",
          };
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">เบิกวัตถุดิบ</h2>
        <span className="text-xs text-muted-foreground">
          {requisitions.length} รายการ
        </span>
      </div>

      {warn && (
        <div
          className={[
            "mb-3 rounded-md px-3 py-2 text-sm",
            warn.tone === "warn"
              ? "border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-300"
              : "border bg-muted/40 text-muted-foreground",
          ].join(" ")}
        >
          {warn.text}
        </div>
      )}

      {requisitions.length > 0 ? (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">วัตถุดิบ · ล็อต</th>
                <th className="px-2 py-2 text-right font-medium">จำนวน</th>
                <th className="px-2 py-2 font-medium">สถานะ</th>
                <th className="px-2 py-2 font-medium">ผู้ขอ</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {requisitions.map((r) => {
                const canCancel =
                  r.status === "requested" &&
                  (canIssue || r.requested_by_id === currentProfileId);
                return (
                  <Fragment key={r.id}>
                  <tr className={`align-top ${r.note ? "" : "border-b last:border-0"}`}>
                    <td className="px-2 py-2">
                      <span className="font-medium">{r.material_code}</span>{" "}
                      <span className="text-muted-foreground">{r.material_name}</span>
                      <span className="block text-xs text-muted-foreground">
                        ล็อต {r.lot_no}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {r.qty.toLocaleString("th-TH")} {r.unit}
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                      {r.requested_by_name ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        {r.status === "requested" && canIssue && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => act(() => issueRequisition(jobNo, r.id))}
                            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            จ่าย
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => act(() => cancelRequisition(jobNo, r.id))}
                            className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
                          >
                            ยกเลิก
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {r.note && (
                    <tr className="border-b last:border-0">
                      <td
                        colSpan={5}
                        className="px-2 pb-2 text-xs text-muted-foreground"
                      >
                        📝 {r.note}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">ยังไม่มีการเบิกวัตถุดิบ</p>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {canRequest && (
        <div className="mt-4">
          {open ? (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  เลือกวัตถุดิบ/ล็อต *
                </label>
                <select
                  value={lotId}
                  onChange={(e) => setLotId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— เลือกล็อต (เฉพาะที่พร้อมเบิก) —</option>
                  {lots.map((l) => (
                    <option key={l.lot_id} value={l.lot_id}>
                      {l.label}
                    </option>
                  ))}
                </select>
                {lots.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    ยังไม่มีล็อตที่พร้อมเบิก (ต้องมีสต็อก + ไม่หมดอายุ/ไม่ผ่าน) — เพิ่มที่เมนูวัตถุดิบ
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    จำนวนที่เบิก *
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    หมายเหตุ
                  </label>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={submit}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "กำลังบันทึก…" : "ขอเบิก"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                >
                  ปิด
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                ขอเบิกก่อน → ฝ่ายคลังกด “จ่าย” จึงตัดสต็อก (กันล็อตไม่ผ่าน/หมดอายุ/สต็อกไม่พอ)
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              + ขอเบิกวัตถุดิบ
            </button>
          )}
        </div>
      )}
    </div>
  );
}
