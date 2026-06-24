import { createClient } from "@/lib/supabase/server";

/** ลายเซ็นอนุมัติ/ตีกลับล่าสุดทั้งระบบ (สำหรับหน้า ตรวจ QC/QA) */
export type RecentApproval = {
  id: string;
  job_no: string | null;
  stage: "qc" | "qa";
  decision: "approve" | "reject";
  reason: string | null;
  signed_at: string;
  signer_name: string | null;
};

const SELECT = `
  id, stage, decision, reason, signed_at,
  signer:profiles!profile_id ( full_name ),
  jobs:job_id ( job_no )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function shape(r: any): RecentApproval {
  const s = Array.isArray(r.signer) ? r.signer[0] : r.signer;
  const j = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
  return {
    id: r.id,
    job_no: j?.job_no ?? null,
    stage: r.stage,
    decision: r.decision,
    reason: r.reason,
    signed_at: r.signed_at,
    signer_name: s?.full_name ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** ลายเซ็นล่าสุดทั้งระบบ (ใหม่สุดอยู่บน) */
export async function getRecentApprovals(
  limit = 30,
): Promise<RecentApproval[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("approvals")
    .select(SELECT)
    .order("signed_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(shape);
}
