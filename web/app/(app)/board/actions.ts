"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok?: boolean; error?: string };

/**
 * เปลี่ยนสถานะงาน — เรียกฟังก์ชัน advance_job_status() ใน DB
 * (DB เป็นด่านบังคับลำดับ/สิทธิ์/เหตุผลจริง · ที่นี่แค่ส่งต่อ + แสดง error)
 */
export async function changeStatus(
  jobId: string,
  jobNo: string,
  toStatus: string,
  reason: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_job_status", {
    p_job_id: jobId,
    p_to: toStatus,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });

  if (error) {
    return { error: error.message || "ทำรายการไม่สำเร็จ" };
  }

  revalidatePath("/board");
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
