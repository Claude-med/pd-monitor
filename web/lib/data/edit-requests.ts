import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import {
  EDIT_TARGET_LABEL,
  canReviewEdit,
  type EditTargetType,
  type EditRequestStatus,
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
  // ระบบเบิกเดิมถูกยกเลิกใน Part C.2 (ตาราง material_requisitions ถูก drop ใน 0057)
  // คำขอชนิดนี้สร้างใหม่ไม่ได้แล้ว แต่แถวเก่าอาจค้างอยู่ — ต้องกันก่อนแตะ query
  // ไม่งั้นหน้าคำขอแก้ไขจะพังทั้งหน้าเพราะ query ตารางที่ไม่มีอยู่จริง
  if (targetType === "material_requisition") return {};

  const supabase = await createClient();
  const [table, cols] =
    targetType === "production_record"
      ? [
          "production_records",
          "input_qty, output_qty, loss_qty, minutes, headcount, note, record_date, station_id, machine_id, input_unit, output_unit, loss_unit, shift, work_period",
        ]
      : targetType === "qa_sample"
        ? // Part H (0099): ต้องตรงกับ whitelist ของ request_edit สาขา qa_sample
          ["qa_samples", "qty, unit, result, collected_at, note"]
        : // Part D: เดิมขาด station_id/valid_date ทั้งที่ whitelist ของ request_edit เปิดให้แก้ได้
          //          (0065:136) → คอลัมน์ "ค่าเดิม" ในหน้ารีวิวขึ้น "—" ผู้อนุมัติเห็น diff ไม่ครบ
          ["inprocess_checks", "param, value, unit, result, note, station_id, valid_date"];
  const { data } = await supabase.from(table).select(cols).eq("id", targetId).single();
  const out: Record<string, string> = {};
  if (data)
    for (const [k, v] of Object.entries(data as unknown as Record<string, unknown>))
      out[k] =
        v == null
          ? ""
          : k === "collected_at"
            ? toBangkokInput(String(v)) // ให้รูปแบบเดียวกับค่าใหม่จาก datetime-local
            : String(v);
  return out;
}

/** ISO → "YYYY-MM-DDTHH:mm" เวลาไทย (Vercel เป็น UTC — ต้องล็อก timeZone เอง) */
function toBangkokInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tz = "Asia/Bangkok";
  const date = d.toLocaleDateString("en-CA", { timeZone: tz });
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date}T${time}`;
}

/**
 * จำนวนคำขอรออนุมัติ — สำหรับ badge เมนู (นับเฉพาะที่ผู้ดูอนุมัติได้จริง)
 *
 * ⚠️ ต้องเดินตาม EDIT_REVIEWER_TARGETS เสมอ ห้าม hardcode ชนิดคำขอไว้ที่นี่ —
 *    ของเดิมล็อกไว้ว่า "ไม่ใช่ manager → นับเฉพาะ inprocess_check" พอ 0083 เพิ่ม
 *    หัวหน้าฝ่ายผลิตเป็นผู้อนุมัติ badge ของเขาจะขึ้น 0 ตลอดทั้งที่มีคำขอค้างอยู่
 */
export async function getPendingEditCount(roles: AppRole[]): Promise<number> {
  const supabase = await createClient();
  let query = supabase
    .from("edit_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (!hasAnyRole(roles, ["admin"])) {
    // Part H: เดินตาม canReviewEdit ตัวเดียว (ผู้บริหารอนุมัติ qa_sample ไม่ได้)
    const types = (Object.keys(EDIT_TARGET_LABEL) as EditTargetType[]).filter(
      (t) => canReviewEdit(roles, t),
    );
    if (types.length === 0) return 0;
    query = query.in("target_type", types);
  }

  const { count } = await query;
  return count ?? 0;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
