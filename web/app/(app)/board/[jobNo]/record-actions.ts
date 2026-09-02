"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { canApproveProductionRecord } from "@/lib/data/role-access";
import { validateRecord, type RecordFormValues } from "@/lib/data/production-constants";

export type RecordResult = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<keyof RecordFormValues, string>>;
};

/**
 * บันทึกผลผลิตรายวัน — validate ฝั่ง server แล้วเรียก rpc add_production_record()
 * (DB ตรวจซ้ำ + บังคับสิทธิ์/สถานะ/audit เป็นด่านสุดท้าย · ที่นี่กันค่าพังก่อนถึง DB)
 */
export async function addRecord(
  jobId: string,
  jobNo: string,
  jobRouteId: string,
  values: RecordFormValues,
  clientId?: string,
): Promise<RecordResult> {
  // ตรวจสิทธิ์ฝั่ง server ด้วย — เดิมไม่มีเลย พึ่ง guard ใน add_production_record อย่างเดียว
  // (ผู้ใช้จะได้ข้อความไทยที่อ่านรู้เรื่องแทน error ดิบจาก DB)
  const profile = await getProfile();
  if (
    !profile ||
    !hasAnyRole(profile.roles, ["production", "production_lead", "manager"])
  )
    return { error: "ไม่มีสิทธิ์บันทึกผลผลิต (เฉพาะฝ่ายผลิต)" };

  if (!jobRouteId) return { error: "ไม่พบขั้นตอนการผลิตที่เลือก" };
  const { errors, parsed } = validateRecord(values);
  if (!parsed) {
    return { error: "กรอกข้อมูลไม่ครบ/ไม่ถูกต้อง", fieldErrors: errors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_production_record", {
    p_job_id: jobId,
    p_job_route_id: jobRouteId,
    p_input: parsed.input_qty,
    p_output: parsed.output_qty,
    p_loss: parsed.loss_qty,
    p_minutes: parsed.minutes,
    p_record_date: parsed.record_date,
    p_note: parsed.note || null,
    // idempotency key (UUID จาก client) — retry แล้วไม่เกิดแถวซ้ำ
    p_client_id: clientId ?? null,
    p_machine_id: parsed.machine_id,
    p_headcount: parsed.headcount,
    p_shift: parsed.shift,
    p_period: parsed.work_period,
    p_input_unit: parsed.input_unit,
    p_output_unit: parsed.output_unit,
    p_loss_unit: parsed.loss_unit,
  });

  if (error) {
    return { error: error.message || "บันทึกไม่สำเร็จ" };
  }

  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

export type ReviewResult = {
  ok?: boolean;
  error?: string;
  /** ใช้กับการอนุมัติหลายรายการ — จำนวนที่สำเร็จ / ที่ถูกข้าม */
  approved?: number;
  skipped?: number;
};

/**
 * อนุมัติ / ไม่อนุมัติ บันทึกผลผลิต 1 แถว (หัวหน้าฝ่ายผลิต)
 * DB บังคับซ้ำว่า "ผู้อนุมัติต้องคนละคนกับผู้บันทึก" และไม่อนุมัติต้องมีเหตุผล (0080)
 */
export async function reviewRecord(
  jobNo: string,
  id: string,
  decision: "approve" | "reject",
  note: string,
): Promise<ReviewResult> {
  const profile = await getProfile();
  if (!profile || !canApproveProductionRecord(profile.roles))
    return { error: "เฉพาะหัวหน้าฝ่ายผลิต/ผู้บริหารอนุมัติบันทึกผลผลิตได้" };
  if (decision === "reject" && !note.trim())
    return { error: "การไม่อนุมัติต้องระบุเหตุผล" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_production_record", {
    p_id: id,
    p_decision: decision,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message || "ดำเนินการไม่สำเร็จ" };

  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/**
 * อนุมัติ / ไม่อนุมัติ หลายแถวรวดเดียว (ติ๊กเลือกจากตาราง)
 * แถวที่ทำไม่ได้ (ตัวเองเป็นผู้บันทึก / พิจารณาไปแล้ว) จะถูกข้าม แล้วรายงานจำนวนกลับมา
 */
export async function reviewRecords(
  jobNo: string,
  ids: string[],
  decision: "approve" | "reject",
  note: string,
): Promise<ReviewResult> {
  const profile = await getProfile();
  if (!profile || !canApproveProductionRecord(profile.roles))
    return { error: "เฉพาะหัวหน้าฝ่ายผลิต/ผู้บริหารอนุมัติบันทึกผลผลิตได้" };
  if (ids.length === 0) return { error: "ยังไม่ได้เลือกรายการ" };
  if (decision === "reject" && !note.trim())
    return { error: "การไม่อนุมัติต้องระบุเหตุผล" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_production_records", {
    p_ids: ids,
    p_decision: decision,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message || "ดำเนินการไม่สำเร็จ" };

  revalidatePath(`/board/${jobNo}`);
  const res = (data ?? {}) as { approved?: number; skipped?: number };
  return { ok: true, approved: res.approved ?? 0, skipped: res.skipped ?? 0 };
}
