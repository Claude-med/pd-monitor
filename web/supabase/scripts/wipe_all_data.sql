-- ============================================================
-- PD Monitor — ล้างข้อมูลทั้งหมด ก่อนส่งมอบให้ทีมทดสอบ / ก่อนใช้งานจริง
-- (ผู้ใช้สั่งให้เขียน 2 ต.ค. 69 · ผู้ใช้เป็นคน paste เองใน SQL Editor)
--
-- ⚠️⚠️ ลบถาวรทุกอย่าง: งาน · บันทึก · ผลตรวจ · Incident · คลัง · แจ้งเตือน · audit ·
--      ข้อมูลตั้งต้น (บริษัท · ลูกค้า · สถานี · เครื่องจักร · ผลิตภัณฑ์ · สถานะย่อย) · โปรไฟล์ · บัญชีล็อกอินทุกบัญชี
-- ⚠️ ไฟล์นี้ไม่ใช่ migration — paste ใน Supabase SQL Editor เท่านั้น
-- ⚠️ ก่อนรัน: ในโฟลเดอร์ web/ รัน `npm run backup` ให้เสร็จก่อนทุกครั้ง (Supabase ฟรีไม่มี backup)
--
-- วิธีที่ใช้: TRUNCATE ทุกตารางใน schema public ในคำสั่งเดียว
--   · ไม่เรียก trigger รายแถว → ไม่ชน "audit_log ห้ามลบ" (0002) และ "งานที่ยกเลิกแก้ไม่ได้" (0109)
--     และไม่สร้างประวัติการลบเป็นพัน ๆ แถวลงใน audit ใหม่
--   · หารายชื่อตารางเอง → ตารางที่เพิ่มในอนาคตถูกล้างด้วย ไม่ตกหล่น
--   · โครงสร้างตาราง ฟังก์ชัน สิทธิ์ (RLS) และงานตั้งเวลา (pg_cron) อยู่ครบ — ลบแค่ข้อมูล
-- จากนั้นลบบัญชีล็อกอินใน auth.users (รวมการตั้งค่า MFA / เซสชันที่ผูกอยู่)
--
-- ขั้นถัดไป: paste seed_master_review.sql → แจ้ง Claude ให้สร้างบัญชีใหม่ (web/scripts/create-accounts.mjs)
-- ============================================================

begin;

do $$
declare
  v_tables text;
begin
  select string_agg(format('public.%I', tablename), ', ' order by tablename)
    into v_tables
    from pg_tables
   where schemaname = 'public';
  raise notice 'ล้างตาราง: %', v_tables;
  execute 'truncate table ' || v_tables || ' restart identity cascade';
end $$;

-- บัญชีล็อกอินทั้งหมด (identities · sessions · MFA factors ลบตามด้วย cascade ของ Supabase)
delete from auth.users;

-- ตรวจก่อน commit — ทุกค่าต้องเป็น 0
select (select count(*) from auth.users)            as บัญชีล็อกอิน,
       (select count(*) from public.profiles)       as โปรไฟล์,
       (select count(*) from public.jobs)           as งาน,
       (select count(*) from public.products)       as ผลิตภัณฑ์,
       (select count(*) from public.audit_log)      as audit,
       (select count(*) from public.notifications)  as แจ้งเตือน;

commit;

-- ============================================================
-- ✅ ผลที่ต้องได้: แถวเดียว ทุกช่องเป็น 0
-- ❌ ถ้าขึ้น error → ทั้งก้อนถูกยกเลิกเอง ข้อมูลยังอยู่ครบ — คัดลอกข้อความ error ส่งให้ Claude
--
-- ⚠️ หลังรัน: ทุกคนถูกออกจากระบบ (บัญชีเดิมหายหมด) — รวมบัญชีของคุณเอง
--    ใช้บัญชีใหม่ที่ Claude สร้างให้หลัง seed เสร็จ
-- ============================================================
