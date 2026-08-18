"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { canPlanJobs } from "@/lib/data/role-access";

/**
 * จัดการทะเบียนลูกค้า (Part 3 ก้อน 1)
 * แยกไฟล์จาก actions.ts เพราะก้อน 2 จะรื้อ actions.ts ทั้งไฟล์ (เปลี่ยน RPC สร้างงาน)
 */

export type CustomerResult = { ok?: boolean; id?: string; error?: string };

/** ผลของปุ่มลบ — DB บอกกลับมาว่าลบได้เลย / ติดงานอยู่ / ย้ายแล้วลบให้ */
export type CustomerDeleteResult = {
  ok?: boolean;
  action?: "deleted" | "blocked" | "reassigned_deleted";
  orders?: number;
  jobs?: number;
  moved?: number;
  message?: string;
  error?: string;
};

/** จัดการทะเบียนลูกค้า = วางแผน/ผู้บริหาร (ตรงกับ can_plan_jobs() ใน DB — 0039/0047) */
async function requirePlanner(): Promise<boolean> {
  const profile = await getProfile();
  return !!profile && canPlanJobs(profile.roles);
}

const NO_PERM = "ไม่มีสิทธิ์ (เฉพาะฝ่ายวางแผน/ผู้บริหาร)";

function revalidate() {
  revalidatePath("/board/new");
  revalidatePath("/board");
}

/** เพิ่ม/แก้ชื่อลูกค้า — แก้ชื่อแล้ว DB จะ sync ชื่อในใบสั่งผลิตให้เอง (0047) */
export async function upsertCustomer(
  id: string | null,
  name: string,
): Promise<CustomerResult> {
  if (!(await requirePlanner())) return { error: NO_PERM };
  if (!name.trim()) return { error: "กรุณาระบุชื่อลูกค้า" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_customer", {
    p_id: id,
    p_name: name.trim(),
  });
  if (error) return { error: error.message || "บันทึกลูกค้าไม่สำเร็จ" };

  revalidate();
  return { ok: true, id: data as string };
}

/**
 * ลบลูกค้า
 * - ไม่ส่ง reassignTo: ถ้ามีงานผูกอยู่ DB จะตอบ action:"blocked" พร้อมจำนวน → หน้าจอไปถามผู้ใช้ต่อ
 * - ส่ง reassignTo: ย้ายใบสั่งผลิตทั้งหมดไปลูกค้าใหม่แล้วลบ (ทรานแซกชันเดียว)
 */
export async function deleteCustomer(
  id: string,
  reassignTo?: string | null,
): Promise<CustomerDeleteResult> {
  if (!(await requirePlanner())) return { error: NO_PERM };
  if (!id) return { error: "ไม่พบลูกค้าที่เลือก" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_customer", {
    p_id: id,
    p_reassign_to: reassignTo || null,
  });
  if (error) return { error: error.message || "ลบลูกค้าไม่สำเร็จ" };

  const res = (data ?? {}) as {
    action?: string;
    orders?: number;
    jobs?: number;
    moved?: number;
    message?: string;
  };

  // ยังไม่ได้ลบ — แค่บอกว่าติดงานอยู่ จึงไม่ revalidate
  if (res.action === "blocked") {
    return {
      ok: true,
      action: "blocked",
      orders: res.orders ?? 0,
      jobs: res.jobs ?? 0,
      message: res.message ?? "ลบไม่ได้ — ยังมีงานผูกอยู่",
    };
  }

  revalidate();
  return {
    ok: true,
    action: res.action === "deleted" ? "deleted" : "reassigned_deleted",
    moved: res.moved ?? 0,
    message: res.message ?? "ทำรายการแล้ว",
  };
}
