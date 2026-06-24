"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STATIONS, STATION_LABEL } from "@/lib/data/station-constants";
import type { InprocessCheck, QaSample } from "@/lib/data/quality-checks";
import { addInprocessCheck, addQaSample } from "./quality-actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function QualityChecks({
  jobId,
  jobNo,
  checks,
  samples,
  canCheck,
  canSample,
}: {
  jobId: string;
  jobNo: string;
  checks: InprocessCheck[];
  samples: QaSample[];
  canCheck: boolean;
  canSample: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* In-process QC */}
      <section className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">ตรวจระหว่างผลิต (In-process QC)</h2>
          <span className="text-xs text-muted-foreground">{checks.length} รายการ</span>
        </div>

        {checks.length > 0 ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">เวลา</th>
                  <th className="px-2 py-2 font-medium">สถานี</th>
                  <th className="px-2 py-2 font-medium">หัวข้อ</th>
                  <th className="px-2 py-2 font-medium">ค่า</th>
                  <th className="px-2 py-2 font-medium">ผล</th>
                  <th className="px-2 py-2 font-medium">ผู้ตรวจ</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 align-top">
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                      {new Date(c.checked_at).toLocaleString("th-TH")}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {STATION_LABEL[c.station] ?? c.station}
                    </td>
                    <td className="px-2 py-2">{c.param}</td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                      {c.value ?? "—"} {c.unit ?? ""}
                    </td>
                    <td className="px-2 py-2">
                      {c.result === "pass" ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                          ผ่าน
                        </span>
                      ) : (
                        <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">
                          ไม่ผ่าน
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                      {c.checker_name ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีผลตรวจระหว่างผลิต</p>
        )}

        <div className="mt-4">
          {canCheck ? (
            <InprocessForm jobId={jobId} jobNo={jobNo} />
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
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
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
                      {new Date(s.collected_at).toLocaleString("th-TH")}
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

function InprocessForm({ jobId, jobNo }: { jobId: string; jobNo: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    station: "mixing",
    param: "",
    value: "",
    unit: "",
    result: "pass",
    note: "",
  });
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
        setV({ station: "mixing", param: "", value: "", unit: "", result: "pass", note: "" });
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
          <label className={labelClass}>สถานี</label>
          <select
            value={v.station}
            onChange={(e) => set("station", e.target.value)}
            className={inputClass}
          >
            {STATIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
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
