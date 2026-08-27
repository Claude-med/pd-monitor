"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import {
  canPerformLineClearance,
  canCheckLineClearance,
} from "@/lib/data/role-access";

export type LcResult = { ok?: boolean; error?: string };

export type LcValues = {
  cleared_old: boolean;
  cleaned: boolean;
  setup_done: boolean;
  setup_minutes: string;
  cleared_old_time: string;
  cleaned_time: string;
  room: string;
  headcount: string;
  note: string;
};

/**
 * บันทึกการเคลียร์ไลน์ของ 1 ขั้นตอน × 1 เครื่อง (Part C.3 ก้อน 4)
 * ⚠️ ด่านจริงอยู่ที่ RPC — เช็กสิทธิ์ที่นี่แค่กันยิงเปล่า
 */
export async function performClearance(
  jobNo: string,
  jobRouteId: string,
  machineId: string,
  v: LcValues,
): Promise<LcResult> {
  const profile = await getProfile();
  if (!profile || !canPerformLineClearance(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหาร)" };
  if (!jobRouteId) return { error: "ไม่พบขั้นตอนการผลิตที่เลือก" };
  if (!machineId) return { error: "ไม่พบเครื่องจักรที่เลือก" };

  const mins = v.setup_minutes.trim() ? Number(v.setup_minutes) : null;
  if (mins != null && (!Number.isFinite(mins) || mins < 0))
    return { error: "เวลา set-up ไม่ถูกต้อง" };

  const hc = v.headcount.trim() ? Number(v.headcount) : null;
  if (hc != null && (!Number.isInteger(hc) || hc < 1))
    return { error: "จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("perform_line_clearance", {
    p_job_route_id: jobRouteId,
    p_machine_id: machineId,
    p_cleared_old: v.cleared_old,
    p_cleaned: v.cleaned,
    p_setup_done: v.setup_done,
    p_setup_minutes: mins,
    p_cleared_old_time: v.cleared_old_time.trim() || null,
    p_cleaned_time: v.cleaned_time.trim() || null,
    p_room: v.room.trim() || null,
    p_headcount: hc,
    p_note: v.note.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกไม่สำเร็จ" };

  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** ยืนยัน Line Clearance 1 ใบ — หัวหน้าฝ่ายผลิต/ผู้บริหาร และต้องคนละคนกับผู้ทำ */
export async function checkClearance(
  jobNo: string,
  lcId: string,
): Promise<LcResult> {
  const profile = await getProfile();
  if (!profile || !canCheckLineClearance(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะหัวหน้าฝ่ายผลิต/ผู้บริหาร)" };
  if (!lcId) return { error: "ไม่พบใบ Line Clearance" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("check_line_clearance", {
    p_lc_id: lcId,
  });
  if (error) return { error: error.message || "ยืนยันไม่สำเร็จ" };

  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
