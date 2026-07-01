import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import type {
  EditTargetType,
  EditRequestStatus,
} from "@/lib/data/edit-request-constants";

export type EditRequest = {
  id: string;
  target_type: EditTargetType;
  target_id: string;
  job_id: string | null;
  job_no: string | null;
  changes: Record<string, unknown>;
  reason: string;
  status: EditRequestStatus;
  requester_name: string | null;
  reviewer_name: string | null;
  review_note: string | null;
  requested_at: string;
  reviewed_at: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function mapRow(r: any): EditRequest {
  return {
    id: r.id,
    target_type: r.target_type,
    target_id: r.target_id,
    job_id: r.job_id ?? null,
    job_no: one<any>(r.job)?.job_no ?? r.job_no ?? null,
    changes: (r.changes ?? {}) as Record<string, unknown>,
    reason: r.reason,
    status: r.status,
    requester_name: one<any>(r.requester)?.full_name ?? null,
    reviewer_name: one<any>(r.reviewer)?.full_name ?? null,
    review_note: r.review_note ?? null,
    requested_at: r.requested_at,
    reviewed_at: r.reviewed_at ?? null,
  };
}

const SELECT = `id, target_type, target_id, job_id, changes, reason, status,
  review_note, requested_at, reviewed_at,
  requester:profiles!requested_by ( full_name ),
  reviewer:profiles!reviewed_by ( full_name ),
  job:jobs!job_id ( job_no )`;

/** คำขอแก้ไขของงานหนึ่ง (ใหม่สุดก่อน) — แสดงบนหน้างาน */
export async function getEditRequestsForJob(jobId: string): Promise<EditRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("edit_requests")
    .select(SELECT)
    .eq("job_id", jobId)
    .order("requested_at", { ascending: false });
  if (error || !data) return [];
  return (data as any[]).map(mapRow);
}

/** คำขอที่รออนุมัติทั้งหมด (เก่าสุดก่อน) — หน้ารีวิว manager/qa */
export async function getPendingEditRequests(): Promise<EditRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("edit_requests")
    .select(SELECT)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  if (error || !data) return [];
  return (data as any[]).map(mapRow);
}

/** id ของ target ที่มีคำขอ "รออนุมัติ" ค้างอยู่ (สำหรับ badge บนแถว) */
export async function getPendingTargetIds(jobId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("edit_requests")
    .select("target_id")
    .eq("job_id", jobId)
    .eq("status", "pending");
  return new Set((data ?? []).map((r: any) => r.target_id as string));
}

/** ค่าปัจจุบัน (before) ของฟิลด์ที่แก้ได้ ในรายการเป้าหมาย — โชว์ diff ในหน้ารีวิว */
export async function getTargetSnapshot(
  targetType: EditTargetType,
  targetId: string,
): Promise<Record<string, string>> {
  const supabase = await createClient();
  const table =
    targetType === "production_record"
      ? "production_records"
      : targetType === "material_requisition"
        ? "material_requisitions"
        : "inprocess_checks";
  const cols =
    targetType === "production_record"
      ? "input_qty, output_qty, loss_qty, hours, headcount, note, record_date, station, machine_id"
      : targetType === "material_requisition"
        ? "qty, note"
        : "param, value, unit, result, note";
  const { data } = await supabase.from(table).select(cols).eq("id", targetId).single();
  const out: Record<string, string> = {};
  if (data)
    for (const [k, v] of Object.entries(data as unknown as Record<string, unknown>))
      out[k] = v == null ? "" : String(v);
  return out;
}

/** จำนวนคำขอรออนุมัติ — สำหรับ badge เมนู (นับเฉพาะที่ผู้ดูอนุมัติได้จริง) */
export async function getPendingEditCount(roles: AppRole[]): Promise<number> {
  const supabase = await createClient();
  let query = supabase
    .from("edit_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  // qa (ที่ไม่ใช่ manager/admin) อนุมัติได้เฉพาะผลตรวจ QC → นับเฉพาะชนิดนั้น badge จะไม่หลอก
  if (!hasAnyRole(roles, ["manager", "admin"]))
    query = query.eq("target_type", "inprocess_check");
  const { count } = await query;
  return count ?? 0;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
