"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";

/**
 * ทะเบียนสถานะงาน (Part C ก้อน 2 · migration 0053)
 * สิทธิ์ = ทุกฝ่ายที่ล็อกอิน (ทีมยืนยัน) — DB เป็นด่านจริง ที่นี่เช็กเพื่อให้ได้ข้อความไทยสวยๆ
 */

export type SubStatusResult = {
  ok?: boolean;
  id?: string;
  /** จำนวนงานที่ถูก sync ชื่อใหม่ให้ (ตอนแก้ชื่อ) */
  synced?: number;
  message?: string;
  error?: string;
};

export type SubStatusDeleteResult = {
  ok?: boolean;
  action?: "deleted" | "blocked" | "deactivated";
  jobs?: number;
  message?: string;
  error?: string;
};

const NO_AUTH = "ยังไม่ได้เข้าสู่ระบบ";

function revalidate() {
  revalidatePath("/board");
  revalidatePath("/board/new");
}

/** เพิ่ม/แก้สถานะในทะเบียน — แก้ชื่อแล้ว DB จะ sync jobs.sub_status ให้เอง (0053) */
export async function upsertJobSubStatus(
  id: string | null,
  name: string,
  description: string,
  requiresPlanMonth: boolean,
): Promise<SubStatusResult> {
  const profile = await getProfile();
  if (!profile) return { error: NO_AUTH };
  if (!name.trim()) return { error: "กรุณาระบุชื่อสถานะ" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_job_sub_status", {
    p_id: id,
    p_name: name.trim(),
    p_description: description.trim() || null,
    p_requires_plan_month: requiresPlanMonth,
  });
  if (error) return { error: error.message || "บันทึกสถานะไม่สำเร็จ" };

  const res = (data ?? {}) as { id?: string; synced_jobs?: number; message?: string };
  revalidate();
  return {
    ok: true,
    id: res.id,
    synced: res.synced_jobs ?? 0,
    message: res.message ?? "บันทึกแล้ว",
  };
}

/**
 * ลบสถานะออกจากทะเบียน
 * - ไม่ส่ง force: ถ้ามีงานใช้อยู่ DB จะตอบ action:"blocked" พร้อมจำนวน → หน้าจอไปถามยืนยันต่อ
 * - ส่ง force: ปิดใช้งานให้แทนการลบ (งานเก่ายังแสดงชื่อเดิมได้ตามหลัก ALCOA)
 */
export async function deleteJobSubStatus(
  id: string,
  force = false,
): Promise<SubStatusDeleteResult> {
  const profile = await getProfile();
  if (!profile) return { error: NO_AUTH };
  if (!id) return { error: "ไม่พบสถานะที่เลือก" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_job_sub_status", {
    p_id: id,
    p_force: force,
  });
  if (error) return { error: error.message || "ลบสถานะไม่สำเร็จ" };

  const res = (data ?? {}) as { action?: string; jobs?: number; message?: string };

  // ยังไม่ได้ทำอะไร — แค่บอกว่ามีงานใช้อยู่ จึงไม่ revalidate
  if (res.action === "blocked") {
    return {
      ok: true,
      action: "blocked",
      jobs: res.jobs ?? 0,
      message: res.message ?? "มีงานใช้สถานะนี้อยู่",
    };
  }

  revalidate();
  return {
    ok: true,
    action: res.action === "deleted" ? "deleted" : "deactivated",
    jobs: res.jobs ?? 0,
    message: res.message ?? "ทำรายการแล้ว",
  };
}
