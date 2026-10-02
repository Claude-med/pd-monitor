"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CANCELLED_STATUS,
  JOB_STATUS,
  PROBLEM_FLAGS,
  STATUS_LABEL,
  isProblemJob,
  type JobRow,
} from "@/lib/data/job-constants";
import type { CompanyOption } from "@/lib/data/companies";
import { saveBoardUrl } from "./back-to-board-link";
import { displayJobNo } from "@/lib/format";

function fmtQty(n: number | null, unit: string | null) {
  if (n == null) return "—";
  return `${n.toLocaleString("th-TH")} ${unit ?? ""}`.trim();
}

function planMonth(d: string | null) {
  if (!d) return null;
  // d = YYYY-MM-DD → YYYY-MM
  return d.slice(0, 7);
}

function JobCard({ job }: { job: JobRow }) {
  const flag = job.problem ? PROBLEM_FLAGS[job.problem] : null;
  const incidents = job.open_incidents ?? 0;
  const month = planMonth(job.planned_start);
  // ขอบซ้าย: ธงปัญหามาก่อน (มีสีตามชนิด) · ไม่มีธงแต่มี Incident เปิด = แดง
  const edge = flag?.color ?? (incidents > 0 ? "#dc2626" : null);
  return (
    <Link
      href={`/board/${encodeURIComponent(job.job_no)}`}
      className={`block rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50 ${
        edge ? "border-l-4" : ""
      }`}
      style={edge ? { borderLeftColor: edge } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold">
          {displayJobNo(job.job_no)}
          {job.company && (
            <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 align-middle text-[10px] font-medium text-secondary-foreground">
              {job.company}
            </span>
          )}
          {job.lot_no && (
            <span className="font-normal text-muted-foreground">
              {" · "}Lot {job.lot_no}
            </span>
          )}
        </span>
        {(flag || incidents > 0) && (
          <span className="flex shrink-0 flex-col items-end gap-1">
            {flag && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: flag.color }}
              >
                {flag.icon} {flag.label}
              </span>
            )}
            {incidents > 0 && (
              <span
                className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
                title="Incident Case ที่ยังไม่ปิด"
              >
                🚨 Incident {incidents}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="mt-1 text-sm">{job.product_name ?? "—"}</div>
      {job.status === CANCELLED_STATUS.key && job.cancel_reason && (
        <div className="mt-1 text-xs text-muted-foreground">🚫 {job.cancel_reason}</div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>👥 {job.customer ?? "—"}</span>
        <span>📦 {fmtQty(job.quantity, job.unit)}</span>
        {month ? <span>🗓️ {month}</span> : <span>ยังไม่มีแผน</span>}
      </div>
    </Link>
  );
}

export function BoardView({
  jobs,
  companies = [],
  canCreate = false,
  initialStatus = "",
  initialCompany = "",
  initialProblem = false,
  initialSearch = "",
}: {
  jobs: JobRow[];
  companies?: CompanyOption[];
  canCreate?: boolean;
  /** สถานะตั้งต้นจาก ?status= (การ์ดบนแดชบอร์ดกดมา) — validate มาแล้วที่ page.tsx */
  initialStatus?: string;
  /** บริษัทตั้งต้นจาก ?company= (Part I) — validate มาแล้วที่ page.tsx */
  initialCompany?: string;
  /** เปิดตัวกรอง "เฉพาะงานมีปัญหา" จาก ?problem=1 (Part I) */
  initialProblem?: boolean;
  /** คำค้นจาก ?q= (คงตัวกรองไว้เมื่อกดกลับจากหน้างาน) */
  initialSearch?: string;
}) {
  // อ่านตัวกรองจาก URL ปัจจุบันก่อน (useSearchParams) แล้วค่อย fallback ไปที่ props จาก server
  // เหตุ: กด "ย้อนกลับ" ของเบราว์เซอร์ Next คืนหน้าจาก cache ที่ render ไว้ตอนยังไม่มีตัวกรองใน URL
  // → props เป็นค่าเก่า (ว่าง) ตัวกรองเลยรีเซ็ต · ส่วน useSearchParams ตรงกับ URL จริงเสมอ
  const sp = useSearchParams();
  const urlStatus = sp.get("status");
  const urlCompany = sp.get("company");
  const [search, setSearch] = useState(() => sp.get("q")?.slice(0, 100) ?? initialSearch);
  const [status, setStatus] = useState(() =>
    urlStatus && Object.hasOwn(STATUS_LABEL, urlStatus) ? urlStatus : initialStatus,
  );
  const [company, setCompany] = useState(() =>
    urlCompany && companies.some((c) => c.id === urlCompany) ? urlCompany : initialCompany,
  );
  const [problemOnly, setProblemOnly] = useState(() =>
    sp.has("problem") ? sp.get("problem") === "1" : initialProblem,
  );

  // เขียนตัวกรองลง URL (replaceState = ไม่เพิ่มประวัติ ไม่โหลดหน้าใหม่)
  // → เข้าหน้างานแล้วกด "ย้อนกลับ" ตัวกรองเดิมยังอยู่ · ส่งลิงก์ให้คนอื่นก็เห็นชุดเดียวกัน
  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (status) params.set("status", status);
    if (company) params.set("company", company);
    if (problemOnly) params.set("problem", "1");
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next); // Next 16 ผนวก state ของ router ให้เอง (ตามเอกสาร Next)
    }
    // จำลิงก์บอร์ดล่าสุด ให้ปุ่ม "← กลับบอร์ดงาน" ในหน้างานพากลับมาที่ตัวกรองเดิม
    saveBoardUrl(next);
  }, [search, status, company, problemOnly]);

  // งานที่รับเข้าคลัง FG แล้ว = ถือว่าจบหน้าที่ ย้ายไปดูที่หน้า "คลัง / FG" → ซ่อนจากบอร์ด
  // งานที่ยกเลิก (0109) ซ่อนเหมือนกัน — ยกเว้นตอนเลือกตัวกรอง "ยกเลิก" เพื่อดูย้อนหลัง
  const showCancelled = status === CANCELLED_STATUS.key;
  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.status !== CANCELLED_STATUS.key &&
          !(j.status === "finished_goods" && j.fg_received),
      ),
    [jobs],
  );
  const boardJobs = useMemo(
    () => (showCancelled ? jobs.filter((j) => j.status === CANCELLED_STATUS.key) : activeJobs),
    [jobs, activeJobs, showCancelled],
  );

  // บริษัทเป็น "ขอบเขตการดู" ไม่ใช่ตัวกรองธรรมดา → คั่นไว้เหนือ filtered
  // เพื่อให้การ์ด KPI นับตามบริษัทที่เลือกด้วย (ต่างจากสถานะ/ค้นหาที่ไม่กระทบ KPI)
  // 🚨 กรองด้วย company_id — jobs.company เก็บชื่อเต็ม ("UMEDA CO., LTD.") ไม่ใช่ code
  const companyJobs = useMemo(
    () => (company ? boardJobs.filter((j) => j.company_id === company) : boardJobs),
    [boardJobs, company],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companyJobs.filter((j) => {
      if (status && j.status !== status) return false;
      if (problemOnly && !isProblemJob(j)) return false;
      if (q) {
        const hay =
          `${j.job_no} ${displayJobNo(j.job_no)} ${j.company ?? ""} ${j.lot_no ?? ""} ${j.customer ?? ""} ${j.product_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [companyJobs, search, status, problemOnly]);

  // KPI นับเฉพาะงานที่ยังเดินอยู่เสมอ — เลือกดูงานที่ยกเลิกแล้วตัวเลขต้องไม่เปลี่ยน
  const kpiJobs = company ? activeJobs.filter((j) => j.company_id === company) : activeJobs;
  const total = kpiJobs.length;
  const producing = kpiJobs.filter(
    (j) => j.status === "in_production",
  ).length;
  // "เข้าคลังแล้ว" = งานที่รับเข้าคลัง FG จริง (มีใน fg_inventory)
  // นับจาก jobs เต็ม เพราะ boardJobs ตัดงานพวกนี้ออกไปแล้ว — แต่ยังต้องคิดบริษัทด้วย
  const done = jobs.filter(
    (j) =>
      j.status === "finished_goods" &&
      j.fg_received &&
      (!company || j.company_id === company),
  ).length;
  // นิยามเดียวกับแดชบอร์ด (0104): ธงปัญหา หรือ Incident ยังไม่ปิด
  const problem = kpiJobs.filter(isProblemJob).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">บอร์ดงาน</h1>
          <p className="text-sm text-muted-foreground">
            ติดตามทุกคำสั่งผลิตตามสถานะ — กดที่การ์ดเพื่อดูรายละเอียด
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* ตารางบอร์ดงาน F.PLN.10 (Part D4) — อยู่นอก canCreate โดยตั้งใจ
              เป็นแค่การพิมพ์สิ่งที่ทุกฝ่ายเห็นบนบอร์ดอยู่แล้ว ไม่ใช่เอกสารสั่งการ */}
          <Link
            href="/board/print-table"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            📋 ปริ้นตารางบอร์ดงาน
          </Link>
          {canCreate && (
            <>
              {/* ใบแจ้งผลิต F.PLN.01 (Part D) — สิทธิ์เดียวกับปุ่มสร้างงาน (ฝ่ายวางแผน/ผู้บริหาร) */}
              <Link
                href="/board/print-notice"
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                🖨️ ปริ้นใบแจ้งผลิต
              </Link>
              <Link
                href="/board/new"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                ＋ สร้างงานใหม่
              </Link>
            </>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Job ทั้งหมด" value={total} bg="bg-blue-50" emoji="📦" />
        <Kpi label="กำลังผลิต" value={producing} bg="bg-amber-50" emoji="🏭" />
        <Kpi label="เข้าคลังแล้ว (FG)" value={done} bg="bg-green-50" emoji="✅" />
        <Kpi label="งานมีปัญหา" value={problem} bg="bg-red-50" emoji="⚠️" />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 ค้นหา Job / Lot / ลูกค้า / ชื่อยา"
          className="min-w-[200px] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">ทุกสถานะ</option>
          {JOB_STATUS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
          <option value={CANCELLED_STATUS.key}>🚫 งานที่ยกเลิก</option>
        </select>
        {companies.length > 0 && (
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">ทุกบริษัท</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => setProblemOnly((v) => !v)}
          className={`rounded-md border px-3 py-2 text-sm transition-colors ${
            problemOnly
              ? "border-red-300 bg-red-50 text-red-700"
              : "hover:bg-accent"
          }`}
        >
          🔴 เฉพาะงานมีปัญหา
          <span className="ml-1 text-xs text-muted-foreground">
            (Incident เปิด / ติดธง)
          </span>
        </button>
        <span className="ml-auto text-sm text-muted-foreground">
          พบ <b>{filtered.length}</b> งาน
        </span>
      </div>

      {/* Kanban: คอลัมน์ตามสถานะ — เดสก์ท็อปเรียงแนวนอน / มือถือซ้อนลงมา */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-3 md:overflow-x-auto md:pb-2">
        {(showCancelled ? [CANCELLED_STATUS] : JOB_STATUS).map((s) => {
          const list = filtered.filter((j) => j.status === s.key);
          return (
            <div
              key={s.key}
              className="rounded-xl border bg-muted/30 p-2 md:min-w-[240px] md:flex-1"
            >
              <div className="flex items-center gap-2 px-1 py-1.5 text-sm font-medium">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {s.label}
                <span className="ml-auto rounded bg-background px-1.5 text-xs text-muted-foreground">
                  {list.length}
                </span>
              </div>
              <div className="space-y-2">
                {list.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    — ไม่มีงาน —
                  </p>
                ) : (
                  list.map((j) => <JobCard key={j.id} job={j} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  bg,
  emoji,
}: {
  label: string;
  value: number;
  bg: string;
  emoji: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg}`}
        >
          {emoji}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
