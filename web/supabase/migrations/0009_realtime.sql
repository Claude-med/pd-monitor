-- ============================================================
-- PD Monitor — D8 / 0009_realtime.sql
-- เปิด Supabase Realtime ให้ตารางที่หน้าจอต้องอัปเดตสด
-- (ตอบ pain point หลักใน PRD: "ไม่อัปเดตแบบ Real-time")
-- RLS ยังบังคับ: client รับเฉพาะ event ของแถวที่ตัวเองมีสิทธิ์อ่าน (SELECT)
-- รันต่อจาก 0001–0008 · รันซ้ำได้ (กันพังถ้าตารางถูกเพิ่มไว้แล้ว)
-- ============================================================

-- supabase_realtime = publication ที่ Realtime ใช้ broadcast การเปลี่ยนแปลง
-- (Supabase สร้างให้อยู่แล้วโดยดีฟอลต์) เพิ่มตารางหลัก 3 ตัวที่หน้าจอ subscribe

do $$
begin
  alter publication supabase_realtime add table public.jobs;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.production_records;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.approvals;
exception when duplicate_object then null; end $$;
