"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import type { EditTargetType } from "@/lib/data/edit-request-constants";

export type ActionResult = { ok?: boolean; error?: string };

/** ยื่นคำขอแก้ไขย้อนหลัง (ผลผลิต/ใบเบิก/QC) */
export async function requestEdit(
  jobNo: string,
  targetType: EditTargetType,
  targetId: string,
  changes: Record<string, string | null>,
  reason: string,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบ" };
  if (!reason.trim()) return { error: "กรุณาระบุเหตุผลการขอแก้ไข" };
  if (!changes || Object.keys(changes).length === 0)
    return { error: "ยังไม่มีการแก้ไข (ค่ายังเหมือนเดิม)" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_edit", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_changes: changes,
    p_reason: reason.trim(),
  });
  if (error) return { error: error.message || "ส่งคำขอไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** ยกเลิกคำขอที่ยังรออนุมัติ */
export async function cancelEditRequest(
  jobNo: string,
  id: string,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบ" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_edit_request", { p_id: id });
  if (error) return { error: error.message || "ยกเลิกไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
