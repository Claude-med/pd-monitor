"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { canEditJobPlanFields, canEditJobProductionFields } from "@/lib/data/role-access";

/**
 * บันทึกการแก้ข้อมูลงานจากการ์ด "ข้อมูลงาน" (Part C ก้อน 3 · migration 0054)
 *
 * ⚠️ ส่งเฉพาะ "คีย์ที่ผู้ใช้แก้จริง" เท่านั้น — คีย์ที่ไม่ส่ง DB จะไม่แตะ
 *    (ห้ามส่งค่าทั้งใบจาก snapshot ที่ค้างในเบราว์เซอร์ ไม่งั้นทับของที่คนอื่นเพิ่งแก้)
 */

export type JobEditResult = {
  ok?: boolean;
  message?: string;
  error?: string;
};

export async function updateJobDetails(
  jobNo: string,
  jobId: string,
  fields: Record<string, string | null>,
  reason?: string,
): Promise<JobEditResult> {
  const profile = await getProfile();
  if (!profile) return { error: "ยังไม่ได้เข้าสู่ระบบ" };

  const roles = profile.roles;
  if (!canEditJobPlanFields(roles) && !canEditJobProductionFields(roles)) {
    return { error: "ไม่มีสิทธิ์แก้ข้อมูลงาน (เฉพาะฝ่ายวางแผน/ฝ่ายผลิต/ผู้บริหาร)" };
  }
  if (!jobId) return { error: "ไม่พบงานที่เลือก" };
  if (!fields || Object.keys(fields).length === 0) {
    return { error: "ยังไม่มีช่องไหนถูกแก้" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_job_details", {
    p_job_id: jobId,
    p_fields: fields,
    p_reason: reason?.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกข้อมูลงานไม่สำเร็จ" };

  const res = (data ?? {}) as { message?: string };
  revalidatePath("/board");
  revalidatePath(`/board/${jobNo}`);
  revalidatePath(`/board/${jobNo}/ebr`);
  return { ok: true, message: res.message ?? "บันทึกแล้ว" };
}
