import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { EDIT_REVIEWER_ROLES } from "@/lib/data/edit-request-constants";

export type NavItem = {
  href: string;
  label: string;
  roles: AppRole[] | "all";
  ready: boolean; // false = ยังไม่ทำ (เริ่ม D4+) แสดงป้าย "เร็วๆ นี้"
};

/** role ที่เข้าหน้า "จัดการผู้ใช้" ได้ — ผู้บริหาร + หัวหน้าแผนกทุกฝ่าย (Part E)
 *  ⚠️ hasAnyRole ให้ admin ผ่านเสมออยู่แล้ว จึงไม่ต้องใส่ admin ที่นี่ */
export const USER_ADMIN_ROLES: AppRole[] = [
  "manager",
  "planner_lead",
  "production_lead",
  "qc_lead",
  "qa_lead",
  "warehouse_lead",
  "engineering_lead",
];

/** เมนูหลัก — กรองตาม role ของผู้ใช้ก่อนแสดง */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "แดชบอร์ด", roles: "all", ready: true },
  { href: "/inbox", label: "🔔 แจ้งเตือน", roles: "all", ready: true },
  { href: "/board", label: "บอร์ดงาน", roles: "all", ready: true },
  { href: "/daily", label: "รายงานประจำวัน", roles: "all", ready: true },
  { href: "/machines", label: "เครื่องจักร", roles: "all", ready: true },
  { href: "/materials", label: "ผลิตภัณฑ์คลัง", roles: "all", ready: true },
  {
    // Part C.2 — ฝ่ายคลังกดสถานะความพร้อมข้ามงานได้จากที่เดียว
    // (เพิ่ม/แก้/ลบรายการยังทำที่หน้างานที่เดียว ไม่ทำ 2 ทางเข้า)
    href: "/job-materials",
    label: "เบิกวัตถุดิบ / บรรจุภัณฑ์",
    roles: ["warehouse", "production", "manager"],
    ready: true,
  },
  {
    href: "/recipes",
    label: "ผลิตภัณฑ์ / ขั้นตอนการผลิต",
    roles: "all",
    ready: true,
  },
  {
    href: "/quality",
    label: "ตรวจ QC / QA",
    roles: ["qc", "qa", "manager"],
    ready: true,
  },
  {
    href: "/warehouse",
    label: "คลัง / FG",
    roles: ["warehouse", "manager"],
    ready: true,
  },
  {
    href: "/trace",
    label: "ไล่ย้อนล็อต (Trace)",
    roles: ["qa", "warehouse", "manager"],
    ready: true,
  },
  {
    href: "/edit-requests",
    label: "คำขอแก้ไข (Amendment)",
    // ⚠️ ใช้ค่ากลางจาก edit-request-constants — ห้ามก็อปรายชื่อ role มาไว้ที่นี่ซ้ำ
    //    (เดิม hardcode ["manager","qa","qc_lead"] ไว้ พอ reviewer เปลี่ยนแล้วเมนูไม่ตาม)
    roles: EDIT_REVIEWER_ROLES,
    ready: true,
  },
  {
    href: "/audit",
    label: "ประวัติ / Audit",
    roles: ["manager", "qa"],
    ready: true,
  },
  {
    // ผู้บริหารเห็นทุกคน · หัวหน้าแผนกเห็นเฉพาะลูกน้องในฝ่ายตัวเอง (Part E)
    href: "/admin/users",
    label: "จัดการผู้ใช้",
    roles: USER_ADMIN_ROLES,
    ready: true,
  },
  {
    href: "/admin/companies",
    label: "บริษัท / เลขงาน",
    roles: ["manager"],
    ready: true,
  },
];

/** ลำดับ role ทั้งหมด (ใช้ในหน้า admin จัดการผู้ใช้) — ตรงกับ enum app_role ใน DB (15 ค่า)
 *  ⚠️ นี่คือ "รายชื่อ role เดียวของทั้งระบบ" ฝั่งแอป — เพิ่ม role ใหม่ต้องเติมที่นี่ที่เดียว
 *     ห้ามก็อปรายชื่อไปไว้ที่อื่น (บทเรียนบั๊ก VALID_ROLES จาก Part A) */
export const ALL_ROLES: AppRole[] = [
  "planner",
  "planner_lead",
  "production",
  "production_lead",
  "qc",
  "qc_lead",
  "qa",
  "qa_lead",
  "warehouse",
  "warehouse_lead",
  "engineering",
  "engineering_lead",
  "cost",
  "manager",
  "admin",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  planner: "ฝ่ายวางแผน (PLN)",
  planner_lead: "หัวหน้าฝ่ายวางแผน",
  production: "ฝ่ายผลิต",
  production_lead: "หัวหน้าฝ่ายผลิต",
  qc: "QC",
  qc_lead: "หัวหน้า QC",
  qa: "QA",
  qa_lead: "หัวหน้า QA",
  warehouse: "คลังสินค้า",
  warehouse_lead: "หัวหน้าคลังสินค้า",
  engineering: "วิศวกรรม (ENG)",
  engineering_lead: "หัวหน้าฝ่ายวิศวกรรม",
  cost: "บัญชีต้นทุน (COST)",
  manager: "ผู้บริหาร",
  admin: "ผู้ดูแลระบบ (Admin)",
};

export function visibleNav(roles: AppRole[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.roles === "all" || hasAnyRole(roles, item.roles),
  );
}
