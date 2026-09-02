"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import {
  canReviewEdit,
  type EditTargetType,
} from "@/lib/data/edit-request-constants";

export type ActionResult = { ok?: boolean; error?: string };

/**
 * อนุมัติ (→ แก้จริง) / ปฏิเสธ คำขอแก้ไข — manager/admin เสมอ · qa + หัวหน้า QC เฉพาะผลตรวจ QC
 *
 * ⚠️ ต้องเช็กด้วย canReviewEdit(roles, targetType) ไม่ใช่แค่ "อยู่ในกลุ่ม reviewer" —
 *    RPC review_edit_request (0073:151-155) ให้ qa/qc_lead อนุมัติได้เฉพาะ inprocess_check
 *    ถ้าเช็กหลวมกว่านั้น ผู้ใช้จะได้ error ดิบจาก DB แทนข้อความที่อ่านรู้เรื่อง
 */
export async function reviewEditRequest(
  id: string,
  decision: "approve" | "reject",
  note: string,
  targetType: EditTargetType,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canReviewEdit(profile.roles, targetType))
    return { error: "คำขอนี้ต้องให้ผู้จัดการอนุมัติ — บัญชีของคุณไม่มีสิทธิ์" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_edit_request", {
    p_id: id,
    p_decision: decision,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message || "ดำเนินการไม่สำเร็จ" };
  revalidatePath("/edit-requests");
  return { ok: true };
}
