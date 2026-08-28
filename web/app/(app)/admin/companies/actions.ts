"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";

export type ActionResult = { ok?: boolean; error?: string };

/** กันสิทธิ์ฝั่งแอป — ด่านจริงอยู่ที่ admin_set_job_no_config() ใน DB (0071) */
async function requireManager(): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && hasRole(profile.roles, "manager");
}

/**
 * ตั้งค่าเลขงานของบริษัทหนึ่ง (Part D · 0071)
 *
 * - `nextSeq`      = เลข running ของ "ใบถัดไป" ในปี พ.ศ. ปัจจุบัน (ใช้ทันที)
 * - `yearStartSeq` = เลขตั้งต้นเมื่อขึ้นปี พ.ศ. ใหม่
 *
 * ส่งค่าว่าง = ไม่เปลี่ยนค่านั้น · ตั้งเลขถัดไปย้อนหลังไม่ได้ (DB ปฏิเสธ กันเลขงานซ้ำ)
 */
export async function setJobNoConfig(v: {
  companyId: string;
  nextSeq: string;
  yearStartSeq: string;
}): Promise<ActionResult> {
  if (!(await requireManager()))
    return { error: "เฉพาะผู้บริหาร/ผู้ดูแลระบบตั้งเลขงานได้" };
  if (!v.companyId) return { error: "ไม่พบบริษัทที่เลือก" };

  const next = v.nextSeq.trim();
  const start = v.yearStartSeq.trim();
  if (!next && !start) return { error: "ยังไม่มีค่าที่เปลี่ยน" };

  const nextSeq = next ? Number(next) : null;
  const yearStartSeq = start ? Number(start) : null;

  for (const [label, n] of [
    ["เลขถัดไป", nextSeq],
    ["เลขตั้งต้นปีใหม่", yearStartSeq],
  ] as const) {
    if (n === null) continue;
    if (!Number.isInteger(n) || n < 1 || n > 9999)
      return { error: `${label} ต้องเป็นจำนวนเต็ม 1–9999` };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_job_no_config", {
    p_company_id: v.companyId,
    p_next_seq: nextSeq,
    p_year_start_seq: yearStartSeq,
  });
  if (error) return { error: error.message || "ตั้งค่าเลขงานไม่สำเร็จ" };

  revalidatePath("/admin/companies");
  revalidatePath("/board/new");
  return { ok: true };
}
