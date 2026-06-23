import { createClient } from "@/lib/supabase/server";

export type LineClearance = {
  cleared_old: boolean;
  cleaned: boolean;
  setup_done: boolean;
  setup_minutes: number | null;
  note: string | null;
  performed_by_id: string | null;
  performed_by_name: string | null;
  performed_at: string | null;
  checked_by_id: string | null;
  checked_by_name: string | null;
  checked_at: string | null;
  passed: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function first(x: any): any {
  return Array.isArray(x) ? x[0] : x;
}

/** Line clearance ของงานหนึ่ง (null ถ้ายังไม่เคยบันทึก) */
export async function getLineClearance(
  jobId: string,
): Promise<LineClearance | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("line_clearances")
    .select(
      `cleared_old, cleaned, setup_done, setup_minutes, note,
       performed_by, performed_at, checked_by, checked_at,
       performer:profiles!performed_by ( full_name ),
       checker:profiles!checked_by ( full_name )`,
    )
    .eq("job_id", jobId)
    .maybeSingle();

  if (!data) return null;
  const d = data as any;
  const performer = first(d.performer);
  const checker = first(d.checker);
  return {
    cleared_old: d.cleared_old,
    cleaned: d.cleaned,
    setup_done: d.setup_done,
    setup_minutes: d.setup_minutes,
    note: d.note,
    performed_by_id: d.performed_by ?? null,
    performed_by_name: performer?.full_name ?? null,
    performed_at: d.performed_at,
    checked_by_id: d.checked_by ?? null,
    checked_by_name: checker?.full_name ?? null,
    checked_at: d.checked_at,
    passed:
      !!d.checked_by && d.cleared_old && d.cleaned && d.setup_done,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
