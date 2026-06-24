"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

export type ActionResult = { ok?: boolean; error?: string };

/** บันทึกผลตรวจ QC ระหว่างผลิต */
export async function addInprocessCheck(
  jobNo: string,
  v: {
    job_id: string;
    station: string;
    param: string;
    value: string;
    unit: string;
    result: string;
    note: string;
  },
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !hasAnyRole(profile.roles, ["qc", "manager"]))
    return { error: "ไม่มีสิทธิ์ (เฉพาะ QC/ผู้บริหาร)" };
  if (!v.param.trim()) return { error: "กรุณาระบุหัวข้อที่ตรวจ" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_inprocess_check", {
    p_job_id: v.job_id,
    p_station: v.station,
    p_param: v.param.trim(),
    p_value: v.value.trim() || null,
    p_unit: v.unit.trim() || null,
    p_result: v.result === "fail" ? "fail" : "pass",
    p_note: v.note.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกผลตรวจไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** บันทึกจุด/รอบเก็บตัวอย่าง QA */
export async function addQaSample(
  jobNo: string,
  v: {
    job_id: string;
    sample_point: string;
    qty: string;
    unit: string;
    note: string;
  },
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !hasAnyRole(profile.roles, ["qa", "manager"]))
    return { error: "ไม่มีสิทธิ์ (เฉพาะ QA/ผู้บริหาร)" };
  if (!v.sample_point.trim()) return { error: "กรุณาระบุจุด/รอบเก็บตัวอย่าง" };

  let qty: number | null = null;
  if (v.qty.trim() !== "") {
    qty = Number(v.qty);
    if (!Number.isFinite(qty) || qty < 0)
      return { error: "จำนวนตัวอย่างไม่ถูกต้อง (ห้ามติดลบ)" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_qa_sample", {
    p_job_id: v.job_id,
    p_sample_point: v.sample_point.trim(),
    p_qty: qty,
    p_unit: v.unit.trim() || null,
    p_note: v.note.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกจุดเก็บตัวอย่างไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
