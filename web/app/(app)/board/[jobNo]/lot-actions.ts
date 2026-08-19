"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { canSetJobLot } from "@/lib/data/role-access";

export type SetLotResult = { ok?: boolean; error?: string };

/**
 * กรอก/แก้ LOT No. (Batch NO.) ของงาน — ฝ่ายผลิต/ผู้บริหาร (migration 0049)
 *
 * ฝ่ายวางแผนไม่รู้เลขล็อตตอนสร้างงาน (0048 ตัดช่องนี้ออกจากหน้าสร้างงาน)
 * ฝ่ายผลิตจึงมากรอกเองที่หน้างานก่อนกด "เริ่มผลิต"
 * DB เป็นด่านจริง: สิทธิ์ · เลขซ้ำ · และล็อกเมื่องานเข้าสถานะ "กำลังผลิต" แล้ว
 */
export async function setJobLot(
  jobNo: string,
  jobId: string,
  lotNo: string,
  mfgDate: string,
  expDate: string,
): Promise<SetLotResult> {
  const profile = await getProfile();
  if (!profile || !canSetJobLot(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายผลิต/ผู้บริหาร)" };
  if (!jobId) return { error: "ไม่พบงาน" };
  if (!lotNo.trim()) return { error: "กรุณากรอกเลขล็อต (LOT No.)" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_job_lot", {
    p_job_id: jobId,
    p_lot_no: lotNo.trim(),
    p_mfg_date: mfgDate || null,
    p_exp_date: expDate || null,
  });
  if (error) return { error: error.message || "บันทึกเลขล็อตไม่สำเร็จ" };

  revalidatePath("/board");
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
