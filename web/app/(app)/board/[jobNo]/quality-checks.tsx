"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { InprocessCheck, QaSample } from "@/lib/data/quality-checks";
import { INPROCESS_STATUS_META } from "@/lib/data/inprocess-constants";
import type { JobRouteStep } from "@/lib/data/stations";
import { fmtDateTime } from "@/lib/format";
import {
  addInprocessCheck,
  addQaSample,
  reviewInprocessCheck,
} from "./quality-actions";
import { EditRequestButton } from "./edit-request-button";

export type StationOption = { id: string; name: string };

/** ตัวเลือก "บันทึกผลผลิตที่ตรวจ" — Part C.3 ก้อน 5 */
export type RecordOption = {
  id: string;
  label: string;
};

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function QualityChecks({
  jobId,
  jobNo,
  checks,
  samples,
  route,
  jobRouteId,
  stationOptions,
  recordOptions,
  preselectRecordId,
  canCheck,
  canApprove,
  currentProfileId,
  canSample,
  canAmend,
  canAmendCheck,
  canEditStation,
  pendingTargetIds,
}: {
  jobId: string;
  jobNo: string;
  checks: InprocessCheck[];
  samples: QaSample[];
  route: JobRouteStep[];
  /** ขั้นตอนที่กำลังดูอยู่ (job_routes.id) — null เมื่องานไม่มี route */
  jobRouteId: string | null;
  /** สถานีทั้งหมด (active) — ใช้เฉพาะ dropdown ในฟอร์ม "ขอแก้ไขย้อนหลัง" ของผู้บริหาร */
  stationOptions: StationOption[];
  /** บันทึกผลผลิตของขั้นตอนนี้ ให้ QC เลือกว่าจะตรวจแถวไหน */
  recordOptions: RecordOption[];
  /** แถวที่ถูกล็อกมาจากปุ่ม QC ในตารางบันทึกผลผลิต (?qc=) */
  preselectRecordId: string | null;
  canCheck: boolean;
  /** อนุมัติผลตรวจได้ (หัวหน้า QC/ผู้บริหาร) — Part C.3 ก้อน 6 */
  canApprove: boolean;
  currentProfileId: string;
  canSample: boolean;
  /** ขอแก้ไข "บันทึกผลผลิต" ได้ — ทุกคนที่ล็อกอิน */
  canAmend: boolean;
  /**
   * ขอแก้ไข "ผลตรวจ in-process" ได้ — QC/หัวหน้า QC/ผู้บริหารเท่านั้น (Part C.4)
   *
   * ⚠️ ห้าม or รวมกับ canAmend — ฝ่ายผลิตต้องเห็นผลตรวจแต่กดขอแก้ไม่ได้
   *    (DB กันซ้ำอีกชั้นใน request_edit · 0065)
   */
  canAmendCheck: boolean;
  canEditStation: boolean;
  pendingTargetIds: string[];
}) {
  const pendingSet = new Set(pendingTargetIds);
  // สถานีที่ "ผ่าน" แล้ว (มีผล pass อย่างน้อย 1) — ใช้กับแถบความคืบหน้า + gate ส่ง QC
  const passedIds = new Set(
    checks
      .filter(
        (c) => c.result === "pass" && c.status === "approved" && c.station_id,
      )
      .map((c) => c.station_id),
  );
  const stationName = new Map(route.map((s) => [s.station_id, s.name]));
  const doneCount = route.filter((s) => passedIds.has(s.station_id)).length;

  // ชื่อสถานีที่จะแสดง (ใช้ทั้งการ์ด/ตาราง)
  const showStation = (c: InprocessCheck) =>
    (c.station_id && stationName.get(c.station_id)) || c.station_name || "—";

  // ป้ายผล ผ่าน/ไม่ผ่าน (ใช้ทั้งการ์ด/ตาราง)
  const resultBadge = (c: InprocessCheck) =>
    c.result === "pass" ? (
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
        ผ่าน
      </span>
    ) : (
      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">
        ไม่ผ่าน
      </span>
    );

  // ปุ่มขอแก้ไขผลตรวจ (ใช้ทั้งการ์ด/ตาราง) — null ถ้าไม่มีสิทธิ์
  // ⚠️ ใช้ canAmendCheck ไม่ใช่ canAmend — Part C.4: การขอแก้ผลตรวจเป็นหน้าที่ QC เท่านั้น
  //    (canAmend = ทุกคนที่ล็อกอิน · ยังใช้กับปุ่มขอแก้ "บันทึกผลผลิต" ตามเดิม)
  const checkEditButton = (c: InprocessCheck) =>
    canAmendCheck ? (
      <EditRequestButton
        targetType="inprocess_check"
        targetId={c.id}
        jobNo={jobNo}
        hasPending={pendingSet.has(c.id)}
        fields={[
          ...(canEditStation && stationOptions.length
            ? [
                {
                  key: "station_id",
                  label: "สถานี",
                  kind: "select" as const,
                  current: c.station_id ?? "",
                  options: stationOptions.map((s) => ({ value: s.id, label: s.name })),
                },
              ]
            : []),
          { key: "param", label: "หัวข้อที่ตรวจ", kind: "text" as const, current: c.param ?? "" },
          { key: "value", label: "ค่าที่วัดได้", kind: "text" as const, current: c.value ?? "" },
          { key: "unit", label: "หน่วย", kind: "text" as const, current: c.unit ?? "" },
          {
            key: "result",
            label: "ผล",
            kind: "select" as const,
            current: c.result,
            options: [
              { value: "pass", label: "ผ่าน" },
              { value: "fail", label: "ไม่ผ่าน" },
            ],
          },
          {
            key: "valid_date",
            label: "Valid date (ใช้ได้ถึง)",
            kind: "date" as const,
            current: c.valid_date ?? "",
          },
          { key: "note", label: "หมายเหตุ", kind: "text" as const, current: c.note ?? "" },
        ]}
      />
    ) : null;

  return (
    <div className="space-y-6">
      {/* In-process QC */}
      <section id="inprocess" className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">ตรวจระหว่างผลิต (In-process QC)</h2>
          <span className="text-xs text-muted-foreground">{checks.length} รายการ</span>
        </div>

        {/* ความคืบหน้า QC ตามสูตร (route) — ต้องผ่านครบทุกสถานีก่อนส่ง QC */}
        {route.length > 0 && (
          <div className="mb-4 rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                ความคืบหน้า QC ตามสูตร (นับเฉพาะผลที่หัวหน้า QC อนุมัติแล้ว)
              </span>
              <span
                className={`text-xs font-semibold ${
                  doneCount === route.length ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {doneCount}/{route.length} สถานี
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {route.map((s, i) => {
                const ok = passedIds.has(s.station_id);
                return (
                  <span key={s.station_id} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-muted-foreground">→</span>}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        ok
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {ok ? "✓" : "⏳"} {s.name}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Part 2.1: route ว่าง = เตือน ไม่ใช่ซ่อนแถบเงียบๆ (ด่านตรวจ QC จะไม่ทำงาน) */}
        {route.length === 0 && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
            ⚠️ งานนี้ไม่มีขั้นตอนการผลิต — บันทึกผลตรวจ in-process ไม่ได้ และ
            <strong> ด่าน &ldquo;ต้องตรวจครบทุกสถานีก่อนส่ง QC&rdquo; จะไม่ทำงาน</strong>
            <br />
            ให้ฝ่ายวางแผนกดเติมขั้นตอนการผลิตจากแถบเตือนด้านบนของหน้างานก่อน
          </div>
        )}

        {checks.length > 0 ? (
          <>
            {/* มือถือ: การ์ด */}
            <div className="space-y-3 md:hidden">
              {checks.map((c) => (
                <div key={c.id} className="rounded-lg border bg-muted/20 p-3">
                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{showStation(c)}</span>
                    {resultBadge(c)}
                  </div>
                  <div className="text-sm">{c.param}</div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-sm">
                    <span className="tabular-nums">
                      {c.value ?? "—"} {c.unit ?? ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDateTime(c.checked_at)} · {c.checker_name ?? "—"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge c={c} />
                    {c.valid_date && (
                      <span className="text-xs text-muted-foreground">
                        ใช้ได้ถึง {c.valid_date}
                      </span>
                    )}
                  </div>
                  <ReviewBar
                    c={c}
                    jobNo={jobNo}
                    canApprove={canApprove}
                    currentProfileId={currentProfileId}
                  />
                  {checkEditButton(c) && <div className="mt-2">{checkEditButton(c)}</div>}
                </div>
              ))}
            </div>

            {/* จอกว้าง: ตาราง */}
            <div className="-mx-2 hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">เวลา</th>
                    <th className="px-2 py-2 font-medium">สถานี</th>
                    <th className="px-2 py-2 font-medium">หัวข้อ</th>
                    <th className="px-2 py-2 font-medium">ค่า</th>
                    <th className="px-2 py-2 font-medium">ผล</th>
                    <th className="px-2 py-2 font-medium">Valid date</th>
                    <th className="px-2 py-2 font-medium">ผู้ตรวจ</th>
                    {canAmend && <th className="px-2 py-2 font-medium">แก้ไข</th>}
                    <th className="px-2 py-2 font-medium">การอนุมัติ</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 align-top">
                      <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                        {fmtDateTime(c.checked_at)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{showStation(c)}</td>
                      <td className="px-2 py-2">{c.param}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                        {c.value ?? "—"} {c.unit ?? ""}
                      </td>
                      <td className="px-2 py-2">{resultBadge(c)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                        {c.valid_date ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                        {c.checker_name ?? "—"}
                      </td>
                      {canAmend && <td className="px-2 py-2">{checkEditButton(c)}</td>}
                      <td className="px-2 py-2">
                        <StatusBadge c={c} />
                        <ReviewBar
                          c={c}
                          jobNo={jobNo}
                          canApprove={canApprove}
                          currentProfileId={currentProfileId}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีผลตรวจระหว่างผลิต</p>
        )}

        <div className="mt-4">
          {canCheck ? (
            <InprocessForm
              jobId={jobId}
              jobNo={jobNo}
              jobRouteId={jobRouteId}
              recordOptions={recordOptions}
              preselectRecordId={preselectRecordId}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              การบันทึกและแก้ไขผลตรวจระหว่างผลิตเป็นหน้าที่ของ QC/หัวหน้า QC/ผู้บริหาร
              — ฝ่ายอื่นที่พบปัญหาให้แจ้ง QC หรือเปิด Incident Case ด้านล่างแทน
            </p>
          )}
        </div>
      </section>

      {/* QA Samples */}
      <section className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">จุดเก็บตัวอย่าง (QA Sample)</h2>
          <span className="text-xs text-muted-foreground">{samples.length} รายการ</span>
        </div>

        {samples.length > 0 ? (
          <>
            {/* มือถือ: การ์ด */}
            <div className="space-y-3 md:hidden">
              {samples.map((s) => (
                <div key={s.id} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{s.sample_point}</span>
                    <span className="text-sm tabular-nums">
                      {s.qty == null ? "—" : s.qty.toLocaleString("th-TH")} {s.unit ?? ""}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {fmtDateTime(s.collected_at)} · {s.collector_name ?? "—"}
                  </div>
                  {s.note && (
                    <p className="mt-1 text-xs text-muted-foreground">📝 {s.note}</p>
                  )}
                </div>
              ))}
            </div>

            {/* จอกว้าง: ตาราง */}
            <div className="-mx-2 hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">เวลา</th>
                    <th className="px-2 py-2 font-medium">จุด/รอบ</th>
                    <th className="px-2 py-2 text-right font-medium">จำนวน</th>
                    <th className="px-2 py-2 font-medium">ผู้เก็บ</th>
                    <th className="px-2 py-2 font-medium">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s) => (
                    <tr key={s.id} className="border-b last:border-0 align-top">
                      <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                        {fmtDateTime(s.collected_at)}
                      </td>
                      <td className="px-2 py-2">{s.sample_point}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                        {s.qty == null ? "—" : s.qty.toLocaleString("th-TH")} {s.unit ?? ""}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                        {s.collector_name ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{s.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีบันทึกจุดเก็บตัวอย่าง</p>
        )}

        <div className="mt-4">
          {canSample ? (
            <SampleForm jobId={jobId} jobNo={jobNo} />
          ) : (
            <p className="text-xs text-muted-foreground">
              เฉพาะ QA/ผู้บริหารบันทึกจุดเก็บตัวอย่างได้
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function InprocessForm({
  jobId,
  jobNo,
  jobRouteId,
  recordOptions,
  preselectRecordId,
}: {
  jobId: string;
  jobNo: string;
  jobRouteId: string | null;
  recordOptions: RecordOption[];
  preselectRecordId: string | null;
}) {
  // ถูกส่งมาจากปุ่ม QC ในตารางบันทึกผลผลิต = เปิดฟอร์มค้างไว้เลย ไม่ต้องกดซ้ำ
  const locked =
    !!preselectRecordId &&
    recordOptions.some((r) => r.id === preselectRecordId);
  const [open, setOpen] = useState(locked);
  const emptyForm = {
    production_record_id: locked ? preselectRecordId! : "",
    param: "",
    value: "",
    unit: "",
    result: "pass",
    note: "",
    valid_date: "",
  };
  const [v, setV] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof typeof v>(k: K, val: string) {
    setV((c) => ({ ...c, [k]: val }));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await addInprocessCheck(jobNo, {
        job_id: jobId,
        job_route_id: jobRouteId ?? "",
        ...v,
      });
      if (res.ok) {
        setV({ ...emptyForm });
        setOpen(false);
        router.refresh();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
      >
        ＋ บันทึกผลตรวจ
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>บันทึกผลผลิตที่ตรวจ</label>
          {recordOptions.length > 0 ? (
            <select
              value={v.production_record_id}
              onChange={(e) => set("production_record_id", e.target.value)}
              className={inputClass}
            >
              <option value="">— ไม่ผูกกับแถวใด —</option>
              {recordOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              ยังไม่มีบันทึกผลผลิตในขั้นตอนนี้ให้ตรวจ
            </p>
          )}
          {locked && (
            <p className="mt-1 text-xs text-muted-foreground">
              เลือกไว้ให้แล้วจากปุ่ม QC ในตารางบันทึกผลผลิต
            </p>
          )}
        </div>
        <div>
          <label className={labelClass}>หัวข้อที่ตรวจ *</label>
          <input
            value={v.param}
            onChange={(e) => set("param", e.target.value)}
            placeholder="เช่น น้ำหนักเม็ด / ความแข็ง / ความชื้น"
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>ค่าที่วัดได้</label>
            <input
              value={v.value}
              onChange={(e) => set("value", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>หน่วย</label>
            <input
              value={v.unit}
              onChange={(e) => set("unit", e.target.value)}
              placeholder="mg / %"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>ผล</label>
          <select
            value={v.result}
            onChange={(e) => set("result", e.target.value)}
            className={inputClass}
          >
            <option value="pass">ผ่าน</option>
            <option value="fail">ไม่ผ่าน</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Valid date (ใช้ได้ถึง)</label>
          <input
            type="date"
            value={v.valid_date}
            onChange={(e) => set("valid_date", e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            เว้นว่างได้ = ไม่กำหนดอายุผลตรวจ
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>หมายเหตุ</label>
          <input
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            className={inputClass}
          />
        </div>
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
          {pending ? "กำลังบันทึก…" : "บันทึกผลตรวจ"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

function SampleForm({ jobId, jobNo }: { jobId: string; jobNo: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ sample_point: "", qty: "", unit: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof typeof v>(k: K, val: string) {
    setV((c) => ({ ...c, [k]: val }));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await addQaSample(jobNo, { job_id: jobId, ...v });
      if (res.ok) {
        setV({ sample_point: "", qty: "", unit: "", note: "" });
        setOpen(false);
        router.refresh();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
      >
        ＋ บันทึกจุดเก็บตัวอย่าง
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>จุด/รอบเก็บตัวอย่าง *</label>
          <input
            value={v.sample_point}
            onChange={(e) => set("sample_point", e.target.value)}
            placeholder="เช่น ต้นรอบ / กลางรอบ / ปลายรอบ"
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>จำนวน</label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={v.qty}
              onChange={(e) => set("qty", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>หน่วย</label>
            <input
              value={v.unit}
              onChange={(e) => set("unit", e.target.value)}
              placeholder="เม็ด / g"
              className={inputClass}
            />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>หมายเหตุ</label>
          <input
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            className={inputClass}
          />
        </div>
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
          {pending ? "กำลังบันทึก…" : "บันทึกจุดเก็บตัวอย่าง"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

/** ป้ายสถานะอนุมัติของผลตรวจ 1 รายการ (Part C.3 ก้อน 6) */
function StatusBadge({ c }: { c: InprocessCheck }) {
  const meta = INPROCESS_STATUS_META[c.status];
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: meta.color }}
      title={
        c.approver_name
          ? `${meta.label} โดย ${c.approver_name}`
          : meta.label
      }
    >
      {meta.label}
    </span>
  );
}

/**
 * แถบอนุมัติ/ไม่อนุมัติ — โผล่เฉพาะรายการที่ยัง pending และผู้ดูมีสิทธิ์
 *
 * ⚠️ ผู้อนุมัติต้องคนละคนกับผู้ลงผล (DB บังคับอีกชั้น) — ที่นี่แค่ไม่โชว์ปุ่มให้สับสน
 */
function ReviewBar({
  c,
  jobNo,
  canApprove,
  currentProfileId,
}: {
  c: InprocessCheck;
  jobNo: string;
  canApprove: boolean;
  currentProfileId: string;
}) {
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (c.status !== "pending") {
    return c.approve_note ? (
      <p className="mt-1 text-xs text-muted-foreground">
        เหตุผล: {c.approve_note}
      </p>
    ) : null;
  }

  const isChecker = c.checked_by_id === currentProfileId;
  if (!canApprove || isChecker) {
    return (
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
        {isChecker
          ? "ผู้อนุมัติต้องเป็นคนละคนกับผู้ลงผล (รอหัวหน้า QC)"
          : "รอหัวหน้า QC พิจารณา"}
      </p>
    );
  }

  function run(decision: "approve" | "reject") {
    setError(null);
    start(async () => {
      const res = await reviewInprocessCheck(jobNo, c.id, decision, note);
      if (res.ok) {
        setNote("");
        setRejecting(false);
        router.refresh();
        return;
      }
      setError(res.error ?? "บันทึกผลพิจารณาไม่สำเร็จ");
    });
  }

  return (
    <div className="mt-2 space-y-2">
      {rejecting ? (
        <>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เหตุผลที่ไม่อนุมัติ (จำเป็น)"
            className={inputClass}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !note.trim()}
              onClick={() => run("reject")}
              className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              ยืนยันไม่อนุมัติ
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              ยกเลิก
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run("approve")}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            ✓ อนุมัติ
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
          >
            ✕ ไม่อนุมัติ
          </button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
