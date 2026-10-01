"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { verifyPassword } from "@/lib/auth/verify-password";

export type ActionResult = { ok?: boolean; error?: string };

/**
 * DB (advance_job_status) ยังส่งคำว่า "deviation" มา แต่หน้าจอใช้ชื่อ "Incident Case" ทั้งระบบ
 * → แปลงเฉพาะฝั่งแสดงผล (Part G ก้อน 1 · ทีมขอแก้แค่ frontend)
 */
function toUiMessage(message: string): string {
  return message.replace("deviation เปิดค้าง", "Incident Case เปิดค้าง");
}

/**
 * เปลี่ยนสถานะงาน — เรียกฟังก์ชัน advance_job_status() ใน DB
 * (DB เป็นด่านบังคับลำดับ/สิทธิ์/เหตุผลจริง · ที่นี่แค่ส่งต่อ + แสดง error)
 */
export async function changeStatus(
  jobId: string,
  jobNo: string,
  fromStatus: string,
  toStatus: string,
  reason: string | null,
): Promise<ActionResult> {
  // ขั้นตัดสินคุณภาพ QC/QA ต้องผ่าน signDecision (ยืนยันรหัสผ่าน + บันทึกลายเซ็น) เท่านั้น
  // DB บังคับซ้ำใน advance_job_status (0105) — ที่นี่แค่ให้ข้อความที่อ่านรู้เรื่อง
  if (["qc", "qa"].includes(fromStatus))
    return { error: "ขั้น QC/QA ต้องลงนามด้วยรหัสผ่าน — ใช้ปุ่มลงนามแทน" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_job_status", {
    p_job_id: jobId,
    p_to: toStatus,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });

  if (error) {
    return { error: toUiMessage(error.message || "ทำรายการไม่สำเร็จ") };
  }

  revalidatePath("/board");
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/**
 * ยกเลิกงาน (แทนการลบ · 0109) — งานและข้อมูลทั้งหมดยังอยู่ครบ แค่ถูกล็อก + ซ่อนจากบอร์ด
 * DB (cancel_job) เป็นด่านบังคับสิทธิ์จริง: หัวหน้าแผนก = ก่อนเริ่มผลิต · ผู้บริหาร/admin = ทุกสถานะยกเว้น FG
 * ต้องมีเหตุผล + ยืนยันรหัสผ่านซ้ำ (พิสูจน์ว่า "คนหน้าจอ = เจ้าของบัญชี" แพตเทิร์นเดียวกับ signDecision)
 */
export async function cancelJob(
  jobId: string,
  jobNo: string,
  reason: string,
  password: string,
): Promise<ActionResult> {
  return jobCancelOp("cancel_job", "ยกเลิกงาน", jobId, jobNo, reason, password);
}

/** คืนงานที่ยกเลิกผิดกลับสถานะเดิม — ผู้บริหาร/admin (restore_job · 0109) */
export async function restoreJob(
  jobId: string,
  jobNo: string,
  reason: string,
  password: string,
): Promise<ActionResult> {
  return jobCancelOp("restore_job", "คืนงาน", jobId, jobNo, reason, password);
}

async function jobCancelOp(
  rpc: "cancel_job" | "restore_job",
  what: string,
  jobId: string,
  jobNo: string,
  reason: string,
  password: string,
): Promise<ActionResult> {
  if (!reason || reason.trim().length < 5) {
    return { error: "กรุณาระบุเหตุผล (อย่างน้อย 5 ตัวอักษร)" };
  }
  if (!password || !password.trim()) {
    return { error: `กรุณากรอกรหัสผ่านเพื่อยืนยันการ${what}` };
  }

  // ยืนยันรหัสผ่านซ้ำ (แยกข้อความ "รหัสผิด" กับ "ลองถี่เกิน" — lib/auth/verify-password.ts)
  const pwErr = await verifyPassword(password, what);
  if (pwErr) return { error: pwErr };

  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, { p_job_id: jobId, p_reason: reason.trim() });
  if (error) {
    return { error: error.message || `${what}ไม่สำเร็จ` };
  }

  revalidatePath("/board");
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/**
 * ลงนามตัดสินคุณภาพ QC/QA (e-signature lite) — ยืนยันรหัสผ่านซ้ำก่อน แล้วบันทึกลายเซ็น
 * + ขยับสถานะผ่าน rpc sign_job_decision() (atomic ใน DB)
 *
 * การยืนยันรหัส = พิสูจน์ว่า "คนหน้าจอ = เจ้าของบัญชี" ตอนตัดสินใจสำคัญ (A3)
 * ทำด้วย verifyPassword() (lib/auth/verify-password.ts) — client แยก ไม่กระทบ session ที่ล็อกอินอยู่
 */
export async function signDecision(
  jobId: string,
  jobNo: string,
  stage: "qc" | "qa",
  decision: "approve" | "reject",
  reason: string | null,
  password: string,
): Promise<ActionResult> {
  if (!password || !password.trim()) {
    return { error: "กรุณากรอกรหัสผ่านเพื่อลงนาม" };
  }

  // ยืนยันรหัสผ่านซ้ำ (แยกข้อความ "รหัสผิด" กับ "ลองถี่เกิน" — lib/auth/verify-password.ts)
  const pwErr = await verifyPassword(password, "ลงนาม");
  if (pwErr) return { error: pwErr };

  // บันทึกลายเซ็น + ขยับสถานะ (session client เดิม → auth.uid() ทำงาน)
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_job_decision", {
    p_job_id: jobId,
    p_stage: stage,
    p_decision: decision,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });
  if (error) {
    return { error: toUiMessage(error.message || "ลงนามไม่สำเร็จ") };
  }

  revalidatePath("/board");
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
