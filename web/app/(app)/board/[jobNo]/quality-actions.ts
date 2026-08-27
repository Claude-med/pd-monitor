"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import {
  canRecordInprocess,
  canApproveInprocess,
} from "@/lib/data/role-access";
import { canRecordQaSample } from "@/lib/data/qa-sample-constants";

export type ActionResult = { ok?: boolean; error?: string };

/** บันทึกผลตรวจ QC ระหว่างผลิต */
export async function addInprocessCheck(
  jobNo: string,
  v: {
    job_id: string;
    job_route_id: string;
    production_record_id: string;
    param: string;
    value: string;
    unit: string;
    result: string;
    note: string;
    valid_date: string;
  },
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canRecordInprocess(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะ QC/หัวหน้า QC/ผู้บริหาร)" };
  if (!v.param.trim()) return { error: "กรุณาระบุหัวข้อที่ตรวจ" };
  if (!v.job_route_id) return { error: "ไม่พบขั้นตอนการผลิตที่เลือก" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_inprocess_check", {
    p_job_id: v.job_id,
    p_job_route_id: v.job_route_id,
    p_param: v.param.trim(),
    p_value: v.value.trim() || null,
    p_unit: v.unit.trim() || null,
    p_result: v.result === "fail" ? "fail" : "pass",
    p_note: v.note.trim() || null,
    p_production_record_id: v.production_record_id || null,
    p_valid_date: v.valid_date.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกผลตรวจไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/**
 * หัวหน้า QC อนุมัติ / ไม่อนุมัติ ผลตรวจ in-process 1 รายการ (Part C.3 ก้อน 6)
 * ⚠️ ด่านจริงอยู่ที่ RPC — บังคับทั้งสิทธิ์และกฎ "ผู้อนุมัติต้องคนละคนกับผู้ลงผล"
 */
export async function reviewInprocessCheck(
  jobNo: string,
  id: string,
  decision: "approve" | "reject",
  note: string,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canApproveInprocess(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะหัวหน้า QC/ผู้บริหาร)" };
  if (!id) return { error: "ไม่พบผลตรวจที่เลือก" };
  if (decision === "reject" && !note.trim())
    return { error: "การไม่อนุมัติต้องระบุเหตุผล" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_inprocess_check", {
    p_id: id,
    p_decision: decision,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message || "บันทึกผลพิจารณาไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** ช่องที่ฟอร์มจุดเก็บตัวอย่างส่งมา (ส่งครบทุกช่องเสมอ — ค่าว่าง = ล้างค่า) */
export type QaSampleInput = {
  qty: string;
  unit: string;
  result: string;
  /** ค่าจาก <input type="datetime-local"> เช่น "2026-08-27T14:30" (ไม่มี timezone) */
  collected_at: string;
  note: string;
};

type ParsedSample = {
  p_qty: number | null;
  p_unit: string | null;
  p_result: "pass" | "fail" | null;
  p_collected_at: string | null;
  p_note: string | null;
};

/**
 * แปลงค่าจากฟอร์มเป็นพารามิเตอร์ RPC — คืน string เมื่อ validate ไม่ผ่าน
 *
 * ⚠️ `datetime-local` ให้ค่าแบบไม่มี timezone — ถ้าส่งดิบๆ Postgres/รันไทม์ (Vercel = UTC)
 *    จะตีความเป็น UTC ทำให้เวลาเพี้ยน 7 ชม. → ต่อท้าย offset ของไทยให้ชัดเจน
 */
function parseSample(v: QaSampleInput): ParsedSample | string {
  let qty: number | null = null;
  if (v.qty.trim() !== "") {
    qty = Number(v.qty);
    if (!Number.isFinite(qty) || qty < 0)
      return "จำนวนตัวอย่างไม่ถูกต้อง (ห้ามติดลบ)";
  }

  const result = v.result === "pass" || v.result === "fail" ? v.result : null;

  let collectedAt: string | null = null;
  if (v.collected_at.trim() !== "") {
    // "2026-08-27T14:30" → "2026-08-27T14:30:00+07:00"
    const raw = v.collected_at.trim();
    const withSeconds = raw.length === 16 ? `${raw}:00` : raw;
    collectedAt = `${withSeconds}+07:00`;
    if (Number.isNaN(new Date(collectedAt).getTime()))
      return "วันที่/เวลาที่เก็บตัวอย่างไม่ถูกต้อง";
  }

  return {
    p_qty: qty,
    p_unit: v.unit.trim() || null,
    p_result: result,
    p_collected_at: collectedAt,
    p_note: v.note.trim() || null,
  };
}

/** บันทึกจุดเก็บตัวอย่าง (ตรวจ Finished product) */
export async function addQaSample(
  jobNo: string,
  jobId: string,
  v: QaSampleInput,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canRecordQaSample(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะ QA/ผู้บริหาร)" };

  const parsed = parseSample(v);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_qa_sample", {
    p_job_id: jobId,
    ...parsed,
  });
  if (error) return { error: error.message || "บันทึกจุดเก็บตัวอย่างไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** แก้ไขจุดเก็บตัวอย่าง (QA เท่านั้น · งานต้องยังอยู่สถานะ QA — ด่านจริงอยู่ที่ RPC) */
export async function updateQaSample(
  jobNo: string,
  id: string,
  v: QaSampleInput,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canRecordQaSample(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะ QA/ผู้บริหาร)" };
  if (!id) return { error: "ไม่พบรายการที่เลือก" };

  const parsed = parseSample(v);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_qa_sample", {
    p_id: id,
    ...parsed,
  });
  if (error) return { error: error.message || "แก้ไขจุดเก็บตัวอย่างไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** ลบจุดเก็บตัวอย่าง — soft delete ใน DB (ยังอยู่ใน audit_log) */
export async function deleteQaSample(
  jobNo: string,
  id: string,
  reason: string,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canRecordQaSample(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะ QA/ผู้บริหาร)" };
  if (!id) return { error: "ไม่พบรายการที่เลือก" };
  if (!reason.trim()) return { error: "กรุณาระบุเหตุผลที่ลบ" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_qa_sample", {
    p_id: id,
    p_reason: reason.trim(),
  });
  if (error) return { error: error.message || "ลบจุดเก็บตัวอย่างไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
