import type { AppRole } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";

/**
 * แหล่งความจริงเดียวของ "สิทธิ์แต่ละ role" ฝั่งแอป (Part A)
 * — ไม่มี server import → ใช้ได้ทั้ง Server และ Client Components
 *
 * ⚠️ helper ด้านล่างต้อง "ตรงกับ guard ใน DB" เสมอ (migration 0039 · 0044 · 0046 · 0049):
 *      canPlanJobs()          ↔ public.can_plan_jobs()
 *      canManageProducts()    ↔ public.can_manage_products()
 *      canManageMachines()    ↔ public.can_manage_machines()
 *      canSetLotStatus()      ↔ public.can_set_lot_status()
 *      canSetJobLot()         ↔ public.can_set_job_lot()
 *      canSetMachineSchedule()↔ public.can_set_machine_schedule()
 *      canEditJobPlanFields()      ↔ can_plan_jobs()      (ใช้ใน update_job_details · 0054)
 *      canEditJobProductionFields()↔ can_set_job_lot()    (ใช้ใน update_job_details · 0054)
 *      canManageJobSubStatuses()   ↔ แค่ล็อกอิน            (ทะเบียนสถานะงาน · 0053)
 *      canEditJobMaterials()       ↔ public.can_edit_job_materials()      (0056)
 *      canSetJobMaterialStatus()   ↔ public.can_set_job_material_status() (0056)
 *      canEditJobRouteMachines()   ↔ public.can_edit_job_route_machines() (0061)
 *      canPerformLineClearance()   ↔ public.can_perform_line_clearance()  (0062)
 *      canCheckLineClearance()     ↔ public.can_check_line_clearance()    (0062)
 *      canRecordInprocess()        ↔ public.can_record_inprocess()        (0064)
 *      canApproveInprocess()       ↔ public.can_approve_inprocess()       (0064)
 *      canRecordQaSample()         ↔ public.can_record_qa_sample()        (0066)
 *      canReviewIncident()         ↔ public.can_review_incident()         (0067)
 *      canOpenDeviation()          ↔ แค่ล็อกอิน (ทุกฝ่ายเปิด Incident Case ได้ · 0067)
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
      "สร้างงานผลิตใหม่ทีละหลายใบ (ออเดอร์ + งาน · เลขล็อตเป็นของฝ่ายผลิต)",
      "เพิ่ม/แก้/ลบผลิตภัณฑ์ในทะเบียน",
      "ตั้งสถานะล็อตในคลัง (พร้อมใช้ / ไม่พร้อมใช้)",
      "ยืนยันแผนผลิต (รอแจ้งผลิต → มีแผนแล้ว)",
    ],
    view: ["ความคืบหน้าทุกงานบนบอร์ด"],
  },
  production: {
    code: "PROD",
    duty: "ผลิตจริงหน้างาน — บันทึกผลผลิตรายวัน",
    manage: [
      "กรอก LOT No. ให้งาน (ก่อนเริ่มผลิต)",
      "ทำ Line Clearance (ผู้ปฏิบัติ) → เริ่มผลิต",
      "บันทึกผลผลิตรายสถานี (เข้า/ออก/ของเสีย/ชั่วโมง/จำนวนคน)",
      "ลงรายการวัตถุดิบ/บรรจุภัณฑ์ที่ต้องเบิก (กดสถานะพร้อมไม่ได้) · ส่งตรวจ QC",
      "เพิ่ม/แก้ทะเบียนเครื่องจักร (ยกเว้นกำหนดซ่อม/สอบเทียบ)",
      "เปิด Incident Case · ขออนุมัติแก้ไขย้อนหลัง",
    ],
    view: [],
  },
  production_lead: {
    code: "PROD-L",
    duty: "หัวหน้าฝ่ายผลิต — ยืนยันงานที่พนักงานทำ",
    manage: [
      "ทำได้ทุกอย่างเหมือนฝ่ายผลิต",
      "ยืนยัน Line Clearance ที่พนักงานติ๊กไว้ (ต้องคนละคนกับผู้ทำ)",
      "เลือกเครื่องจักรของแต่ละขั้นตอนการผลิต",
    ],
    view: [],
  },
  qc: {
    code: "QC",
    duty: "ตรวจคุณภาพระหว่างผลิต + ตัดสิน QC",
    manage: [
      "บันทึกผลตรวจ in-process QC รายสถานี",
      "QC ผ่าน → ส่ง QA · QC ตีกลับ (ต้องลงนาม)",
      "เปิด Incident Case · ขอแก้ไขผลตรวจ in-process (ฝ่ายอื่นขอแก้ไม่ได้)",
    ],
    view: ["หน้าตรวจ QC / QA"],
  },
  qc_lead: {
    code: "QC-L",
    duty: "หัวหน้า QC — อนุมัติผลตรวจระหว่างผลิต",
    manage: [
      "ทำได้ทุกอย่างเหมือน QC",
      "อนุมัติ / ไม่อนุมัติ ผลตรวจ in-process ที่ QC ลงไว้",
    ],
    view: ["หน้าตรวจ QC / QA"],
  },
  qa: {
    code: "QA",
    duty: "ปล่อยผ่านล็อต + ดูแลเอกสารคุณภาพ",
    manage: [
      "บันทึก/แก้ไข/ลบ จุดเก็บตัวอย่าง (ตรวจ Finished product)",
      "QA ปล่อยผ่าน → FG · QA ตีกลับ (ต้องลงนาม)",
      "ตรวจสอบ Incident Case — ระบุประเภท DEV/OOS/NC + เลขที่ + แผนกที่รับผิดชอบ แล้วปิดเคส",
      "อนุมัติ/ปฏิเสธคำขอแก้ไขข้อมูล QC",
    ],
    view: ["ประวัติ / Audit", "ไล่ย้อนล็อต (Trace)", "คำขอแก้ไข (Amendment)"],
  },
  warehouse: {
    code: "WH",
    duty: "คลังผลิตภัณฑ์ + รับสินค้าสำเร็จรูปเข้าคลัง",
    manage: [
      "เพิ่ม/แก้/ลบผลิตภัณฑ์ในทะเบียน (แก้ขั้นตอนการผลิตไม่ได้)",
      "ล็อต/สต็อกของผลิตภัณฑ์ทุกตัว (ตั้งสถานะล็อตไม่ได้ — ฝ่ายวางแผนกดปลดเองที่แถวล็อต)",
      "กดสถานะ พร้อม/ไม่พร้อม ให้รายการเบิกของแต่ละงาน (เพิ่ม/แก้/ลบรายการไม่ได้)",
      "รับ FG เข้าคลัง",
    ],
    view: ["คลัง / FG", "เบิกวัตถุดิบ / บรรจุภัณฑ์", "ไล่ย้อนล็อต (Trace)"],
  },
  engineering: {
    code: "ENG",
    duty: "ดูแลเครื่องจักร — ซ่อมบำรุง / สอบเทียบ",
    manage: [
      "เพิ่ม/แก้ทะเบียนเครื่องจักร (รวมห้อง/สถานะ)",
      "กำหนดวันซ่อมบำรุง + วันสอบเทียบครั้งหน้า",
      "บันทึกหมายเหตุ Incident Case ในนามฝ่ายวิศวกรรม",
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

/** สร้างงานผลิต / ยืนยันแผนผลิต — ตรงกับ can_plan_jobs() ใน DB */
export function canPlanJobs(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["planner", "manager"]);
}

