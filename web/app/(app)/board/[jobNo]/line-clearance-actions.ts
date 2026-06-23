"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LcResult = { ok?: boolean; error?: string };

/** บันทึกการเคลียร์ไลน์ (ฝ่ายผลิต/ผู้บริหาร) */
export async function performClearance(
  jobNo: string,
  jobId: string,
  v: {
    cleared_old: boolean;
    cleaned: boolean;
    setup_done: boolean;
    setup_minutes: string;
    note: string;
  },
): Promise<LcResult> {
  const mins = v.setup_minutes.trim() ? Number(v.setup_minutes) : null;
  if (mins != null && (!Number.isFinite(mins) || mins < 0))
    return { error: "เวลา set-up ไม่ถูกต้อง" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("perform_line_clearance", {
    p_job_id: jobId,
    p_cleared_old: v.cleared_old,
    p_cleaned: v.cleaned,
    p_setup_done: v.setup_done,
    p_setup_minutes: mins,
    p_note: v.note.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** ตรวจรับ Line Clearance (ลายเซ็นที่สอง — คนละคนกับผู้เคลียร์) */
export async function checkClearance(
  jobNo: string,
  jobId: string,
): Promise<LcResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_line_clearance", {
    p_job_id: jobId,
  });
  if (error) return { error: error.message || "ตรวจรับไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
