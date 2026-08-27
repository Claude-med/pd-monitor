"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import {
  canOpenDeviation,
  canCommentDeviation,
  canReviewIncident,
} from "@/lib/data/deviation-constants";

export type ActionResult = { ok?: boolean; id?: string; error?: string };

/**
 * เปิด Incident Case ใหม่ — ทุกคนที่ล็อกอิน (Part C.4)
 * ⚠️ ไม่มีช่อง "กำหนดปิด" และ "ผู้รับผิดชอบ" แล้ว — ย้ายไปขั้น QA ตรวจสอบ
 */
export async function openDeviation(
  jobNo: string,
  v: {
    job_id: string;
    title: string;
    description: string;
    dev_type: string;
    severity: string;
    machine_id?: string | null;
    inprocess_check_id?: string | null;
  },
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canOpenDeviation(profile.roles))
    return { error: "ไม่มีสิทธิ์เปิด Incident Case" };
  if (!v.title.trim()) return { error: "กรุณาระบุหัวข้อ Incident Case" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_deviation", {
    p_job_id: v.job_id,
    p_title: v.title.trim(),
    p_description: v.description.trim() || null,
    p_dev_type: v.dev_type || "other",
    p_severity: v.severity || "minor",
    p_machine_id: v.machine_id || null,
    p_inprocess_check_id: v.inprocess_check_id || null,
  });
  if (error) return { error: error.message || "เปิด Incident Case ไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true, id: data as string };
}

/**
 * อัปเดต / ปิด Incident Case
 * ปิด (closed) และยกเลิก (cancelled) = QA/ผู้บริหารเท่านั้น · ปิดต้องมี "การแก้ไขเบื้องต้น"
 * ⚠️ ไม่มีช่อง root cause แล้ว (Part C.4 ตัดออกตามที่ทีมสั่ง)
 */
export async function updateDeviation(
  jobNo: string,
  v: {
    id: string;
    status: string;
    capa: string;
    severity?: string;
    due_date?: string;
  },
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canCommentDeviation(profile.roles))
    return { error: "ไม่มีสิทธิ์แก้ไข Incident Case" };
  if (v.status === "closed" || v.status === "cancelled") {
    if (!canReviewIncident(profile.roles))
      return { error: "ปิด/ยกเลิก Incident Case ได้เฉพาะ QA/ผู้บริหาร" };
    if (v.status === "closed" && !v.capa.trim())
      return { error: 'ต้องระบุ "การแก้ไขเบื้องต้น" ก่อนปิด Incident Case' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_deviation", {
    p_id: v.id,
    p_status: v.status,
    p_capa: v.capa.trim() || null,
    p_severity: v.severity || null,
    p_due_date: v.due_date?.trim() || null,
  });
  if (error) return { error: error.message || "อัปเดต Incident Case ไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** D1: เพิ่มหมายเหตุของฝ่ายตน (append-only — ไม่ทับกัน) */
export async function addDeviationComment(
  jobNo: string,
  deviationId: string,
  body: string,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canCommentDeviation(profile.roles))
    return { error: "ไม่มีสิทธิ์เพิ่มหมายเหตุ" };
  if (!body.trim()) return { error: "กรุณาพิมพ์หมายเหตุ" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_deviation_comment", {
    p_deviation_id: deviationId,
    p_body: body.trim(),
  });
  if (error) return { error: error.message || "เพิ่มหมายเหตุไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** แผนกที่รับผิดชอบแจ้งว่าแก้ไขเรียบร้อย → ส่งกลับให้ QA อนุมัติ (แจ้งเตือน QA/ผู้บริหาร) */
export async function submitDeviationResolution(
  jobNo: string,
  deviationId: string,
  note: string,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canCommentDeviation(profile.roles))
    return { error: "ไม่มีสิทธิ์ส่ง Incident Case กลับให้ QA" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_deviation_resolution", {
    p_id: deviationId,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message || "ส่งให้ QA ไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
