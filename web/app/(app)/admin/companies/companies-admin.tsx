"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CompanyJobNoConfig } from "@/lib/data/companies";
import { setJobNoConfig } from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

/** เลขงานเต็มที่ผู้ใช้จะเห็น (ยังไม่รวมอักษรนำ — อักษรนำเป็นของภายในระบบ) */
function preview(yearBe: number, seq: number): string {
  return `${String(yearBe).padStart(2, "0")}${String(seq).padStart(4, "0")}`;
}

function CompanyRow({ c }: { c: CompanyJobNoConfig }) {
  const [nextSeq, setNextSeq] = useState("");
  const [yearStartSeq, setYearStartSeq] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await setJobNoConfig({
        companyId: c.id,
        nextSeq,
        yearStartSeq,
      });
      if (res.ok) {
        setNextSeq("");
        setYearStartSeq("");
        setSaved(true);
        router.refresh();
        return;
      }
      setError(res.error ?? "ตั้งค่าไม่สำเร็จ");
    });
  }

  const dirty = !!nextSeq.trim() || !!yearStartSeq.trim();

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-medium">{c.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            รหัส {c.code}
            {c.job_no_prefix
              ? ` · อักษรนำในระบบ "${c.job_no_prefix}"`
              : " · ไม่มีอักษรนำ (งานเดิมทั้งหมด)"}
            {c.requires_note ? " · มีช่องหมายเหตุตอนสร้างงาน" : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">ใบถัดไปจะได้เลข</p>
          <p className="font-mono text-lg font-semibold">
            {preview(c.year_be, c.next_seq)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            ตั้งเลขถัดไป (ปี {String(c.year_be).padStart(2, "0")} — ใช้ทันที)
          </label>
          <input
            inputMode="numeric"
            value={nextSeq}
            onChange={(e) => setNextSeq(e.target.value)}
            placeholder={`ตอนนี้ ${c.next_seq}`}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            ตั้งได้เฉพาะเลขที่มากกว่าเลขที่ออกไปแล้ว — ตั้งย้อนหลังจะทำให้เลขงานซ้ำ
          </p>
        </div>
        <div>
          <label className={labelClass}>เลขตั้งต้นเมื่อขึ้นปี พ.ศ. ใหม่</label>
          <input
            inputMode="numeric"
            value={yearStartSeq}
            onChange={(e) => setYearStartSeq(e.target.value)}
            placeholder={`ตอนนี้ ${c.year_start_seq}`}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            ปกติ 1 — ใบแรกของปีหน้าจะเริ่มนับจากเลขนี้
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          บันทึกแล้ว
        </p>
      )}

      <div className="mt-3">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </div>
  );
}

export function CompaniesAdmin({
  companies,
}: {
  companies: CompanyJobNoConfig[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-400 bg-amber-50/40 p-4 text-sm dark:bg-amber-950/20">
        <p className="font-medium">เลขงานเดินแยกชุดต่อบริษัท</p>
        <p className="mt-1 text-muted-foreground">
          ทั้งสองบริษัทมีเลข <b>690001</b> ได้พร้อมกัน — หน้าจอทุกที่จึงแสดงเลขคู่กับ
          ป้ายบริษัทเสมอ เบื้องหลังระบบเติมอักษรนำให้เองเพื่อไม่ให้เลขชนกัน
        </p>
      </div>
      {companies.map((c) => (
        <CompanyRow key={c.id} c={c} />
      ))}
    </div>
  );
}
