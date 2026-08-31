"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  JOB_STATUS,
  STATUS_COLOR,
  STATUS_LABEL,
  type JobRow,
} from "@/lib/data/job-constants";
import type { CompanyOption } from "@/lib/data/companies";
import { displayJobNo } from "@/lib/format";
import { NoticePrintStyle, NoticeSheets } from "./notice-sheet";

const inputCls =
  "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/** ระดับความละเอียดของตัวกรอง C.P.O DATE */
type CpoMode = "" | "year" | "month" | "day";

export function PrintNoticeView({
  jobs,
  companies,
}: {
  jobs: JobRow[];
  companies: CompanyOption[];
}) {
  // บริษัท = ตัวเลือก layout ของใบ → บังคับเลือกเสมอ ไม่มีตัวเลือก "ทุกบริษัท"
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [cpoMode, setCpoMode] = useState<CpoMode>("");
  const [cpoValue, setCpoValue] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  /**
   * งานที่ติ๊กไว้ (เก็บ job.id)
   * 🔑 เก็บแยกจากตัวกรองโดยตั้งใจ — เปลี่ยนตัวกรองแล้วของที่ติ๊กต้องไม่หาย (requirement)
   *    และเก็บข้ามบริษัทได้ เพราะตอนพิมพ์กรองด้วย company_id อีกชั้นอยู่แล้ว
   */
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const company = companies.find((c) => c.id === companyId) ?? null;
  const previewRef = useRef<HTMLDivElement>(null);

  const companyJobs = useMemo(
    () => jobs.filter((j) => j.company_id === companyId),
    [jobs, companyId],
  );

  /** ปี ค.ศ. ที่มี C.P.O DATE จริงในข้อมูลของบริษัทนี้ (ใหม่ → เก่า) */
  const cpoYears = useMemo(() => {
    const set = new Set<string>();
    for (const j of companyJobs) if (j.cpo_date) set.add(j.cpo_date.slice(0, 4));
    return [...set].sort().reverse();
  }, [companyJobs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // 🚨 เทียบ C.P.O DATE ด้วย string prefix ล้วน ('2026-08-14'.startsWith('2026-08'))
    //    ห้ามผ่าน new Date() — timezone ทำให้เลื่อนวัน/เดือนได้ (บทเรียน 0048)
    const prefix = cpoMode && cpoValue ? cpoValue : "";
    return companyJobs.filter((j) => {
      if (status && j.status !== status) return false;
      if (prefix && !(j.cpo_date ?? "").startsWith(prefix)) return false;
      if (q) {
        const hay =
          `${j.job_no} ${displayJobNo(j.job_no)} ${j.product_name ?? ""} ${j.product_code ?? ""} ${j.customer ?? ""} ${j.request_no ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [companyJobs, status, search, cpoMode, cpoValue]);

  /** งานที่จะพิมพ์จริง — เฉพาะบริษัทที่เลือก เรียงตามเลขงาน */
  const pickedJobs = useMemo(
    () => companyJobs.filter((j) => picked.has(j.id)),
    [companyJobs, picked],
  );

  /** ติ๊กไว้แต่ตัวกรองปัจจุบันซ่อนอยู่ — ต้องโชว์ ไม่งั้นพิมพ์งานที่มองไม่เห็นออกมา */
  const hiddenPicked = useMemo(() => {
    const shown = new Set(filtered.map((j) => j.id));
    return pickedJobs.filter((j) => !shown.has(j.id));
  }, [filtered, pickedJobs]);

  const allFilteredPicked =
    filtered.length > 0 && filtered.every((j) => picked.has(j.id));
  const sheetCount = Math.ceil(pickedJobs.length / 2);
  const otherCompanyPicked = picked.size - pickedJobs.length;

  /**
   * ย่อฟอร์มให้พอดีครึ่งแผ่น
   *
   * 🚨 ฟอร์มกระดาษ POND สูงกว่าครึ่ง A4 จริง ๆ (วัดจากไฟล์ต้นแบบที่ทีมส่งมา = 150mm
   *    ทั้งที่ครึ่งแผ่นมี ~139mm) และ "ลักษณะยา" ที่ยาวก็ดันให้สูงขึ้นอีกไม่แน่นอน
   *    → ย่อทั้งฟอร์มด้วย transform ตามสัดส่วน (ไม่บิดสัดส่วน ไม่ตัดข้อมูลทิ้ง)
   *    ชดเชย width ด้วย 100/scale % เพื่อให้ย่อแล้วยังเต็มความกว้างกระดาษเหมือนเดิม
   */
  const fitSheets = useCallback(() => {
    const root = previewRef.current;
    if (!root) return;
    for (const half of root.querySelectorAll<HTMLElement>(".pn-half")) {
      const fit = half.querySelector<HTMLElement>(".pn-fit");
      if (!fit) continue;
      // รีเซ็ตก่อนวัดเสมอ — ความกว้างที่ชดเชยไว้รอบก่อนทำให้ตัดบรรทัดไม่เหมือนเดิม
      fit.style.transform = "";
      fit.style.width = "";
      const avail = half.clientHeight;
      const need = fit.scrollHeight;
      if (!avail || !need || need <= avail) continue;
      const scale = Math.max(0.6, Math.floor((avail / need) * 1000) / 1000);
      fit.style.transform = `scale(${scale})`;
      fit.style.width = `${100 / scale}%`;
    }
  }, []);

  useLayoutEffect(() => {
    fitSheets();
  }, [fitSheets, pickedJobs, company]);

  useEffect(() => {
    // ฟอนต์ AngsanaUPC โหลดช้ากว่า layout รอบแรก → ความสูงเปลี่ยน ต้องวัดซ้ำ
    document.fonts?.ready.then(fitSheets).catch(() => {});
    // กัน Ctrl+P ตอนที่ยังไม่เคยเปิดตัวอย่าง
    window.addEventListener("beforeprint", fitSheets);
    return () => window.removeEventListener("beforeprint", fitSheets);
  }, [fitSheets]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allFilteredPicked) for (const j of filtered) next.delete(j.id);
      else for (const j of filtered) next.add(j.id);
      return next;
    });
  }

  function clearCompanyPicked() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const j of companyJobs) next.delete(j.id);
      return next;
    });
  }

  function changeCpoMode(mode: CpoMode) {
    setCpoMode(mode);
    setCpoValue(""); // เปลี่ยนระดับความละเอียด = เริ่มเลือกค่าใหม่
  }

  if (companies.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        ยังไม่มีบริษัทในระบบ — ตั้งค่าที่เมนู “บริษัท / เลขงาน” ก่อน
      </p>
    );
  }

  return (
    <div className="pn-page space-y-4">
      <NoticePrintStyle />

      {/* ---------- ตัวกรอง ---------- */}
      <div className="no-print space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              รูปแบบใบ (บริษัท)
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={inputCls}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ขั้นตอน
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputCls}
            >
              <option value="">ทุกขั้นตอน</option>
              {JOB_STATUS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              C.P.O DATE
            </label>
            <select
              value={cpoMode}
              onChange={(e) => changeCpoMode(e.target.value as CpoMode)}
              className={inputCls}
            >
              <option value="">ไม่กรองวันที่</option>
              <option value="year">ปี</option>
              <option value="month">เดือน + ปี</option>
              <option value="day">วัน เดือน ปี</option>
            </select>
          </div>

          {cpoMode === "year" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                ปี
              </label>
              <select
                value={cpoValue}
                onChange={(e) => setCpoValue(e.target.value)}
                className={inputCls}
              >
                <option value="">เลือกปี</option>
                {cpoYears.map((y) => (
                  <option key={y} value={y}>
                    {y} (พ.ศ. {Number(y) + 543})
                  </option>
                ))}
              </select>
            </div>
          )}
          {cpoMode === "month" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                เดือน + ปี
              </label>
              <input
                type="month"
                value={cpoValue}
                onChange={(e) => setCpoValue(e.target.value)}
                className={inputCls}
              />
            </div>
          )}
          {cpoMode === "day" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                วันที่
              </label>
              <input
                type="date"
                value={cpoValue}
                onChange={(e) => setCpoValue(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          <div className="min-w-[12rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              ค้นหา
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="เลขงาน / ชื่อยา / ลูกค้า / ใบคำขอ"
              className={`${inputCls} w-full`}
            />
          </div>
        </div>

        {/* ---------- สรุป + ปุ่ม ---------- */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allFilteredPicked}
              disabled={filtered.length === 0}
              onChange={toggleAllFiltered}
            />
            ติ๊กทั้งหมดที่กรองอยู่ ({filtered.length})
          </label>

          <button
            type="button"
            onClick={clearCompanyPicked}
            disabled={pickedJobs.length === 0}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
          >
            ล้างที่เลือก
          </button>

          <span className="text-sm text-muted-foreground">
            เลือกไว้ <b className="text-foreground">{pickedJobs.length}</b> งาน ={" "}
            <b className="text-foreground">{sheetCount}</b> แผ่น
            {otherCompanyPicked > 0 && (
              <span className="ml-1">
                (อีก {otherCompanyPicked} งานอยู่บริษัทอื่น — ไม่ถูกพิมพ์รอบนี้)
              </span>
            )}
          </span>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              disabled={pickedJobs.length === 0}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
            >
              {showPreview ? "🙈 ซ่อนตัวอย่าง" : "👁 ดูตัวอย่าง"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={pickedJobs.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              🖨️ ปริ้นใบแจ้งผลิต / PDF
            </button>
          </div>
        </div>

        {hiddenPicked.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs">
            <span className="text-muted-foreground">
              เลือกไว้แต่ตัวกรองซ่อนอยู่ ({hiddenPicked.length}):
            </span>
            {hiddenPicked.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => toggle(j.id)}
                title="เอาออกจากรายการที่เลือก"
                className="rounded-full border border-primary bg-primary/10 px-2 py-0.5 font-medium hover:bg-primary/20"
              >
                {displayJobNo(j.job_no)} ✕
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---------- รายการงานให้ติ๊ก ---------- */}
      <div className="no-print rounded-xl border bg-card">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            ไม่พบงานตามตัวกรองนี้
          </p>
        ) : (
          <ul className="divide-y">
            {filtered.map((j) => (
              <li key={j.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-accent/50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={picked.has(j.id)}
                    onChange={() => toggle(j.id)}
                  />
                  <span className="w-20 shrink-0 text-sm font-semibold">
                    {displayJobNo(j.job_no)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {j.product_name ?? "—"}
                  </span>
                  <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground sm:block">
                    {j.customer ?? "—"}
                  </span>
                  <span className="hidden w-24 shrink-0 text-xs text-muted-foreground md:block">
                    {j.cpo_date ?? "—"}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: STATUS_COLOR[j.status] }}
                  >
                    {STATUS_LABEL[j.status]}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- ตัวอย่างกระดาษ (= สิ่งที่จะถูกพิมพ์) ----------
          render อยู่ใน DOM เสมอ · ซ่อนบนจอด้วย data-open="false"
          แต่ @media print บังคับ display:block — ถ้าใช้ hidden จริงจะพิมพ์ไม่ออก */}
      <div
        ref={previewRef}
        className="pn-preview"
        data-open={showPreview ? "true" : "false"}
      >
        {company && pickedJobs.length > 0 && (
          <NoticeSheets
            jobs={pickedJobs}
            companyCode={company.code}
            companyName={company.name}
          />
        )}
      </div>
    </div>
  );
}
