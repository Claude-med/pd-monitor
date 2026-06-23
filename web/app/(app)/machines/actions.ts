"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";

export type MachineValues = {
  id: string | null;
  code: string;
  name: string;
  station: string;
  status: string;
  note: string;
  last_clean_date: string;
  next_maintenance_date: string;
  next_calibration_date: string;
};

export type ActionResult = { ok?: boolean; id?: string; error?: string };

/** เพิ่ม/แก้เครื่องจักร ผ่าน rpc — DB บังคับสิทธิ์ manager/admin + validate */
export async function upsertMachine(v: MachineValues): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !hasRole(profile.roles, "manager"))
    return { error: "ไม่มีสิทธิ์ (เฉพาะผู้บริหาร/ผู้ดูแลระบบ)" };

  if (!v.code.trim()) return { error: "กรุณาระบุรหัสเครื่อง (code)" };
  if (!v.name.trim()) return { error: "กรุณาระบุชื่อเครื่อง" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_machine", {
    p_id: v.id,
    p_code: v.code.trim(),
    p_name: v.name.trim(),
    p_station: v.station || null,
    p_status: v.status || "available",
    p_note: v.note.trim() || null,
    p_last_clean_date: v.last_clean_date || null,
    p_next_maintenance_date: v.next_maintenance_date || null,
    p_next_calibration_date: v.next_calibration_date || null,
  });

  if (error) return { error: error.message || "บันทึกเครื่องจักรไม่สำเร็จ" };
  revalidatePath("/machines");
  return { ok: true, id: data as string };
}
