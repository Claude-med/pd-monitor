import type { AppRole } from "@/lib/auth/dal";

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
  {
    href: "/quality",
    label: "ตรวจ QC / QA",
    roles: ["qc", "qa", "manager"],
    ready: false,
  },
  {
    href: "/warehouse",
    label: "คลัง / FG",
    roles: ["warehouse", "manager"],
    ready: false,
  },
  {
    href: "/audit",
    label: "ประวัติ / Audit",
    roles: ["manager", "qa"],
    ready: false,
  },
];

export const ROLE_LABELS: Record<AppRole, string> = {
  production: "ฝ่ายผลิต",
  qc: "QC",
  qa: "QA",
  warehouse: "คลังสินค้า",
  manager: "ผู้บริหาร",
};

export function visibleNav(roles: AppRole[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      item.roles === "all" || item.roles.some((r) => roles.includes(r)),
  );
}
