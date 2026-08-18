-- ============================================================
-- PD Monitor — Part 3 / S0 ขั้นที่ 1: "นับก่อนลบ" (อ่านอย่างเดียว ไม่แก้อะไร)
--
-- ใช้ก่อนรัน cleanup_test_jobs_delete.sql — ดูให้ชัดว่าจะลบอะไรไปบ้าง
-- เหตุผลที่ต้องล้าง: Part 3 ก้อน 2 เปลี่ยนเลขงานเป็น 6 หลัก (690001)
--   เลขรูปแบบเก่า (JOB-2569-0001) ปนอยู่จะทำให้การเรียงบนบอร์ดแยกเป็น 2 กลุ่ม
--
-- ⚠️ ไฟล์นี้ไม่ใช่ migration — รันมือใน Supabase SQL Editor เท่านั้น
-- ============================================================

-- ------------------------------------------------------------
-- (1) งานทั้งหมดที่จะถูกลบ
-- ------------------------------------------------------------
select job_no, status, created_at
  from public.jobs
 order by created_at;

-- ------------------------------------------------------------
-- (2) สรุปจำนวนต่อสถานะ
-- ------------------------------------------------------------
select status, count(*) as จำนวนใบ
  from public.jobs
 group by status
 order by status;

-- ------------------------------------------------------------
-- (3) ข้อมูลลูกที่จะหายตามไปด้วย (ผูก job_id แบบ on delete cascade — 0035)
-- ------------------------------------------------------------
select 'production_records'   as ตาราง, count(*) as จำนวน from public.production_records
union all select 'approvals',            count(*) from public.approvals
union all select 'material_requisitions',count(*) from public.material_requisitions
union all select 'line_clearances',      count(*) from public.line_clearances
union all select 'fg_inventory',         count(*) from public.fg_inventory
union all select 'deviations',           count(*) from public.deviations
union all select 'deviation_comments',   count(*) from public.deviation_comments
union all select 'notifications',        count(*) from public.notifications
union all select 'job_routes',           count(*) from public.job_routes
union all select 'inprocess_checks',     count(*) from public.inprocess_checks
union all select 'qa_samples',           count(*) from public.qa_samples
union all select 'edit_requests',        count(*) from public.edit_requests
 order by 1;

-- ------------------------------------------------------------
-- (4) ใบสั่งผลิต / ล็อตการผลิต ที่จะกลายเป็นของกำพร้า
-- ------------------------------------------------------------
select 'orders'  as ตาราง, count(*) as จำนวน from public.orders
union all select 'batches', count(*) from public.batches;

-- ------------------------------------------------------------
-- (5) ⚠️ ใบเบิกที่ "จ่ายแล้ว" — ตัดสต็อกไปแล้ว และการลบงานจะไม่คืนสต็อกให้
--     ถ้ามีแถวโผล่มา ให้ไปปรับจำนวนคงเหลือเองที่หน้า "ผลิตภัณฑ์คลัง" หลังลบ
-- ------------------------------------------------------------
select j.job_no,
       p.code  as รหัสผลิตภัณฑ์,
       ml.lot_no as ล็อต,
       r.qty   as จำนวนที่จ่ายไป,
       r.issued_at as วันที่จ่าย
  from public.material_requisitions r
  join public.jobs j           on j.id  = r.job_id
  join public.material_lots ml on ml.id = r.material_lot_id
  left join public.products p  on p.id  = ml.product_id
 where r.status = 'issued'
 order by r.issued_at;

-- ------------------------------------------------------------
-- (6) เลขงานรูปแบบไหนอยู่ในระบบบ้าง (ดูว่ามีเลข 6 หลักปนมาแล้วหรือยัง)
-- ------------------------------------------------------------
select case when job_no ~ '^[0-9]{6}$' then 'เลข 6 หลัก (รูปแบบใหม่)'
            else 'รูปแบบเก่า' end as รูปแบบ,
       count(*) as จำนวน
  from public.jobs
 group by 1;
