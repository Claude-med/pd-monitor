/**
 * ค่าคงที่ของ "ผลิตภัณฑ์" — ไม่มี server import → ใช้ได้ทั้ง Server และ Client Components
 *
 * Part 2.1: ตัด PRODUCT_TYPES (ยา/RM/PM) ทิ้ง — ทีมเลิกใช้การแยกประเภทแล้ว
 * และ migration 0044 drop คอลัมน์ products.type ออกจากฐานข้อมูลด้วย
 */

/** หน่วยนับมาตรฐาน — ตรงกับ "ตารางรหัสผลิตภัณฑ์และเลขทะเบียนตำรับยา" ของโรงงาน */
export const PRODUCT_UNITS = ["TAB", "CAP", "LT.", "KG."] as const;
