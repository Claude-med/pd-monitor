"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateRecord, type RecordFormValues } from "@/lib/data/station-constants";

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
  values: RecordFormValues,
  clientId?: string,
): Promise<RecordResult> {
  const { errors, parsed } = validateRecord(values);
  if (!parsed) {
    return { error: "กรอกข้อมูลไม่ครบ/ไม่ถูกต้อง", fieldErrors: errors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_production_record", {
    p_job_id: jobId,
    p_station: parsed.station,
    p_input: parsed.input_qty,
    p_output: parsed.output_qty,
    p_loss: parsed.loss_qty,
    p_hours: parsed.hours,
    p_record_date: parsed.record_date,
    p_note: parsed.note || null,
    // idempotency key (UUID จาก client) — retry แล้วไม่เกิดแถวซ้ำ
    p_client_id: clientId ?? null,
    p_machine_id: parsed.machine_id,
  });

  if (error) {
    return { error: error.message || "บันทึกไม่สำเร็จ" };
  }

  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
