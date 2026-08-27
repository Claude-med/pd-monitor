"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { canEditJobRouteMachines } from "@/lib/data/role-access";

/**
 * Server actions — ผูก/ถอดเครื่องจักรกับขั้นตอนการผลิตของงาน (Part C.3 ก้อน 3)
 *
 * ⚠️ การเช็คสิทธิ์ที่นี่เป็นแค่ด่านแรก (กันยิงเปล่า) — ด่านจริงอยู่ที่ RPC
 *    add_job_route_machine / remove_job_route_machine ซึ่งเช็ก can_edit_job_route_machines()
 *    และบังคับว่าเครื่องต้องอยู่สถานีเดียวกับขั้นตอนอีกชั้น
 */

export type RouteMachineResult = { ok?: boolean; id?: string; error?: string };

const DENIED = "ไม่มีสิทธิ์ (เฉพาะฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหาร)";

export async function addRouteMachine(
  jobNo: string,
  jobRouteId: string,
  machineId: string,
): Promise<RouteMachineResult> {
  const profile = await getProfile();
  if (!profile || !canEditJobRouteMachines(profile.roles))
    return { error: DENIED };
  if (!jobRouteId) return { error: "ไม่พบขั้นตอนการผลิตที่เลือก" };
  if (!machineId) return { error: "กรุณาเลือกเครื่องจักร" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_job_route_machine", {
    p_job_route_id: jobRouteId,
    p_machine_id: machineId,
    p_note: null,
  });
  if (error) return { error: error.message || "เลือกเครื่องจักรไม่สำเร็จ" };

  revalidatePath(`/board/${jobNo}`);
  return { ok: true, id: data as string };
}

export async function removeRouteMachine(
  jobNo: string,
  id: string,
): Promise<RouteMachineResult> {
  const profile = await getProfile();
  if (!profile || !canEditJobRouteMachines(profile.roles))
    return { error: DENIED };
  if (!id) return { error: "ไม่พบรายการเครื่องจักรที่เลือก" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_job_route_machine", {
    p_id: id,
  });
  if (error) return { error: error.message || "ถอดเครื่องจักรไม่สำเร็จ" };

  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
