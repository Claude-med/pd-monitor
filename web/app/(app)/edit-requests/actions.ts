"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

export type ActionResult = { ok?: boolean; error?: string };

/** อนุมัติ (→ แก้จริง) / ปฏิเสธ คำขอแก้ไข — manager/admin เสมอ · qa เฉพาะ QC */
export async function reviewEditRequest(
  id: string,
  decision: "approve" | "reject",
  note: string,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile || !hasAnyRole(profile.roles, ["manager", "qa"]))
    return { error: "ไม่มีสิทธิ์อนุมัติคำขอแก้ไข" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_edit_request", {
    p_id: id,
    p_decision: decision,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message || "ดำเนินการไม่สำเร็จ" };
  revalidatePath("/edit-requests");
  return { ok: true };
}