/**
 * เพิ่ม/แก้/ลบทะเบียนผลิตภัณฑ์ — ตรงกับ can_manage_products() ใน DB (0044)
 * ฝ่ายคลังจัดการผลิตภัณฑ์ได้ แต่ "ขั้นตอนการผลิต (route)" ยังเป็นผู้บริหารเท่านั้น
 */
export function canManageProducts(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["planner", "warehouse", "manager"]);
}

/** เพิ่ม/แก้ทะเบียนเครื่องจักร — ตรงกับ can_manage_machines() ใน DB */
export function canManageMachines(roles: AppRole[]): boolean {
  return hasAnyRole(roles, [
    "production",
    "production_lead",
    "engineering",
    "manager",
  ]);
}

/**
 * ตั้งสถานะล็อต "พร้อมใช้ / ไม่พร้อมใช้" — ตรงกับ can_set_lot_status() ใน DB (0046)
 * ฝ่ายคลังเพิ่ม/แก้ล็อตได้ แต่ปลดสถานะเป็นหน้าที่ฝ่ายวางแผน
 *
 * 0051: ใช้กับ RPC set_lot_status() (ชิปกดบนแถวล็อต) — แยกจาก canManage ของหน้าคลัง
 * ก่อนหน้านี้ helper นี้ถูกต้องแล้วแต่ code path จริงกันฝ่ายวางแผนไว้ 3 ชั้น
 * จนมีแต่ผู้บริหารที่ปลดล็อตได้ · ห้ามเอา requireWarehouse() มาครอบซ้ำอีก
 */
export function canSetLotStatus(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["planner", "manager"]);
}

/**
 * กรอก LOT No. (Batch NO.) ให้งานผลิต — ตรงกับ can_set_job_lot() ใน DB (0049)
 * ฝ่ายผลิตเป็นคนรู้เลขล็อตจริงหน้างาน · ฝ่ายวางแผนกรอกตอนสร้างงานไม่ได้
 */
export function canSetJobLot(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["production", "production_lead", "manager"]);
}

/**
 * แก้ข้อมูลงานฝั่ง "วางแผน" ในหน้ารายละเอียดงาน — Batch Size · บรรจุ · ลูกค้า · กำหนดส่ง ฯลฯ
 * ใช้ can_plan_jobs() ตัวเดิมใน DB (0054 ไม่ได้สร้าง helper ใหม่)
 */
export function canEditJobPlanFields(roles: AppRole[]): boolean {
  return canPlanJobs(roles);
}

