-- ============================================================
-- PD Monitor — Part A / 0038_roles_add_values.sql
-- เพิ่ม role ใหม่ 3 ตัวเข้า enum app_role (ตาม feedback ทีม — Part A)
--   planner     = ฝ่ายวางแผน (PLN)  · หน้าที่ สร้างงานผลิต + ยืนยันแผน
--   cost        = บัญชีต้นทุน (COST) · หน้าที่ ดูต้นทุนค่าแรง
--   engineering = วิศวกรรม (ENG)     · หน้าที่ กำหนดซ่อมบำรุง / สอบเทียบเครื่องจักร
--
-- ⚠️ ไฟล์นี้ "ต้อง paste แยกรอบ" และรันให้ผ่านก่อน 0039
--    เหตุผล: Postgres ห้ามใช้ค่า enum ใหม่ในทรานแซกชันเดียวกับที่เพิ่ง ADD VALUE
--            (SQL Editor รันทั้งไฟล์เป็นทรานแซกชันเดียว) → 0039 ที่อ้าง 'planner' ฯลฯ จะ error
--
-- รัน "หลัง" 0001–0037
-- ============================================================

alter type app_role add value if not exists 'planner';
alter type app_role add value if not exists 'cost';
alter type app_role add value if not exists 'engineering';

-- ตรวจผล (ควรเห็น 9 ค่า: production, qc, qa, warehouse, manager, admin, planner, cost, engineering)
-- select unnest(enum_range(null::app_role));
