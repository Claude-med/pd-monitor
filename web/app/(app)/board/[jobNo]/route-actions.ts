"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { canPlanJobs } from "@/lib/data/role-access";

export type SyncRouteResult = { ok?: boolean; count?: number; error?: string };

/**
 * เติมขั้นตอนการผลิตย้อนหลังให้งานที่ job_routes ว่าง (migration 0045)
 * — เกิดกับงานที่สร้างตอนผลิตภัณฑ์ยังไม่ได้ตั้ง route
 * — DB เป็นด่านจริง: ทำได้เฉพาะงานที่ route ว่าง + ยังไม่พ้น in_production
 */
export async function syncJobRoute(
  jobNo: string,
  jobId: string,
): Promise<SyncRouteResult> {
  const profile = await getProfile();
  if (!profile || !canPlanJobs(profile.roles))
    return { error: "ไม่มีสิทธิ์ (เฉพาะฝ่ายวางแผน/ผู้บริหาร)" };
  if (!jobId) return { error: "ไม่พบงาน" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sync_job_route", { p_job_id: jobId });
  if (error) return { error: error.message || "เติมขั้นตอนการผลิตไม่สำเร็จ" };

  revalidatePath(`/board/${jobNo}`);
  return { ok: true, count: Number(data ?? 0) };
}
