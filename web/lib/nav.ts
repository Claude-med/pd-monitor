import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

export type NavItem = {
  href: string;
  label: string;
  roles: AppRole[] | "all";
  ready: boolean; // false = ยังไม่ทำ (เริ่ม D4+) แสดงป้าย "เร็วๆ นี้"
};

/** เมนูหลัก — กรองตาม role ของผู้ใช้ก่อนแสดง */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "แดชบอร์ด", roles: "all", ready: true },
  { href: "/board", label: "บอร์ดงาน", roles: "all", ready: true },
  { href: "/daily", label: "รายงานประจำวัน", roles: "all", ready: true },
  { href: "/machines", label: "เครื่องจักร", roles: "all", ready: true },
  { href: "/materials", label: "วัตถุดิบ / คลัง", roles: "all", ready: true },
  { href: "/recipes", label: "สูตรการผลิต / BOM", roles: "all", ready: true },
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
    href: "/audit",
    label: "ประวัติ / Audit",
    roles: ["manager", "qa"],
    ready: true,
  },
  {
    href: "/admin/users",
    label: "จัดการผู้ใช้",
    roles: ["manager"],
    ready: true,
  },
];

/** ลำดับ role ทั้งหมด (ใช้ในหน้า admin จัดการผู้ใช้) */
export const ALL_ROLES: AppRole[] = [
  "production",
  "qc",
  "qa",
  "warehouse",
  "manager",
  "admin",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  production: "ฝ่ายผลิต",
  qc: "QC",
  qa: "QA",
  warehouse: "คลังสินค้า",
  manager: "ผู้บริหาร",
  admin: "ผู้ดูแลระบบ (Admin)",
};

export function visibleNav(roles: AppRole[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.roles === "all" || hasAnyRole(roles, item.roles),
  );
}
