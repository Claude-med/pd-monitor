-- ============================================================
-- PD Monitor — Part C.3 ก้อน 1 / 0058_machine_station_id.sql
-- เครื่องจักรผูก "สถานีจริง" แทน "กลุ่มหลัก" + ล้างข้อมูลทดสอบแล้ว seed ใหม่ 9 สถานี × 2 เครื่อง
--
--   (0) pre-flight — หยุดทั้งไฟล์ถ้ามีของค้างที่จะพังตอนลบ
--   (1) machines.station_id (FK stations) + index
--   (2) ล้างข้อมูลทดสอบ: inprocess_checks → line_clearances → production_records → machines
--   (3) seed เครื่องจักรใหม่ 18 เครื่อง (สถานี active 9 ตัว × 2)
--   (4) upsert_machine เวอร์ชันใหม่ — รับ p_station_id แทน p_station (enum)
--
-- ℹ️ นี่คือขั้น "expand" ของ expand → migrate → contract (บทเรียน Part C.2 / 0056–0057)
--    ไฟล์นี้ "ยังไม่ลบ" คอลัมน์ machines.station / stations.station_group —
--    เขียนควบทั้งสองคอลัมน์ไว้ก่อน เพื่อให้แอปเวอร์ชันเก่าที่ยังรันอยู่ไม่พัง
--    ก้อน 2 (0059) ค่อยลบ enum production_station ทิ้งทั้งชุด
--
-- ℹ️ ทำไมต้องล้างข้อมูลทดสอบด้วย ไม่ใช่แค่ลบเครื่องจักร:
--    production_records.machine_id เป็น FK ไป machines (0015) แบบไม่มี on delete
--    ถ้าลบเครื่องเฉย ๆ จะติด FK · ผู้ใช้ยืนยันให้ล้างทั้งชุด (ข้อมูลจริงตอนนี้ 1–2 แถว เป็นของทดสอบล้วน)
--
-- ⚠️ หลังรันไฟล์นี้ บันทึกผลผลิต / ผลตรวจ in-process / Line Clearance เดิม "หายทั้งหมด"
--    งาน (jobs) · ออเดอร์ · ผลิตภัณฑ์ · สถานี · route ไม่ถูกแตะ
-- รัน "หลัง" 0001–0057
-- ============================================================

-- ------------------------------------------------------------
-- (0) pre-flight — เจอของค้างให้หยุดทั้งไฟล์ ไม่ต้องลบครึ่ง ๆ กลาง ๆ
--     (แพทเทิร์นเดียวกับ 0057 — ตรวจก่อนทำลาย ไม่ใช่ตรวจหลัง)
-- ------------------------------------------------------------
do $$
declare
  v_dev  int;
  v_edit int;
begin
  -- deviations.machine_id เป็น FK แบบไม่มี on delete → ลบเครื่องไม่ผ่านถ้ามีใบอ้างอยู่
  select count(*) into v_dev
    from public.deviations where machine_id is not null;
  if v_dev > 0 then
    raise exception 'มี deviation % ใบที่อ้างเครื่องจักรอยู่ — ต้องเคลียร์ก่อนล้างทะเบียนเครื่องจักร', v_dev;
  end if;

  -- คำขอแก้ไขที่ค้างอยู่จะกลายเป็นคำขอลอย (target หายไปแล้ว) ถ้าปล่อยผ่าน
  select count(*) into v_edit
    from public.edit_requests
   where status = 'pending'
     and target_type in ('production_record', 'inprocess_check');
  if v_edit > 0 then
    raise exception 'มีคำขอแก้ไขค้างอยู่ % รายการ (บันทึกผลผลิต/ผลตรวจ) — ต้องอนุมัติหรือปฏิเสธก่อน', v_edit;
  end if;
end $$;

-- ------------------------------------------------------------
-- (1) machines.station_id — สถานีจริง (ของเดิมมีแต่ machines.station ที่เป็น enum 4 กลุ่ม)
-- ------------------------------------------------------------
alter table public.machines
  add column if not exists station_id uuid references public.stations(id);

comment on column public.machines.station_id is
  'สถานีจริงที่เครื่องนี้ประจำอยู่ (FK stations) — Part C.3 ก้อน 1 · แทนคอลัมน์ station (enum กลุ่มหลัก) ที่จะถูกลบใน 0059';

create index if not exists idx_machines_station_id on public.machines(station_id);

-- ------------------------------------------------------------
-- (2) ล้างข้อมูลทดสอบ — ลำดับสำคัญ (ลูกก่อนแม่)
--     deviations.inprocess_check_id เป็น on delete set null อยู่แล้ว ไม่ต้องแตะ
-- ------------------------------------------------------------
select set_config('app.audit_reason', 'Part C.3 ก้อน 1 — ล้างข้อมูลทดสอบก่อน seed เครื่องจักรใหม่', true);

delete from public.inprocess_checks;
delete from public.line_clearances;
delete from public.production_records;
delete from public.machines;

-- ------------------------------------------------------------
-- (3) seed เครื่องจักรใหม่ — สถานี active ทุกตัว × 2 เครื่อง
--     code = ท้าย code ของสถานี + ลำดับ (ST-TAB → TAB-01, TAB-02)
--     เขียน station (enum) ควบ station_id ไว้ก่อน — 0059 ค่อยลบคอลัมน์ enum
-- ------------------------------------------------------------
select set_config('app.audit_reason', 'Part C.3 ก้อน 1 — seed เครื่องจักร 2 เครื่องต่อสถานี', true);

do $$
declare
  r record;
  i int;