/**
 * แก้ข้อมูลงานฝั่ง "ผลิต" — LOT No. · แผนเริ่ม-เสร็จ
 * ใช้ can_set_job_lot() ตัวเดิมใน DB (0049)
 */
export function canEditJobProductionFields(roles: AppRole[]): boolean {
  return canSetJobLot(roles);
}

/**
 * จัดการทะเบียนสถานะงาน (เพิ่ม/แก้/ลบใน dropdown Status) — 0053
 * ทีมยืนยันว่าให้ "ทุกฝ่ายที่ล็อกอิน" ทำได้ · DB guard แค่ current_profile_id() is not null
 */
export function canManageJobSubStatuses(roles: AppRole[]): boolean {
  return roles.length > 0;
}

/**
 * เพิ่ม/แก้/ลบรายการเบิกวัตถุดิบ-บรรจุภัณฑ์ของงาน — ตรงกับ can_edit_job_materials() ใน DB (0056)
 * ฝ่ายผลิตเป็นคนรู้ว่างานนี้ต้องใช้อะไร · แก้ "สถานะความพร้อม" ไม่ได้ (เป็นของฝ่ายคลัง)
 */
export function canEditJobMaterials(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["production", "production_lead", "manager"]);
}

/**
 * กดสถานะ พร้อม/ไม่พร้อม ให้รายการเบิก — ตรงกับ can_set_job_material_status() ใน DB (0056)
 * ฝ่ายคลังเป็นคนเห็นของจริง · ลบรายการไม่ได้
 *
 * ⚠️ ห้าม or รวมกับ canEditJobMaterials() ตอนตัดสินใจแสดง picker —
 *    ฝ่ายผลิตต้อง "เห็นสถานะแต่กดไม่ได้"
 */
export function canSetJobMaterialStatus(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["warehouse", "manager"]);
}

/** ตั้งกำหนดซ่อมบำรุง/สอบเทียบ — ตรงกับ can_set_machine_schedule() ใน DB */
export function canSetMachineSchedule(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["engineering", "manager"]);
}

/** เห็นบล็อกต้นทุนค่าแรง + ปรับอัตรา ฿/ชม. บนแดชบอร์ด (อ่านล้วน — คุมที่แอป) */
export function canSeeCost(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["cost", "manager"]);
}

/**
 * ผูก/ถอดเครื่องจักรกับขั้นตอนการผลิตของงาน — ตรงกับ can_edit_job_route_machines() ใน DB (0061)
 * ฝ่ายผลิตเป็นคนรู้ว่างานนี้เดินเครื่องไหนจริง · หัวหน้าฝ่ายผลิตทำแทนได้
 *
 * ⚠️ DB ยังกั้นอีกชั้นว่า "เครื่องต้องอยู่สถานีเดียวกับขั้นตอน" — helper นี้คุมแค่ว่าจะโชว์ปุ่มไหม
 */
export function canEditJobRouteMachines(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["production", "production_lead", "manager"]);
}

/**
 * บันทึก/ติ๊ก Line Clearance — ตรงกับ can_perform_line_clearance() ใน DB (0062)
 * พนักงานฝ่ายผลิตเป็นคนทำหน้างาน
 */
export function canPerformLineClearance(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["production", "production_lead", "manager"]);
}

/**
 * ยืนยัน Line Clearance — ตรงกับ can_check_line_clearance() ใน DB (0062)
 * ⚠️ เปลี่ยนจากของเดิม (production/qc/qa/manager) เป็น "หัวหน้าฝ่ายผลิต/ผู้บริหาร" เท่านั้น
 *    ทีมยืนยันว่าผู้ตรวจรับคือหัวหน้าห้อง/หัวหน้าฝ่ายผลิต ไม่ใช่ QC
 *
 * ⚠️ ห้าม or รวมกับ canPerformLineClearance() — ฝ่ายผลิตต้อง "ทำได้แต่ยืนยันเองไม่ได้"
 *    (DB ยังกันซ้ำอีกชั้นว่าผู้ยืนยันต้องคนละคนกับผู้ทำ)
 */
export function canCheckLineClearance(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["production_lead", "manager"]);
}

/**
 * ลงผลตรวจ in-process — ตรงกับ can_record_inprocess() ใน DB (0064)
 * QC ที่เป็นพนักงานเป็นคนตรวจและลงผลหน้างาน
 */
export function canRecordInprocess(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["qc", "qc_lead", "manager"]);
}

/**
 * อนุมัติ/ไม่อนุมัติผลตรวจ in-process — ตรงกับ can_approve_inprocess() ใน DB (0064)
 *
 * ⚠️ ห้าม or รวมกับ canRecordInprocess() — QC พนักงานต้อง "ลงผลได้แต่อนุมัติเองไม่ได้"
 *    (DB ยังกันซ้ำอีกชั้นว่าผู้อนุมัติต้องคนละคนกับผู้ลงผล)
 */
export function canApproveInprocess(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["qc_lead", "manager"]);
}
