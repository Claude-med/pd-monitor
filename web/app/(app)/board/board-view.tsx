"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  JOB_STATUS,
  PROBLEM_FLAGS,
  type JobRow,
} from "@/lib/data/job-constants";

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
  const month = planMonth(job.planned_start);
  return (
    <Link
      href={`/board/${encodeURIComponent(job.job_no)}`}
      className={`block rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50 ${
        flag ? "border-l-4" : ""
      }`}
      style={flag ? { borderLeftColor: flag.color } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold">
          {job.job_no}
          {job.lot_no && (
            <span className="font-normal text-muted-foreground">
              {" · "}Lot {job.lot_no}
            </span>
          )}
        </span>
        {flag && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
            style={{ backgroundColor: flag.color }}
          >
            {flag.icon} {flag.label}
          </span>
        )}
      </div>
      <div className="mt-1 text-sm">{job.product_name ?? "—"}</div>
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
  canCreate = false,
}: {
  jobs: JobRow[];
  canCreate?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [problemOnly, setProblemOnly] = useState(false);

  // งานที่รับเข้าคลัง FG แล้ว = ถือว่าจบหน้าที่ ย้ายไปดูที่หน้า "คลัง / FG" → ซ่อนจากบอร์ด
  const boardJobs = useMemo(
    () => jobs.filter((j) => !(j.status === "finished_goods" && j.fg_received)),
    [jobs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return boardJobs.filter((j) => {
      if (status && j.status !== status) return false;
      if (problemOnly && !j.problem) return false;
      if (q) {
        const hay =
          `${j.job_no} ${j.lot_no ?? ""} ${j.customer ?? ""} ${j.product_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [boardJobs, search, status, problemOnly]);

  const total = boardJobs.length;
  const producing = boardJobs.filter((j) => j.status === "in_production").length;
  // "เข้าคลังแล้ว" = งานที่รับเข้าคลัง FG จริง (มีใน fg_inventory)
  const done = jobs.filter(
    (j) => j.status === "finished_goods" && j.fg_received,
  ).length;
  const problem = boardJobs.filter((j) => j.problem).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">บอร์ดงาน</h1>
          <p className="text-sm text-muted-foreground">
            ติดตามทุกคำสั่งผลิตตามสถานะ — กดที่การ์ดเพื่อดูรายละเอียด
          </p>
        </div>
        {canCreate && (
          <Link
            href="/board/new"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            ＋ สร้างงานใหม่
          </Link>
        )}
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
        </select>
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
        </button>
        <span className="ml-auto text-sm text-muted-foreground">
          พบ <b>{filtered.length}</b> งาน
        </span>
      </div>

      {/* Kanban: คอลัมน์ตามสถานะ — เดสก์ท็อปเรียงแนวนอน / มือถือซ้อนลงมา */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-3 md:overflow-x-auto md:pb-2">
        {JOB_STATUS.map((s) => {
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
