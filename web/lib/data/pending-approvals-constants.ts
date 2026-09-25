// Part H — ค่าคงที่ของหน้า "รออนุมัติของฉัน" (ไม่มี server import — client/nav import ได้)

import type { AppRole } from "@/lib/auth/dal";
import type { PendingFocus } from "@/lib/data/notification-constants";

/** role ที่เห็นเมนู "⏳ รออนุมัติ" (หัวหน้าที่มีงานอนุมัติ + ผู้บริหาร · admin ผ่าน hasAnyRole เอง) */
export const APPROVER_ROLES: AppRole[] = [
  "production_lead",
  "qc_lead",
  "qa_lead",
  "manager",
];

export type ApprovalItem = {
  id: string;
  focus: PendingFocus;
  jobNo: string;
  station: string | null;
  when: string | null;
  summary: string;
  by: string | null;
  href: string;
};

export const APPROVAL_GROUP_LABEL: Record<PendingFocus, string> = {
  records: "บันทึกผลผลิตรายวัน",
  lc: "Line Clearance",
  inprocess: "ผลตรวจ QC ระหว่างผลิต (in-process)",
  "qa-sample": "จุดเก็บตัวอย่าง (ตรวจ Finished product)",
};

