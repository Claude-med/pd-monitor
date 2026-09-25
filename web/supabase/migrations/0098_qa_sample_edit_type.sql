-- ============================================================
-- PD Monitor — Part H / 0098_qa_sample_edit_type.sql  (ก้อน 1 · ไฟล์ที่ 1/2)
--   เพิ่มชนิดคำขอแก้ไข 'qa_sample' (จุดเก็บตัวอย่าง ตรวจ Finished product)
--
-- 🚨 ต้อง paste ไฟล์นี้ "แยก" แล้วกด Run ให้จบก่อน ค่อย paste 0099
--    Postgres ห้ามใช้ค่า enum ที่เพิ่งเพิ่มใน transaction เดียวกัน
--
-- รัน "หลัง" 0097 · รันซ้ำได้
-- ============================================================

alter type public.edit_target_type add value if not exists 'qa_sample';

-- ============================================================
-- ✅ ตรวจหลัง paste
--   select unnest(enum_range(null::public.edit_target_type));
--   ✅ ต้องได้ 4 แถว: production_record · material_requisition · inprocess_check · qa_sample
--   ❌ ถ้าไม่มี qa_sample = ไฟล์นี้ยังไม่ได้รัน → รันใหม่
-- ============================================================
