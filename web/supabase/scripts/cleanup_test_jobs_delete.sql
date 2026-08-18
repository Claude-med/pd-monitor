-- ============================================================
-- PD Monitor — Part 3 / S0 ขั้นที่ 2: ล้างข้อมูลทดสอบ (งาน + คลัง) เริ่มใหม่
--
-- ⚠️⚠️ สคริปต์นี้ลบข้อมูลถาวร — รัน cleanup_test_jobs_count.sql ดูก่อนเสมอ
-- ⚠️ ไฟล์นี้ไม่ใช่ migration — รันมือใน Supabase SQL Editor เท่านั้น และรันครั้งเดียว
--
-- ลบอะไรบ้าง:
--   · งานผลิตทั้งหมด + ตารางลูก 12 ตัวที่ผูก job_id (cascade — ดู 0035)
--   · ใบสั่งผลิต / ล็อตการผลิต ที่กลายเป็นของกำพร้า
--   · ล็อตในคลัง (material_lots) + สต็อก FG — ตอนทดสอบมีการกดจ่ายของไปแล้ว
--     ยอดคงเหลือจึงเพี้ยน เจ้าของงานเลือก "ล้างคลังเริ่มใหม่หมด"
--
-- ไม่ลบ (เป็น master data ที่ตั้งค่าไว้แล้ว ไม่ใช่ข้อมูลทดสอบ):
--   · ทะเบียนผลิตภัณฑ์ (products) · ขั้นตอนการผลิต (product_routes) · สถานี (stations)
--   · ทะเบียนลูกค้า (customers) · ผู้ใช้/สิทธิ์ · เครื่องจักร
--
-- ℹ️ audit_log เป็น append-only → ประวัติการลบยังอยู่ครบ
-- ℹ️ ไม่ต้องแก้อะไรก่อนรัน — สคริปต์หาบัญชีผู้ดูแลระบบให้เองเพื่อบันทึกลง audit_log
-- ============================================================

begin;

-- บอก audit_log ว่าใครลบ + ลบทำไม (หา admin คนแรกให้อัตโนมัติ)
select set_config('app.current_profile_id',
  coalesce((select p.id::text
              from public.profiles p
              join public.user_roles ur on ur.profile_id = p.id
             where ur.role::text = 'admin'
             limit 1), ''), true);
select set_config('app.audit_reason',
                  'ล้างข้อมูลทดสอบ (งาน + คลัง) ก่อนเริ่มเลขงาน 6 หลัก — Part 3 ก้อน 2', true);

-- (1) ลบงานทั้งหมด — ตารางลูก 12 ตัว cascade ตามไปเอง (รวมใบเบิกและสต็อก FG ที่ผูกงาน)
delete from public.jobs;

-- (2) สต็อก FG ที่ไม่ได้ผูกงาน (ถ้ามีหลงเหลือ)
delete from public.fg_inventory;

-- (3) ล็อตในคลัง — ทำหลังข้อ (1) เพราะใบเบิกชี้มาที่ล็อต ถ้าลบก่อนจะติด FK
delete from public.material_lots;

-- (4) ลบล็อตการผลิตที่กำพร้า (ไม่มีงานไหนใช้แล้ว)
delete from public.batches b
 where not exists (select 1 from public.jobs where batch_id = b.id);

-- (5) ลบใบสั่งผลิตที่กำพร้า
delete from public.orders o
 where not exists (select 1 from public.jobs    where order_id = o.id)
   and not exists (select 1 from public.batches where order_id = o.id);

-- (6) ตรวจก่อน commit — ทุกค่าต้องเป็น 0
select (select count(*) from public.jobs)           as jobs_เหลือ,
       (select count(*) from public.batches)        as batches_เหลือ,
       (select count(*) from public.orders)         as orders_เหลือ,
       (select count(*) from public.material_lots)  as ล็อตคลัง_เหลือ,
       (select count(*) from public.fg_inventory)   as สต็อกFG_เหลือ;

commit;

-- ============================================================
-- ถ้าผลข้อ (6) ไม่เป็น 0 ทั้งหมด → พิมพ์ rollback; แทน commit; แล้วแจ้ง Claude
--
-- หลังจากนี้:
--   1) paste migration 0048_job_no_be_bulk.sql
--   2) ฝ่ายคลังคีย์ล็อตของจริงเข้าใหม่ที่หน้า "ผลิตภัณฑ์คลัง"
--      (ทะเบียนยา/ขั้นตอนการผลิตยังอยู่ครบ ไม่ต้องตั้งใหม่)
-- ============================================================
