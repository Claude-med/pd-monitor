"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STATION_LABEL } from "@/lib/data/station-constants";
import type { InprocessCheck, QaSample } from "@/lib/data/quality-checks";
import type { JobRouteStep } from "@/lib/data/stations";
import { fmtDateTime } from "@/lib/format";
import { addInprocessCheck, addQaSample } from "./quality-actions";
import { EditRequestButton } from "./edit-request-button";

export type StationOption = { id: string; name: string };

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function QualityChecks({
  jobId,
  jobNo,
  checks,
  samples,
  route,
  stationOptions,
  canCheck,
  canSample,
  canAmend,
  canEditStation,
  pendingTargetIds,
}: {
  jobId: string;
  jobNo: string;
  checks: InprocessCheck[];
  samples: QaSample[];
  route: JobRouteStep[];
  stationOptions: StationOption[];
  canCheck: boolean;
  canSample: boolean;
  canAmend: boolean;
  canEditStation: boolean;
  pendingTargetIds: string[];
}) {
  const pendingSet = new Set(pendingTargetIds);
  // สถานีที่ "ผ่าน" แล้ว (มีผล pass อย่างน้อย 1) — ใช้กับแถบความคืบหน้า + gate ส่ง QC
  const passedIds = new Set(
    checks.filter((c) => c.result === "pass" && c.station_id).map((c) => c.station_id),
  );
  const stationName = new Map(route.map((s) => [s.station_id, s.name]));
  const doneCount = route.filter((s) => passedIds.has(s.station_id)).length;

  // ชื่อสถานีที่จะแสดง (ใช้ทั้งการ์ด/ตาราง)
  const showStation = (c: InprocessCheck) =>
    (c.station_id && stationName.get(c.station_id)) ||
    STATION_LABEL[c.station] ||
    c.station;

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
  const checkEditButton = (c: InprocessCheck) =>
    canAmend ? (
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
          { key: "note", label: "หมายเหตุ", kind: "text" as const, current: c.note ?? "" },
        ]}
      />
    ) : null;

  return (
    <div className="space-y-6">
      {/* In-process QC */}
      <section className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">ตรวจระหว่างผลิต (In-process QC)</h2>
          <span className="text-xs text-muted-foreground">{checks.length} รายการ</span>
        </div>

        {/* ความคืบหน้า QC ตามสูตร (route) — ต้องผ่านครบทุกสถานีก่อนส่ง QC */}
        {route.length > 0 && (
          <div className="mb-4 rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                ความคืบหน้า QC ตามสูตร (ต้องผ่านครบก่อนส่ง QC)
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
                    <th className="px-2 py-2 font-medium">ผู้ตรวจ</th>
                    {canAmend && <th className="px-2 py-2 font-medium">แก้ไข</th>}
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
                        {c.checker_name ?? "—"}
                      </td>
                      {canAmend && <td className="px-2 py-2">{checkEditButton(c)}</td>}
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
            <InprocessForm jobId={jobId} jobNo={jobNo} stationOptions={stationOptions} />
          ) : (
            <p className="text-xs text-muted-foreground">
              เฉพาะ QC/ผู้บริหารบันทึกผลตรวจระหว่างผลิตได้
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
  stationOptions,
}: {
  jobId: string;
  jobNo: string;
  stationOptions: StationOption[];
}) {
  const [open, setOpen] = useState(false);
  const emptyForm = {
    station_id: stationOptions[0]?.id ?? "",
    param: "",
    value: "",
    unit: "",
    result: "pass",
    note: "",
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
      const res = await addInprocessCheck(jobNo, { job_id: jobId, ...v });
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
          <label className={labelClass}>สถานี *</label>
          {stationOptions.length > 0 ? (
            <select
              value={v.station_id}
              onChange={(e) => set("station_id", e.target.value)}
              className={inputClass}
            >
              {stationOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              ยังไม่มีสถานีในระบบ — ตั้งค่าสถานีที่หน้า “สูตรการผลิต / BOM” ก่อน
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
