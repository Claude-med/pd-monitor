import { createClient } from "@/lib/supabase/server";

export type ApprovalRow = {
  id: string;
  stage: "qc" | "qa";
  decision: "approve" | "reject";
  reason: string | null;
  signed_at: string;
  signer_name: string | null;
};

const SELECT = `
  id, stage, decision, reason, signed_at,
  signer:profiles!profile_id ( full_name )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function shape(r: any): ApprovalRow {
  const s = Array.isArray(r.signer) ? r.signer[0] : r.signer;
  return {
    id: r.id,
    stage: r.stage,
    decision: r.decision,
    reason: r.reason,
    signed_at: r.signed_at,
    signer_name: s?.full_name ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** ลายเซ็นอนุมัติ/ตีกลับของงานหนึ่ง (ใหม่ล่าสุดอยู่บน) */
export async function getApprovalsForJob(jobId: string): Promise<ApprovalRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("approvals")
    .select(SELECT)
    .eq("job_id", jobId)
    .order("signed_at", { ascending: false });
  return (data ?? []).map(shape);
}
