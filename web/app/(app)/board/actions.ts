"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/dal";

export type ActionResult = { ok?: boolean; error?: string };

/**
 * เปลี่ยนสถานะงาน — เรียกฟังก์ชัน advance_job_status() ใน DB
 * (DB เป็นด่านบังคับลำดับ/สิทธิ์/เหตุผลจริง · ที่นี่แค่ส่งต่อ + แสดง error)
 */
export async function changeStatus(
  jobId: string,
  jobNo: string,
  toStatus: string,
  reason: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_job_status", {
    p_job_id: jobId,
    p_to: toStatus,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });

  if (error) {
    return { error: error.message || "ทำรายการไม่สำเร็จ" };
  }

  revalidatePath("/board");
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/**
 * ลบงาน (ข้อ 2) — เฉพาะผู้บริหาร/ผู้ดูแล + ยืนยันรหัสผ่านซ้ำ (กันลบผิดงาน)
 * DB (delete_job) เป็นด่านบังคับสิทธิ์จริง + ลบตารางลูก cascade + audit
 * การยืนยันรหัส = พิสูจน์ว่า "คนหน้าจอ = เจ้าของบัญชี" (แพตเทิร์นเดียวกับ signDecision)
 */
export async function deleteJob(
  jobId: string,
  jobNo: string,
  password: string,
): Promise<ActionResult> {
  if (!password || !password.trim()) {
    return { error: "กรุณากรอกรหัสผ่านเพื่อยืนยันการลบ" };
  }

  const user = await getUser();
  if (!user?.email) {
    return { error: "ยังไม่ได้เข้าสู่ระบบ" };
  }

  // ยืนยันรหัสผ่านซ้ำด้วย client แยก (ไม่แตะ cookie/session ปัจจุบัน)
  const verifier = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error: authError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (authError) {
    return { error: "รหัสผ่านไม่ถูกต้อง — ลบงานไม่สำเร็จ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_job", { p_job_id: jobId });
  if (error) {
    return { error: error.message || "ลบงานไม่สำเร็จ" };
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
 * ทำด้วย verifier client แยก (publishable key, ไม่เก็บ session) → ไม่กระทบ session ที่ล็อกอินอยู่
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

  const user = await getUser();
  if (!user?.email) {
    return { error: "ยังไม่ได้เข้าสู่ระบบ" };
  }

  // ยืนยันรหัสผ่านซ้ำด้วย client แยก (ไม่แตะ cookie/session ปัจจุบัน)
  const verifier = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error: authError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (authError) {
    return { error: "รหัสผ่านไม่ถูกต้อง — ลงนามไม่สำเร็จ" };
  }

  // บันทึกลายเซ็น + ขยับสถานะ (session client เดิม → auth.uid() ทำงาน)
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_job_decision", {
    p_job_id: jobId,
    p_stage: stage,
    p_decision: decision,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });
  if (error) {
    return { error: error.message || "ลงนามไม่สำเร็จ" };
  }

  revalidatePath("/board");
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
