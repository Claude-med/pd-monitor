"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ReqResult = { ok?: boolean; error?: string };

/** ขอเบิกวัตถุดิบเข้างาน */
export async function requestMaterial(
  jobNo: string,
  jobId: string,
  materialLotId: string,
  qty: string,
  note: string,
): Promise<ReqResult> {
  if (!materialLotId) return { error: "กรุณาเลือกล็อตวัตถุดิบ" };
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return { error: "จำนวนต้องมากกว่า 0" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_material", {
    p_job_id: jobId,
    p_material_lot_id: materialLotId,
    p_qty: q,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message || "ขอเบิกไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** จ่ายของตามใบเบิก (ตัดสต็อก) — คลัง/ผู้บริหาร */
export async function issueRequisition(
  jobNo: string,
  reqId: string,
): Promise<ReqResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_requisition", { p_id: reqId });
  if (error) return { error: error.message || "จ่ายของไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}

/** ยกเลิกใบเบิก (เฉพาะที่ยังไม่จ่าย) */
export async function cancelRequisition(
  jobNo: string,
  reqId: string,
): Promise<ReqResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_requisition", { p_id: reqId });
  if (error) return { error: error.message || "ยกเลิกไม่สำเร็จ" };
  revalidatePath(`/board/${jobNo}`);
  return { ok: true };
}
