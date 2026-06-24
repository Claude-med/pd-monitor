import { createClient } from "@/lib/supabase/server";
import type { DeviationSeverity, DeviationStatus } from "@/lib/data/deviation-constants";

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
  machine_label: string | null;
  reporter_name: string | null;
  assignee_name: string | null;
  closed_at: string | null;
  created_at: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function shape(r: any): Deviation {
  const machine = one<any>(r.machine);
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
    machine_label: machine ? `${machine.code} · ${machine.name}` : null,
    reporter_name: one<any>(r.reporter)?.full_name ?? null,
    assignee_name: one<any>(r.assignee)?.full_name ?? null,
    closed_at: r.closed_at,
    created_at: r.created_at,
  };
}

const SELECT = `id, job_id, title, description, dev_type, severity, status,
  due_date, root_cause, capa, inprocess_check_id, closed_at, created_at,
  machine:machines!machine_id ( code, name ),
  reporter:profiles!reported_by ( full_name ),
  assignee:profiles!assigned_to ( full_name )`;

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
