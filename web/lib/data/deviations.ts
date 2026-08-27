import { createClient } from "@/lib/supabase/server";
import type { DeviationSeverity, DeviationStatus } from "@/lib/data/deviation-constants";

export type DeviationComment = {
  id: string;
  role_group: string;
  body: string;
  author_name: string | null;
  created_at: string;
};

/** แผนกที่ QA มอบหมายให้แก้ไข 1 แผนก (Part C.4 ก้อน 5) */
export type DeviationDepartment = {
  id: string;
  role_group: string;
  responded_at: string | null;
  response_note: string | null;
  responder_name: string | null;
};

export type Deviation = {
  id: string;
  job_id: string;
  title: string;
  description: string | null;
  dev_type: string;
  severity: DeviationSeverity;
  status: DeviationStatus;
  due_date: string | null;
  root_cause: string | null;
  capa: string | null;
  inprocess_check_id: string | null;
  qa_sample_id: string | null;
  /** ประเภทเอกสารที่ QA คัดแยก (dev/oos/nc) — null = ยังไม่ผ่านขั้น QA ตรวจสอบ */
  case_type: string | null;
  case_no: string | null;
  qa_reviewed_at: string | null;
  departments: DeviationDepartment[];
  machine_label: string | null;
  reporter_name: string | null;
  closed_at: string | null;
  created_at: string;
  resolution_note: string | null;
  resolution_submitted_at: string | null;
  resolution_by_name: string | null;
  comments: DeviationComment[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function shape(r: any): Deviation {
  const machine = one<any>(r.machine);
  const departments: DeviationDepartment[] = ((r.departments ?? []) as any[])
    .map((d) => ({
      id: d.id,
      role_group: d.role_group,
      responded_at: d.responded_at ?? null,
      response_note: d.response_note ?? null,
      responder_name: one<any>(d.responder)?.full_name ?? null,
    }))
    .sort((a, b) => a.role_group.localeCompare(b.role_group));
  const comments: DeviationComment[] = ((r.comments ?? []) as any[])
    .map((c) => ({
      id: c.id,
      role_group: c.role_group,
      body: c.body,
      author_name: one<any>(c.author)?.full_name ?? null,
      created_at: c.created_at,
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    id: r.id,
    job_id: r.job_id,
    title: r.title,
    description: r.description,
    dev_type: r.dev_type,
    severity: r.severity,
    status: r.status,
    due_date: r.due_date,
    root_cause: r.root_cause,
    capa: r.capa,
    inprocess_check_id: r.inprocess_check_id,
    qa_sample_id: r.qa_sample_id ?? null,
    case_type: r.case_type ?? null,
    case_no: r.case_no ?? null,
    qa_reviewed_at: r.qa_reviewed_at ?? null,
    departments,
    machine_label: machine ? `${machine.code} · ${machine.name}` : null,
    reporter_name: one<any>(r.reporter)?.full_name ?? null,
    closed_at: r.closed_at,
    created_at: r.created_at,
    resolution_note: r.resolution_note ?? null,
    resolution_submitted_at: r.resolution_submitted_at ?? null,
    resolution_by_name: one<any>(r.resolution_by)?.full_name ?? null,
    comments,
  };
}

const SELECT = `id, job_id, title, description, dev_type, severity, status,
  due_date, root_cause, capa, inprocess_check_id, qa_sample_id,
  case_type, case_no, qa_reviewed_at, closed_at, created_at,
  resolution_note, resolution_submitted_at,
  departments:deviation_departments ( id, role_group, responded_at, response_note,
    responder:profiles!responded_by ( full_name ) ),
  machine:machines!machine_id ( code, name ),
  reporter:profiles!reported_by ( full_name ),
  resolution_by:profiles!resolution_submitted_by ( full_name ),
  comments:deviation_comments ( id, role_group, body, created_at,
    author:profiles!created_by ( full_name ) )`;

/** deviation ทั้งหมดของงาน (ใหม่สุดก่อน) */
export async function getDeviationsByJob(jobId: string): Promise<Deviation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deviations")
    .select(SELECT)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as any[]).map(shape);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
