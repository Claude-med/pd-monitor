import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

/**
 * แหล่งความจริงเดียวของ "สิทธิ์แต่ละ role" ฝั่งแอป (Part A)
 * — ไม่มี server import → ใช้ได้ทั้ง Server และ Client Components
 *
 * ⚠️ helper ด้านล่างต้อง "ตรงกับ guard ใน DB" เสมอ (migration 0039):
 *      canPlanJobs()          ↔ public.can_plan_jobs()
 *      canManageMachines()    ↔ public.can_manage_machines()
 *      canSetMachineSchedule()↔ public.can_set_machine_schedule()
 *    DB เป็นด่านบังคับจริง · ฝั่งแอปใช้ตัดสินว่าจะ "แสดงปุ่ม/ช่องกรอก" ไหน
 *    (canSeeCost เป็นการอ่านล้วน — คุมที่แอปอย่างเดียว ไม่มี guard ใน DB)
 */

export type RoleAccess = {
  /** ตัวย่อที่ทีมใช้เรียก (PLN / COST / ENG …) */
  code: string;
  /** หน้าที่หลักหนึ่งบรรทัด */
  duty: string;
  /** สิ่งที่ "บันทึก/แก้ไข" ได้ */
  manage: string[];
  /** สิ่งที่เห็นเพิ่มจากหน้าพื้นฐาน (ดูอย่างเดียว) */
  view: string[];
};

/** หน้าที่ทุก role ที่ล็อกอินเห็นได้เหมือนกัน (ดูอย่างเดียว) */
export const COMMON_VIEW =
  "แดชบอร์ด · บอร์ดงาน · รายงานประจำวัน · เครื่องจักร · ผลิตภัณฑ์คลัง · ผลิตภัณฑ์/ขั้นตอนการผลิต · แจ้งเตือน";

