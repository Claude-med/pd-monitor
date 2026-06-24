"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { canOpenDeviation, canCloseDeviation } from "@/lib/data/deviation-constants";

export type ActionResult = { ok?: boolean; id?: string; error?: string };

/** เปิด deviation ใหม่ (production/qc/qa/manager) */
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
    due_date?: string;
  },
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canOpenDeviation(profile.roles))
    return { error: "ไม่มีสิทธิ์เปิด deviation" };
  if (!v.title.trim()) return { error: "กรุณาระบุหัวข้อ deviation" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_deviation", {
    p_job_id: v.job_id,
    p_title: v.title.trim(),
    p_description: v.description.trim() || null,
    p_dev_type: v.dev_type || "other",
    p_severity: v.severity || "minor",
    p_machine_id: v.machine_id || null,
    p_inprocess_check_id: v.inprocess_check_id || null,
    p_assigned_to: null,
    p_due_date: v.due_date?.trim() || null,
  });
  if (error) return { error: error.message || "เปิด deviation ไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true, id: data as string };
}

/** อัปเดต/ปิด deviation — ปิด (closed) เฉพาะ qa/manager + ต้องมี root cause + CAPA */
export async function updateDeviation(
  jobNo: string,
  v: {
    id: string;
    status: string;
    root_cause: string;
    capa: string;
    severity?: string;
    due_date?: string;
  },
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canOpenDeviation(profile.roles))
    return { error: "ไม่มีสิทธิ์แก้ไข deviation" };
  if (v.status === "closed") {
    if (!canCloseDeviation(profile.roles))
      return { error: "ปิด deviation ได้เฉพาะ QA/ผู้บริหาร" };
    if (!v.root_cause.trim() || !v.capa.trim())
      return { error: "ต้องระบุสาเหตุ (root cause) และการแก้ไข/ป้องกัน (CAPA) ก่อนปิด" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_deviation", {
    p_id: v.id,
    p_status: v.status,
    p_root_cause: v.root_cause.trim() || null,
    p_capa: v.capa.trim() || null,
    p_assigned_to: null,
    p_due_date: v.due_date?.trim() || null,
    p_severity: v.severity || null,
  });
  if (error) return { error: error.message || "อัปเดต deviation ไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
