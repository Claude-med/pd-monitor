-- ============================================================
-- PD Monitor — Part C.3 ก้อน 3 / 0060_roles_lead.sql
-- เพิ่ม role "หัวหน้า" 2 ตัวเข้า enum app_role
--   production_lead = หัวหน้าฝ่ายผลิต  · หน้าที่ ยืนยัน Line Clearance (คนละคนกับผู้ทำ)
--   qc_lead         = หัวหน้า QC       · หน้าที่ อนุมัติผลตรวจ in-process (คนละคนกับผู้ลงผล)
--
-- ที่มา: requirement Part C.3 แยกหน้าที่ "คนทำ/คนตรวจ" ออกจาก "คนยืนยัน/อนุมัติ"
--        ระบบเดิมมีแค่ production กับ qc → แยก 2 บทบาทนี้ไม่ได้
--
-- ⚠️ ไฟล์นี้ "ต้อง paste แยกรอบ" และรันให้ผ่านก่อน 0061
--    เหตุผล: Postgres ห้ามใช้ค่า enum ใหม่ในทรานแซกชันเดียวกับที่เพิ่ง ADD VALUE
--            (SQL Editor รันทั้งไฟล์เป็นทรานแซกชันเดียว) → 0061 ที่อ้าง 'production_lead' จะ error
--    แพทเทิร์นเดียวกับ 0038 (planner / cost / engineering)
--
-- รัน "หลัง" 0001–0059
-- ============================================================

alter type app_role add value if not exists 'production_lead';
alter type app_role add value if not exists 'qc_lead';

-- ตรวจผล (ควรเห็น 11 ค่า — 9 ตัวเดิม + production_lead + qc_lead)
-- select unnest(enum_range(null::app_role));