begin
  for r in
    select id, code, name, station_group
      from public.stations
     where is_active
     order by seq, code
  loop
    for i in 1..2 loop
      insert into public.machines
        (code, name, station, station_id, status, is_active)
      values
        (replace(r.code, 'ST-', '') || '-' || lpad(i::text, 2, '0'),
         r.name || ' ' || i,
         r.station_group,
         r.id,
         'available',
         true);
    end loop;
  end loop;
end $$;

-- ------------------------------------------------------------
-- (4) upsert_machine — เปลี่ยนพารามิเตอร์สถานีเป็น station_id
--
--     ⚠️ เปลี่ยน type ของพารามิเตอร์ = signature ใหม่ → ต้อง drop ตัวเก่าก่อน
--        ไม่งั้นจะเป็น overload ซ้อนกัน 2 ตัว แล้ว PostgREST เลือกผิดตัว
--     บอดี้ยกมาจาก 0039 ทั้งดุ้น แก้เฉพาะส่วนสถานี (บทเรียน 0057 — อย่าเขียนใหม่จากความจำ)
-- ------------------------------------------------------------
drop function if exists public.upsert_machine(
  uuid, text, text, production_station, machine_status, text, date, date, date, text
);

create or replace function public.upsert_machine(
  p_id                    uuid,
  p_code                  text,
  p_name                  text,
  p_station_id            uuid               default null,
  p_status                machine_status     default 'available',
  p_note                  text               default null,
  p_last_clean_date       date               default null,
  p_next_maintenance_date date               default null,
  p_next_calibration_date date               default null,
  p_room                  text               default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile   uuid;
  v_id        uuid;
  v_can_sched boolean;
  v_group     production_station;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_manage_machines() then
    raise exception 'เฉพาะฝ่ายผลิต/วิศวกรรม/ผู้บริหารจัดการเครื่องจักรได้';
  end if;

  -- ใครที่ไม่ใช่วิศวกรรม/ผู้บริหาร → กำหนดวันซ่อม/สอบเทียบไม่ได้
  --   เพิ่มใหม่ = บังคับ null · แก้ของเดิม = คงค่าเดิมไว้ (ไม่รับค่าจากพารามิเตอร์)
  v_can_sched := public.can_set_machine_schedule();

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  if p_code = '' then raise exception 'กรุณาระบุรหัสเครื่อง (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อเครื่อง'; end if;

  -- สถานี: ต้องมีอยู่จริงในทะเบียน · lookup กลุ่มหลักมาเขียนควบไว้จนกว่า 0059 จะลบคอลัมน์
  if p_station_id is not null then
    select station_group into v_group
      from public.stations where id = p_station_id;
    if v_group is null then
      raise exception 'ไม่พบสถานีที่เลือก';
    end if;
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    -- เพิ่มใหม่
    if exists (select 1 from public.machines where code = p_code) then
      raise exception 'รหัสเครื่อง % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มเครื่องจักร ' || p_code, true);

    insert into public.machines
      (code, name, station, station_id, room, status, note,
       last_clean_date, next_maintenance_date, next_calibration_date, created_by)
    values
      (p_code, p_name, v_group, p_station_id,
       nullif(btrim(coalesce(p_room, '')), ''),
       coalesce(p_status, 'available'),
       nullif(btrim(coalesce(p_note, '')), ''),
       p_last_clean_date,
       case when v_can_sched then p_next_maintenance_date else null end,
       case when v_can_sched then p_next_calibration_date else null end,
       v_profile)
    returning id into v_id;
  else
    -- แก้ของเดิม
    if not exists (select 1 from public.machines where id = p_id) then
      raise exception 'ไม่พบเครื่องจักรที่เลือก';
    end if;
    if exists (select 1 from public.machines where code = p_code and id <> p_id) then
      raise exception 'รหัสเครื่อง % ถูกใช้กับเครื่องอื่นแล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'แก้ข้อมูลเครื่องจักร ' || p_code, true);

    update public.machines
       set code = p_code,
           name = p_name,
           station = v_group,
           station_id = p_station_id,
           room = nullif(btrim(coalesce(p_room, '')), ''),
           status = coalesce(p_status, status),
           note = nullif(btrim(coalesce(p_note, '')), ''),
           last_clean_date = p_last_clean_date,
           next_maintenance_date =
             case when v_can_sched then p_next_maintenance_date else next_maintenance_date end,
           next_calibration_date =
             case when v_can_sched then p_next_calibration_date else next_calibration_date end,
           updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.upsert_machine(
  uuid, text, text, uuid, machine_status, text, date, date, date, text
) from public;
revoke execute on function public.upsert_machine(
  uuid, text, text, uuid, machine_status, text, date, date, date, text
) from anon;
grant execute on function public.upsert_machine(
  uuid, text, text, uuid, machine_status, text, date, date, date, text
) to authenticated;

comment on function public.upsert_machine(
  uuid, text, text, uuid, machine_status, text, date, date, date, text
) is
  'เพิ่ม/แก้เครื่องจักร (ฝ่ายผลิต/วิศวกรรม/ผู้บริหาร) — Part C.3 ก้อน 1: รับ p_station_id (สถานีจริง) แทน p_station (enum กลุ่มหลัก) · ฝั่งแอปคู่กับ canManageMachines()/canSetMachineSchedule()';

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้)
-- ------------------------------------------------------------
-- select count(*) from public.machines;                                  -- ต้องได้ 18
-- select count(*) from public.machines where station_id is null;         -- ต้องได้ 0
-- select s.name, count(m.id)
--   from public.stations s join public.machines m on m.station_id = s.id
--  group by s.name order by s.name;                                      -- ทุกสถานีต้องได้ 2
-- select count(*) from pg_proc where proname = 'upsert_machine';         -- ต้องได้ 1 (ไม่มี overload ซ้อน)
-- select count(*) from public.production_records;                        -- ต้องได้ 0
-- ============================================================
