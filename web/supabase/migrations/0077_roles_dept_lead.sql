-- ============================================================
-- PD Monitor — ระบบสิทธิ์ (Part E) / 0077_roles_dept_lead.sql
-- เพิ่ม role "หัวหน้าแผนก" อีก 4 ตัวให้ครบทุกฝ่าย (ของเดิมมีแค่ production_lead / qc_lead)
--   planner_lead     = หัวหน้าฝ่ายวางแผน
--   qa_lead          = หัวหน้า QA
--   warehouse_lead   = หัวหน้าคลังสินค้า
--   engineering_lead = หัวหน้าฝ่ายวิศวกรรม
--
-- ที่มา: ทีมขอให้ "หัวหน้าแผนก" สร้างบัญชีลูกน้องในแผนกตัวเองได้ (Notion — Part D.4)
--        ระบบเดิมมีหัวหน้าแค่ 2 ฝ่าย → ฝ่ายคลัง/วางแผน/QA/วิศวกรรม ไม่มีใครเป็นหัวหน้าได้เลย
--        ผู้ใช้เลือกแนวทาง "เพิ่ม role ให้ครบทุกฝ่าย" (แทนการทำธงในโปรไฟล์)
--
-- ⚠️ ไฟล์นี้ "ต้อง paste แยกรอบ" และรันให้ผ่านก่อน 0078
--    เหตุผล: Postgres ห้ามใช้ค่า enum ใหม่ในทรานแซกชันเดียวกับที่เพิ่ง ADD VALUE
--            (SQL Editor รันทั้งไฟล์เป็นทรานแซกชันเดียว) → 0078 ที่อ้างค่าใหม่จะ error
--    แพทเทิร์นเดียวกับ 0038 (planner/cost/engineering) และ 0060 (production_lead/qc_lead)
--
-- ℹ️ ไม่เพิ่ม cost_lead — บัญชีต้นทุนเป็น role อ่านล้วนคนเดียว ไม่มีลูกน้องให้ดูแล
--    (ถ้าวันหน้าต้องการ ค่อยเพิ่มด้วย migration ใหม่ได้ ไม่กระทบของเดิม)
--
-- 🚨 หลัง paste ไฟล์นี้ ต้องไล่แก้ "ทุกที่ที่ก็อปรายชื่อ role ไว้" ให้ครบ —
--    บทเรียนบั๊ก VALID_ROLES จาก Part A (0038) ที่ให้สิทธิ์แล้วบันทึกไม่ลง DB
--    รายการทั้งหมดอยู่ใน 0078 (ฝั่ง DB) และ web/lib/{auth,data,nav} (ฝั่งแอป)
--
-- รัน "หลัง" 0076
-- ============================================================

alter type app_role add value if not exists 'planner_lead';
alter type app_role add value if not exists 'qa_lead';
alter type app_role add value if not exists 'warehouse_lead';
alter type app_role add value if not exists 'engineering_lead';

-- ตรวจผล (ควรเห็น 15 ค่า — 11 ตัวเดิม + 4 ตัวใหม่)
-- select unnest(enum_range(null::app_role));
