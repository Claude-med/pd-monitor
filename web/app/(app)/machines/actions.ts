"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import {
  canManageMachines,
  canSetMachineSchedule,
} from "@/lib/data/role-access";

export type MachineValues = {
  id: string | null;
  code: string;
  name: string;
  station: string;
  room: string;
  status: string;
  note: string;
  last_clean_date: string;
  next_maintenance_date: string;
  next_calibration_date: string;
};

export type ActionResult = { ok?: boolean; id?: string; error?: string };

/**
 * เพิ่ม/แก้เครื่องจักร ผ่าน rpc — DB บังคับสิทธิ์ + validate (migration 0039)
 *   จัดการเครื่อง = ฝ่ายผลิต / วิศวกรรม / ผู้บริหาร
 *   กำหนดซ่อมบำรุง-สอบเทียบ = วิศวกรรม / ผู้บริหาร เท่านั้น
 */
export async function upsertMachine(v: MachineValues): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !canManageMachines(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายผลิต/วิศวกรรม/ผู้บริหาร)" };

  if (!v.code.trim()) return { error: "กรุณาระบุรหัสเครื่อง (code)" };
  if (!v.name.trim()) return { error: "กรุณาระบุชื่อเครื่อง" };

  // ไม่ใช่วิศวกรรม/ผู้บริหาร → ไม่ส่งวันซ่อม/สอบเทียบ (DB จะคงค่าเดิมไว้เอง)
  const canSchedule = canSetMachineSchedule(profile.roles);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_machine", {
    p_id: v.id,
    p_code: v.code.trim(),
    p_name: v.name.trim(),
    p_station: v.station || null,
    p_room: v.room.trim() || null,
    p_status: v.status || "available",
    p_note: v.note.trim() || null,
    p_last_clean_date: v.last_clean_date || null,
    p_next_maintenance_date: canSchedule
      ? v.next_maintenance_date || null
      : null,
    p_next_calibration_date: canSchedule
      ? v.next_calibration_date || null
      : null,
  });

  if (error) return { error: error.message || "บันทึกเครื่องจักรไม่สำเร็จ" };
  revalidatePath("/machines");
  return { ok: true, id: data as string };
}
