-- ============================================================
-- PD Monitor — ใบแจ้งผลิต (Part D) / 0075_company_pond_rename.sql
-- แก้คำสะกดชื่อบริษัท POUND → POND ให้ตรงกับฟอร์มกระดาษจริง
--   (1) companies — code 'POUND' → 'POND' · name → 'POND CHEMICAL COMPANY LIMITED'
--   (2) jobs.company — backfill snapshot ของงานเก่าให้สะกดตรงกัน
-- รัน "หลัง" 0074
--
-- ℹ️ ที่มา: 0071 seed ชื่อไว้ว่า "POUND CHEMICAL COMPANY LIMITED" แต่ฟอร์ม F.PLN.01
--    ของบริษัทนี้ (และที่ทีมเขียนใน Notion) สะกดว่า "POND" ไม่มี U
--    ใบแจ้งผลิตที่ปริ้นออกไปต้องเหมือนกระดาษจริง → ผู้ใช้ยืนยันให้แก้ที่ DB เลย
--
-- ⚠️ นี่คือ "แก้คำสะกดของชื่อเดิม" ไม่ใช่เปลี่ยนบริษัท —
--    id / job_no_prefix ('P') / เลขงานที่ออกไปแล้ว ไม่เปลี่ยนแม้แต่ตัวเดียว
--    การ backfill jobs.company จึงไม่ขัดหลัก ALCOA (snapshot ยังชี้บริษัทเดียวกัน)
--    และมี audit_log บันทึกไว้ครบทุกแถว
--
-- 🚨 ห้ามรัน 0071 ซ้ำหลังจากไฟล์นี้ — seed guard ของ 0071 เช็ก lower(code)='pound'
--    ถ้ารันซ้ำจะได้บริษัท POUND โผล่มาใหม่เป็นใบที่ 3 (ปกติ paste ครั้งเดียวจึงไม่กระทบ)
-- ============================================================

do $$
declare
  v_old_name constant text := 'POUND CHEMICAL COMPANY LIMITED';
  v_new_name constant text := 'POND CHEMICAL COMPANY LIMITED';
  v_companies integer;
  v_jobs      integer;
begin
  perform set_config('app.audit_reason',
    'แก้คำสะกดชื่อบริษัท POUND → POND ให้ตรงฟอร์ม F.PLN.01 (0075)', true);

  -- ---------- (1) ทะเบียนบริษัท ----------
  update public.companies
     set code = 'POND',
         name = v_new_name
   where lower(btrim(code)) = 'pound';
  get diagnostics v_companies = row_count;

  -- ---------- (2) snapshot ชื่อบริษัทบนงานเก่า ----------
  update public.jobs
     set company = v_new_name
   where company = v_old_name;
  get diagnostics v_jobs = row_count;

  raise notice '0075: companies %, jobs %', v_companies, v_jobs;
end $$;

comment on column public.jobs.company is
  'ชื่อบริษัท snapshot ตอนสร้างงาน (Part D · 0071) — คำสะกด POND แก้ที่ 0075';

-- ------------------------------------------------------------
-- คำสั่งตรวจหลัง paste (ต้องได้ตามนี้)
-- ------------------------------------------------------------
-- (ก) ต้องได้ 2 แถว: UMEDA / POND  (ห้ามมี POUND)
--     select code, name, job_no_prefix from public.companies order by sort_order;
--
-- (ข) ต้องได้ 0
--     select count(*) from public.jobs where company like 'POUND%';
--
-- (ค) เลขงานของ POND ต้องยังขึ้นต้นด้วย P เหมือนเดิม
--     select job_no, company from public.jobs where company like 'POND%' order by job_no;