export const ROLE_ACCESS: Record<AppRole, RoleAccess> = {
  planner: {
    code: "PLN",
    duty: "วางแผนการผลิต — เปิดงานเข้าระบบ",
    manage: [
      "สร้างงานผลิตใหม่ (ออเดอร์ + งาน + ล็อต)",
      "เพิ่ม/แก้/ปิดใช้งานผลิตภัณฑ์ (ยา · วัตถุดิบ · บรรจุภัณฑ์)",
      "ยืนยันแผนผลิต (รอแจ้งผลิต → มีแผนแล้ว)",
    ],
    view: ["ความคืบหน้าทุกงานบนบอร์ด"],
  },
  production: {
    code: "PROD",
    duty: "ผลิตจริงหน้างาน — บันทึกผลผลิตรายวัน",
    manage: [
      "ทำ Line Clearance (ผู้ปฏิบัติ) → เริ่มผลิต",
      "บันทึกผลผลิตรายสถานี (เข้า/ออก/ของเสีย/ชั่วโมง/จำนวนคน)",
      "ขอเบิกผลิตภัณฑ์ (วัตถุดิบ/บรรจุภัณฑ์) · ส่งตรวจ QC",
      "เพิ่ม/แก้ทะเบียนเครื่องจักร (ยกเว้นกำหนดซ่อม/สอบเทียบ)",
      "เปิด deviation · ขออนุมัติแก้ไขย้อนหลัง",
    ],
    view: [],
  },
  qc: {
    code: "QC",
    duty: "ตรวจคุณภาพระหว่างผลิต + ตัดสิน QC",
    manage: [
      "บันทึกผลตรวจ in-process QC รายสถานี",
      "QC ผ่าน → ส่ง QA · QC ตีกลับ (ต้องลงนาม)",
      "เปิด deviation · ขอแก้ไขข้อมูล QC",
    ],
    view: ["หน้าตรวจ QC / QA"],
  },
  qa: {
    code: "QA",
    duty: "ปล่อยผ่านล็อต + ดูแลเอกสารคุณภาพ",
    manage: [
      "บันทึกจุดเก็บตัวอย่าง (QA sample)",
      "QA ปล่อยผ่าน → FG · QA ตีกลับ (ต้องลงนาม)",
      "ปิด deviation (ต้องมี root cause + CAPA)",
      "อนุมัติ/ปฏิเสธคำขอแก้ไขข้อมูล QC",
    ],
    view: ["ประวัติ / Audit", "ไล่ย้อนล็อต (Trace)", "คำขอแก้ไข (Amendment)"],
  },
  warehouse: {
    code: "WH",
    duty: "คลังผลิตภัณฑ์ + รับสินค้าสำเร็จรูปเข้าคลัง",
    manage: [
      "ล็อต/สต็อกของผลิตภัณฑ์ทุกประเภท (ยา · RM · PM)",
      "จ่ายของตามใบเบิก (ตัดสต็อก)",
      "รับ FG เข้าคลัง",
    ],
    view: ["คลัง / FG", "ไล่ย้อนล็อต (Trace)"],
  },
  engineering: {
    code: "ENG",
    duty: "ดูแลเครื่องจักร — ซ่อมบำรุง / สอบเทียบ",
    manage: [
      "เพิ่ม/แก้ทะเบียนเครื่องจักร (รวมห้อง/สถานะ)",
      "กำหนดวันซ่อมบำรุง + วันสอบเทียบครั้งหน้า",
      "บันทึกหมายเหตุ deviation ในนามฝ่ายวิศวกรรม",
    ],
    view: ["รายงานการใช้เครื่อง"],
  },
  cost: {
    code: "COST",
    duty: "บัญชีต้นทุน — ดูต้นทุนค่าแรงทางตรง",
    manage: ["ปรับอัตราค่าแรง (฿/ชม.) ที่ใช้คำนวณบนแดชบอร์ด"],
    view: [
      "ต้นทุนค่าแรงทางตรง (DL cost) รวม + แยกรายสถานี",
      "คน-ชั่วโมงและชั่วโมงทำงานตามช่วงวันที่",
    ],
  },
  manager: {
    code: "MGR",
    duty: "ผู้บริหาร — ดูภาพรวมและอนุมัติทุกขั้น",
    manage: [
      "ทำได้ทุกขั้นของงานผลิต (สร้างงาน/ยืนยันแผน/เครื่องจักร/ผลิตภัณฑ์)",
      "จัดการผู้ใช้ + กำหนดสิทธิ์ · รีเซ็ตรหัสผ่าน · ระงับบัญชี",
      "สถานีการผลิต (master) + ขั้นตอนการผลิต (route) ของแต่ละผลิตภัณฑ์",
      "อนุมัติคำขอแก้ไขย้อนหลังทุกชนิด · ลบงาน",
    ],
    view: ["ประวัติ / Audit", "ต้นทุนค่าแรง", "ไล่ย้อนล็อต (Trace)"],
  },
  admin: {
    code: "ADM",
    duty: "ผู้ดูแลระบบ — ผ่านทุกสิทธิ์",
    manage: ["ทำได้ทุกอย่างของทุกฝ่ายรวมกัน (has_role ผ่านทุกข้อ)"],
    view: ["ทุกหน้าในระบบ"],
  },
};

/** สร้างงานผลิต / เพิ่มยา / ยืนยันแผนผลิต — ตรงกับ can_plan_jobs() ใน DB */
export function canPlanJobs(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["planner", "manager"]);
}

/** เพิ่ม/แก้ทะเบียนเครื่องจักร — ตรงกับ can_manage_machines() ใน DB */
export function canManageMachines(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["production", "engineering", "manager"]);
}

/** ตั้งกำหนดซ่อมบำรุง/สอบเทียบ — ตรงกับ can_set_machine_schedule() ใน DB */
export function canSetMachineSchedule(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["engineering", "manager"]);
}

/** เห็นบล็อกต้นทุนค่าแรง + ปรับอัตรา ฿/ชม. บนแดชบอร์ด (อ่านล้วน — คุมที่แอป) */
export function canSeeCost(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["cost", "manager"]);
}
