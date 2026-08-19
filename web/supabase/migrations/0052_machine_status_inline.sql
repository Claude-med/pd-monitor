-- ============================================================
-- PD Monitor — Part 3.1 ก้อน 2 / 0052_machine_status_inline.sql
-- กดเปลี่ยน "สถานะเครื่องจักร" บนการ์ดได้เลย ไม่ต้องเปิดฟอร์มแก้ทั้งใบ
--
--   ของเดิมมี RPC ตัวเดียวคือ upsert_machine (0039) ซึ่งเขียนทับ "ทุกคอลัมน์"
--   (0039:146-160) → ถ้าเอามาใช้เปลี่ยนแค่สถานะ หน้าจอต้องส่ง code/name/room/note/
--   วันซ่อม/วันสอบเทียบกลับมาด้วยทั้งชุด = เสี่ยงทับข้อมูลจาก snapshot เก่าที่ค้างในเบราว์เซอร์
--   (บทเรียนเดียวกับที่ 0051 เตือนเรื่องเขียนทับสต็อก)
--
--   (1) set_machine_status() — RPC แคบ ๆ รับ 2 พารามิเตอร์ แก้แค่คอลัมน์ status
--
-- ℹ️ ไม่แตะ upsert_machine / can_manage_machines() / can_set_machine_schedule() เลย
--    สิทธิ์เท่าเดิมเป๊ะ: ฝ่ายผลิต · วิศวกรรม · ผู้บริหาร (admin ผ่านอัตโนมัติจาก has_role ของ 0013)
-- ℹ️ machines มี trigger meta/audit ครบแล้วจาก 0014:46-52 และเปิด realtime แล้ว — ไม่ต้องผูกใหม่
-- รัน "หลัง" 0001–0051
-- ============================================================

-- ------------------------------------------------------------
-- (1) set_machine_status — เปลี่ยนสถานะเครื่องจักรอย่างเดียว
--
--     แคบโดยตั้งใจ: การเปลี่ยนสถานะเป็นงานที่ทำบ่อยที่สุดของหน้านี้ (วันละหลายครั้ง)
--     จึงต้องกดได้จากการ์ดตรง ๆ · ส่วนทะเบียน (รหัส/ชื่อ/ห้อง/กำหนดซ่อม) ยังอยู่ที่ upsert_machine
-- ------------------------------------------------------------
create or replace function public.set_machine_status(
  p_machine_id uuid,
  p_status machine_status
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_code    text;
  v_name    text;
  v_old     machine_status;
  v_label   text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_manage_machines() then
    raise exception 'เฉพาะฝ่ายผลิต/วิศวกรรม/ผู้บริหารเปลี่ยนสถานะเครื่องจักรได้';
  end if;
  if p_status is null then
    raise exception 'กรุณาเลือกสถานะเครื่องจักร';
  end if;

  select m.code, m.name, m.status
    into v_code, v_name, v_old
    from public.machines m
   where m.id = p_machine_id;

  if v_code is null then
    raise exception 'ไม่พบเครื่องจักรที่เลือก';
  end if;

  if v_old = p_status then
    return p_machine_id;   -- ไม่เปลี่ยนอะไร = ไม่ต้องเขียน audit ซ้ำ
  end if;

  v_label := case p_status::text
               when 'available'       then 'พร้อมใช้'
               when 'in_use'          then 'กำลังใช้งาน'
               when 'cleaning'        then 'ทำความสะอาด'
               when 'maintenance'     then 'ซ่อมบำรุง'
               when 'calibration_due' then 'ถึงกำหนดสอบเทียบ'
               else p_status::text
             end;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'เปลี่ยนสถานะเครื่อง ' || v_code || ' (' || v_name || ') เป็น "' || v_label || '"', true);

  update public.machines
     set status = p_status, updated_by = v_profile
   where id = p_machine_id;

  return p_machine_id;
end;
$fn$;

grant execute on function public.set_machine_status(uuid, machine_status) to authenticated;

comment on function public.set_machine_status(uuid, machine_status) is
  'เปลี่ยนสถานะเครื่องจักร — ฝ่ายผลิต/วิศวกรรม/ผู้บริหาร · แก้เฉพาะคอลัมน์ status ไม่แตะทะเบียน/กำหนดซ่อม';

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   select oid::regprocedure from pg_proc where proname = 'set_machine_status';
--
--   -- สถานะเครื่องตอนนี้
--   select status, count(*) from public.machines group by 1 order by 1;
--
--   -- ร่องรอยการเปลี่ยนสถานะ
--   select reason, changed_at from public.audit_log
--    where table_name = 'machines' order by id desc limit 5;
-- ============================================================
