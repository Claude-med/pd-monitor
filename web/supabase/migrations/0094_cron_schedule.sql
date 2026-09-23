-- ============================================================
-- PD Monitor — Part F / 0094_cron_schedule.sql
--   ตั้งงานตามเวลา 2 งาน ด้วย pg_cron (ตัวจับเวลาตัวแรกของโปรเจคนี้)
--     1. ล้างแจ้งเตือนที่อายุครบ 7 วัน            → purge_old_notifications() (0091)
--     2. เตือนฝ่ายวิศวกรรมเรื่องเครื่องใกล้ถึงกำหนด → notify_machine_due()     (0092)
--
-- 🕐 pg_cron อ่านเวลาเป็น UTC ไม่ใช่เวลาไทย
--      19:00 UTC = 02:00 น. ของวันถัดไปตามเวลาไทย
--      22:00 UTC = 05:00 น. ของวันถัดไปตามเวลาไทย
--    เลือกช่วงดึก/เช้ามืดเพราะไม่มีใครใช้ระบบ และใบเตือนจะโผล่รอตั้งแต่ก่อนเข้ากะ
--
-- ⚠️ ถ้า create extension ไม่ผ่านด้วยสิทธิ์ปกติ ให้เปิดจากหน้าเว็บก่อน:
--      Supabase Dashboard › Database › Extensions › ค้น "pg_cron" › เปิด
--    แล้วค่อย paste เฉพาะส่วน cron.schedule ด้านล่าง
--
-- รัน "หลัง" 0093 · รันซ้ำได้ (unschedule ก่อนเสมอ)
-- ============================================================

create extension if not exists pg_cron;

-- ลบตารางเดิมก่อน (กันซ้ำเวลารันไฟล์นี้อีกรอบ) — ไม่มีอยู่ก็ข้ามไป
do $cron$
begin
  perform cron.unschedule('pd-purge-notifications');
exception when others then null;
end;
$cron$;

do $cron$
begin
  perform cron.unschedule('pd-notify-machine-due');
exception when others then null;
end;
$cron$;

-- 1) ล้างแจ้งเตือนครบ 7 วัน — ทุกวัน 02:00 น. (ไทย)
select cron.schedule(
  'pd-purge-notifications',
  '0 19 * * *',
  $job$ select public.purge_old_notifications(7) $job$
);

-- 2) เตือนเครื่องจักรใกล้/เลยกำหนด — ทุกวัน 05:00 น. (ไทย)
--    ตัวฟังก์ชันกันใบซ้ำเองอยู่แล้ว (หัวข้อเดิมภายใน 7 วัน = ข้าม)
select cron.schedule(
  'pd-notify-machine-due',
  '0 22 * * *',
  $job$ select public.notify_machine_due(7) $job$
);


-- ============================================================
-- ✅ ตรวจหลัง paste
--   select jobname, schedule, active, command from cron.job order by jobname;
--        -- ต้องเห็น 2 แถว · active = true ทั้งคู่
--
--   -- ทดลองรันมือได้ทันที (SQL Editor รันในสิทธิ์ postgres)
--   select public.notify_machine_due(7);          -- ครั้งที่ 2 ต้องได้ 0 (ไม่ยิงซ้ำ)
--   select public.purge_old_notifications(7);     -- คืนจำนวนแถวที่ลบ
--
--   -- ดูประวัติการรันของ cron (หลังผ่านไป 1 วัน)
--   select jobid, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 10;
-- ============================================================
