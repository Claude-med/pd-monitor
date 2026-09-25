import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import {
  canApproveInprocess,
  canApproveProductionRecord,
  canCheckLineClearance,
} from "@/lib/data/role-access";
import type { PendingFocus } from "@/lib/data/notification-constants";
import type { ApprovalItem } from "@/lib/data/pending-approvals-constants";

export {
  APPROVER_ROLES,
  APPROVAL_GROUP_LABEL,
  type ApprovalItem,
} from "@/lib/data/pending-approvals-constants";

// Part H — หน้า "รออนุมัติของฉัน" (/approvals)
//   รวมของที่ "ผู้ดูคนนี้กดอนุมัติได้จริง" จากทุกงานทุกสถานีไว้ที่เดียว
//   การอนุมัติจริงยังทำที่หน้างาน (ปุ่มเดิม) — หน้านี้เป็นทางลัดพาไปตรงจุด
//   กติกาต้องตรงกับปุ่มอนุมัติในหน้างาน: ยัง pending + ไม่ใช่รายการของตัวเอง (สองลายเซ็น · GMP)

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function hrefOf(jobNo: string, focus: PendingFocus, stepId: string | null): string {
  const q = stepId ? `?step=${stepId}&pending=${focus}` : `?pending=${focus}`;
  return `/board/${encodeURIComponent(jobNo)}${q}#${focus}`;
}

const notMine = (col: string, me: string) => `${col}.is.null,${col}.neq.${me}`;

export async function getMyApprovals(profile: Profile): Promise<ApprovalItem[]> {
  const roles = profile.roles;
  const me = profile.id;
  const supabase = await createClient();
  const tasks: Promise<ApprovalItem[]>[] = [];

  if (canApproveProductionRecord(roles)) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("production_records")
          .select(
            `id, job_route_id, record_date, output_qty, output_unit,
             operator:profiles!operator_id ( full_name ),
             station:stations!station_id ( name ),
             jobs ( job_no )`,
          )
          .eq("status", "pending")
          .neq("created_by", me)
          .or(notMine("operator_id", me))
          .order("record_date", { ascending: true });
        return ((data ?? []) as any[]).flatMap((r) => {
          const jobNo = one<any>(r.jobs)?.job_no;
          if (!jobNo) return [];
          return [
            {
              id: r.id,
              focus: "records" as const,
              jobNo,
              station: one<any>(r.station)?.name ?? null,
              when: r.record_date,
              summary: `ผลิตได้ ${Number(r.output_qty ?? 0).toLocaleString("th-TH")}${
                r.output_unit ? " " + r.output_unit : ""
              }`,
              by: one<any>(r.operator)?.full_name ?? null,
              href: hrefOf(jobNo, "records", r.job_route_id),
            },
          ];
        });
      })(),
    );
  }

  if (canCheckLineClearance(roles)) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("line_clearances")
          .select(
            `id, job_route_id, performed_at,
             performer:profiles!performed_by ( full_name ),
             machine:machines!machine_id ( code ),
             route:job_routes!job_route_id ( station:stations!station_id ( name ), jobs ( job_no ) )`,
          )
          .not("performed_at", "is", null)
          .is("checked_at", null)
          .or(notMine("performed_by", me))
          .order("performed_at", { ascending: true });
        return ((data ?? []) as any[]).flatMap((r) => {
          const route = one<any>(r.route);
          const jobNo = one<any>(route?.jobs)?.job_no;
          if (!jobNo) return [];
          return [
            {
              id: r.id,
              focus: "lc" as const,
              jobNo,
              station: one<any>(route?.station)?.name ?? null,
              when: r.performed_at,
              summary: `เครื่อง ${one<any>(r.machine)?.code ?? "—"} — รอหัวหน้ายืนยัน`,
              by: one<any>(r.performer)?.full_name ?? null,
              href: hrefOf(jobNo, "lc", r.job_route_id),
            },
          ];
        });
      })(),
    );
  }

  if (canApproveInprocess(roles)) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("inprocess_checks")
          .select(
            `id, job_route_id, param, value, unit, result, checked_at,
             checker:profiles!checked_by ( full_name ),
             station:stations!station_id ( name ),
             jobs ( job_no )`,
          )
          .eq("status", "pending")
          .or(notMine("checked_by", me))
          .order("checked_at", { ascending: true });
        return ((data ?? []) as any[]).flatMap((r) => {
          const jobNo = one<any>(r.jobs)?.job_no;
          if (!jobNo) return [];
          return [
            {
              id: r.id,
              focus: "inprocess" as const,
              jobNo,
              station: one<any>(r.station)?.name ?? null,
              when: r.checked_at,
              summary: `${r.param ?? ""}${r.value ? ` = ${r.value}${r.unit ? " " + r.unit : ""}` : ""} · เสนอ: ${
                r.result === "fail" ? "ไม่ผ่าน" : "ผ่าน"
              }`,
              by: one<any>(r.checker)?.full_name ?? null,
              href: hrefOf(jobNo, "inprocess", r.job_route_id),
            },
          ];
        });
      })(),
    );
  }

  // จุดเก็บตัวอย่าง: หัวหน้า QA เท่านั้น (ผู้บริหารไม่ผ่าน — ตรงกับ review_qa_sample 0096)
  if (hasAnyRole(roles, ["qa_lead"])) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from("qa_samples")
          .select(
            `id, result, collected_at,
             collector:profiles!collected_by ( full_name ),
             jobs ( job_no )`,
          )
          .eq("review_status", "pending")
          .is("deleted_at", null)
          .order("collected_at", { ascending: true });
        return ((data ?? []) as any[]).flatMap((r) => {
          const jobNo = one<any>(r.jobs)?.job_no;
          if (!jobNo) return [];
          return [
            {
              id: r.id,
              focus: "qa-sample" as const,
              jobNo,
              station: null,
              when: r.collected_at,
              summary: `ผลที่เสนอ: ${
                r.result === "fail" ? "ไม่ผ่าน" : r.result === "pass" ? "ผ่าน" : "ยังไม่ลงผล"
              }`,
              by: one<any>(r.collector)?.full_name ?? null,
              href: hrefOf(jobNo, "qa-sample", null),
            },
          ];
        });
      })(),
    );
  }

  return (await Promise.all(tasks)).flat();
}
/* eslint-enable @typescript-eslint/no-explicit-any */
