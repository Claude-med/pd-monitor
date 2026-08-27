-- ============================================================
-- PD Monitor — Part C.3 ก้อน 5 / 0063_production_record_shift.sql
-- บันทึกผลผลิตรายวัน: กะ · ช่วงเวลา/OT · นาที (แทนชั่วโมง) · หน่วยรายช่อง
-- + ผูกผลตรวจ in-process เข้ากับ "แถวบันทึกผลผลิต" ที่ตรวจ
--
--   (1) enum work_shift / work_period
--   (2) production_records: rename hours→minutes + job_route_id + กะ/ช่วงเวลา + 3 หน่วย
--   (3) inprocess_checks.production_record_id — ผูกผลตรวจกับแถวที่ตรวจ
--   (4) add_production_record signature ใหม่ (รับ job_route_id แทน station_id)
--   (5) add_inprocess_check — รับ p_production_record_id
--   (6) request_edit / review_edit_request — whitelist ตามคอลัมน์ใหม่
--
-- ℹ️ ทำไม rename hours→minutes ไม่ใช่เพิ่มคอลัมน์ใหม่:
--    ตาราง production_records ว่าง (ล้างไปใน 0058) ไม่มีข้อมูลต้องแปลงหน่วย
--    ถ้าเก็บทั้ง 2 คอลัมน์จะมี 2 แหล่งความจริงที่ต้องคอย sync
--
-- ℹ️ ทำไมหน่วยเป็น text ไม่ใช่ enum:
--    บทเรียน 0040 — enum ลบค่าทิ้งไม่ได้ และ ADD VALUE ต้องแยกทรานแซกชัน
--    รายการหน่วย (กล่อง/แผง/kg./ซอง) อยู่ฝั่งแอปที่ lib/data/production-constants.ts
--
-- ℹ️ production_record_id ย้ายมาทำในก้อนนี้ (แผนเดิมอยู่ก้อน 6):
--    คอลัมน์สถานะ QC ในตารางบันทึกผลผลิตต้องรู้ว่าแถวไหนถูกตรวจแล้ว จึงต้องมีขาผูกก่อน
--    ก้อน 6 ค่อยเติม valid_date + ขั้นตอนรออนุมัติ
--
-- ⚠️ enum ที่ "สร้างใหม่" ในไฟล์นี้ใช้ค่าในทรานแซกชันเดียวกันได้ (ต่างจาก ALTER TYPE ADD VALUE)
-- รัน "หลัง" 0001–0062
-- ============================================================

-- ------------------------------------------------------------
-- (0) pre-flight
-- ------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from public.edit_requests where status = 'pending';
  if v_n > 0 then
    raise exception 'มีคำขอแก้ไขค้างอยู่ % รายการ — whitelist กำลังเปลี่ยน (hours→minutes) ต้องอนุมัติ/ปฏิเสธก่อน', v_n;
  end if;
  raise notice 'pre-flight ผ่าน';
end $$;

-- ------------------------------------------------------------
-- (1) enum กะ + ช่วงเวลา
-- ------------------------------------------------------------
do $$ begin
  create type work_shift as enum ('morning', 'night');
exception when duplicate_object then null; end $$;

do $$ begin
  create type work_period as enum ('normal', 'ot');
exception when duplicate_object then null; end $$;

comment on type work_shift is 'กะทำงาน: morning = กะเช้า · night = กะดึก';
comment on type work_period is 'ช่วงเวลา: normal = ช่วงเวลาปกติ · ot = OT';

-- ------------------------------------------------------------
-- (2) production_records
-- ------------------------------------------------------------
do $$ begin
  alter table public.production_records rename column hours to minutes;
exception when undefined_column then null; end $$;

alter table public.production_records
  add column if not exists job_route_id uuid references public.job_routes(id),
  add column if not exists shift        work_shift,
  add column if not exists work_period  work_period,
  add column if not exists input_unit   text,
  add column if not exists output_unit  text,
  add column if not exists loss_unit    text;

comment on column public.production_records.minutes is
  'เวลาทำงาน (นาที) — Part C.3 ก้อน 5 · เดิมเป็นชั่วโมง แต่หน้างานใช้ไม่เต็มชั่วโมง (feedback ฝ่ายผลิต)';
comment on column public.production_records.job_route_id is
  'ขั้นตอนการผลิตที่บันทึกนี้อยู่ (job_routes.id) — station_id ยังเก็บไว้เพื่อ query/รายงานที่อ้างสถานีตรง ๆ';
comment on column public.production_records.input_qty is
  'ยอดที่ต้องการ (เดิมเรียก "ยอดตั้งต้น") — เปลี่ยนเฉพาะชื่อที่แสดงบนจอ ไม่เปลี่ยนชื่อคอลัมน์';
comment on column public.production_records.input_unit is
  'หน่วยของยอดที่ต้องการ (กล่อง/แผง/kg./ซอง) — แยกช่องต่อยอด เพราะบางสถานีนับคนละหน่วยกัน';

create index if not exists idx_production_records_route
  on public.production_records (job_route_id);

-- ------------------------------------------------------------
-- (3) inprocess_checks — ผูกกับแถวบันทึกผลผลิตที่ตรวจ
--     on delete set null: ลบบันทึกผลผลิตแล้วผลตรวจยังอยู่ (ALCOA) แค่ขาดขาผูก
-- ------------------------------------------------------------
alter table public.inprocess_checks
  add column if not exists production_record_id uuid
    references public.production_records(id) on delete set null,
  add column if not exists job_route_id uuid references public.job_routes(id);

comment on column public.inprocess_checks.production_record_id is
  'แถวบันทึกผลผลิตที่ผลตรวจนี้ตรวจอยู่ (Part C.3) — ใช้แสดงสถานะ QC รายแถวในตารางบันทึกผลผลิต';

create index if not exists idx_inprocess_checks_record
  on public.inprocess_checks (production_record_id);

-- ------------------------------------------------------------
-- (4) add_production_record — รับ job_route_id + กะ/ช่วงเวลา/นาที/หน่วย
--     บอดี้ยกมาจาก 0062 ทั้งดุ้น แก้เฉพาะส่วนพารามิเตอร์/insert/ด่าน
--
--     ⚠️ signature เปลี่ยน → ต้อง drop ตัวเดิมก่อน ไม่งั้นเป็น overload ซ้อน
-- ------------------------------------------------------------
drop function if exists public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer
);

create or replace function public.add_production_record(
  p_job_id       uuid,
  p_job_route_id uuid,
  p_input        numeric,
  p_output       numeric,
  p_loss         numeric     default 0,
  p_minutes      numeric     default null,
  p_record_date  date        default current_date,
  p_note         text        default null,
  p_client_id    uuid        default null,
  p_machine_id   uuid        default null,
  p_headcount    integer     default null,
  p_shift        work_shift  default null,
  p_period       work_period default null,
  p_input_unit   text        default null,
  p_output_unit  text        default null,
  p_loss_unit    text        default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile    uuid;
  v_status     job_status;
  v_loss       numeric := coalesce(p_loss, 0);
  v_id         uuid;
  v_mc         record;
  v_station_id uuid;
  v_st_name    text;
  v_route_job  uuid;
  v_mc_count   int;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  if not (public.has_role('production')
          or public.has_role('production_lead')
          or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณบันทึกผลผลิตไม่ได้ (เฉพาะฝ่ายผลิต/ผู้บริหาร)';
  end if;

  -- idempotency
  if p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  select status into v_status from public.jobs where id = p_job_id for update;
  if v_status is null then raise exception 'ไม่พบงานนี้'; end if;
  if v_status <> 'in_production' then
    raise exception 'บันทึกผลผลิตได้เฉพาะงานที่กำลังผลิตอยู่ (สถานะปัจจุบัน: %)', v_status;
  end if;

  -- ขั้นตอน → สถานี (station_id มาจาก route ไม่ให้ผู้ใช้เลือกเองแล้ว)
  if p_job_route_id is null then raise exception 'กรุณาเลือกขั้นตอนการผลิต'; end if;
  select jr.job_id, jr.station_id, s.name
    into v_route_job, v_station_id, v_st_name
    from public.job_routes jr
    join public.stations s on s.id = jr.station_id
   where jr.id = p_job_route_id;
  if v_station_id is null then raise exception 'ไม่พบขั้นตอนการผลิตที่เลือก'; end if;
  if v_route_job <> p_job_id then
    raise exception 'ขั้นตอนการผลิตนี้ไม่ใช่ของงานที่เลือก';
  end if;

  -- เครื่องจักร (ถ้าระบุ)
  if p_machine_id is not null then
    select id, code, status, is_active into v_mc
      from public.machines where id = p_machine_id;
    if v_mc.id is null then raise exception 'ไม่พบเครื่องจักรที่เลือก'; end if;
    if not v_mc.is_active then raise exception 'เครื่อง % ถูกปิดใช้งานแล้ว เลือกไม่ได้', v_mc.code; end if;
    if v_mc.status in ('maintenance', 'calibration_due') then
      raise exception 'เครื่อง % อยู่สถานะซ่อม/ถึงกำหนดสอบเทียบ — เริ่มงานบนเครื่องนี้ไม่ได้', v_mc.code;
    end if;
    if not exists (
      select 1 from public.job_route_machines
       where job_route_id = p_job_route_id and machine_id = p_machine_id
    ) then
      raise exception 'เครื่อง % ไม่ได้ถูกเลือกไว้ในขั้นตอนนี้', v_mc.code;
    end if;
  end if;

  -- ---------- GATE Line Clearance (0062) — กั้นรายสถานี/เครื่อง ----------
  select count(*) into v_mc_count
    from public.job_route_machines where job_route_id = p_job_route_id;

  -- ไม่มีเครื่องผูกไว้เลย = ทำ LC ไม่ได้ → ไม่กั้น (กันล็อกตายจนบันทึกอะไรไม่ได้)
  if v_mc_count > 0 then
    if p_machine_id is not null then
      if not public.line_clearance_passed(p_job_route_id, p_machine_id) then
        raise exception
          'บันทึกผลผลิตไม่ได้ — เครื่อง % ที่สถานี "%" ยังไม่ผ่าน Line Clearance (ต้องมีหัวหน้าฝ่ายผลิตยืนยัน)',
          v_mc.code, v_st_name;
      end if;
    elsif not exists (
      select 1
        from public.job_route_machines jrm
       where jrm.job_route_id = p_job_route_id
         and public.line_clearance_passed(p_job_route_id, jrm.machine_id)
    ) then
      raise exception
        'บันทึกผลผลิตไม่ได้ — สถานี "%" ยังไม่มีเครื่องไหนผ่าน Line Clearance เลย', v_st_name;
    end if;
  end if;

  -- validation
  if p_input is null or p_input < 0 then
    raise exception 'ยอดที่ต้องการจำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if p_output is null or p_output < 0 then
    raise exception 'ยอดผลิตได้ (output) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if v_loss < 0 then raise exception 'ของเสีย (loss) ห้ามติดลบ'; end if;
  if p_minutes is not null and (p_minutes < 0 or p_minutes > 1440) then
    raise exception 'นาทีทำงานต้องอยู่ระหว่าง 0–1440 (24 ชั่วโมง)';
  end if;
  if p_headcount is not null and p_headcount < 1 then
    raise exception 'จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
  end if;
  if p_output > p_input then
    raise exception 'ยอดผลิตได้ (%) มากกว่ายอดที่ต้องการ (%) ไม่ได้', p_output, p_input;
  end if;
  if (p_output + v_loss) > p_input then
    raise exception 'ผลิตได้ + ของเสีย (%) มากกว่ายอดที่ต้องการ (%) ไม่ได้', (p_output + v_loss), p_input;
  end if;
  if p_record_date > current_date then
    raise exception 'วันที่บันทึกเป็นวันในอนาคตไม่ได้';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกผลผลิต ' || v_st_name, true);

  insert into public.production_records
    (job_id, job_route_id, station_id, record_date,
     input_qty, output_qty, loss_qty, minutes,
     input_unit, output_unit, loss_unit, shift, work_period,
     operator_id, note, created_by, client_id, machine_id, headcount)
  values
    (p_job_id, p_job_route_id, v_station_id, p_record_date,
     p_input, p_output, v_loss, p_minutes,
     nullif(btrim(coalesce(p_input_unit, '')), ''),
     nullif(btrim(coalesce(p_output_unit, '')), ''),
     nullif(btrim(coalesce(p_loss_unit, '')), ''),
     p_shift, p_period,
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile, p_client_id,
     p_machine_id, p_headcount)
  on conflict (client_id) do nothing
  returning id into v_id;

  if v_id is null and p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) from public;
revoke execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) from anon;
grant execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) to authenticated;

comment on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) is
  'บันทึกผลผลิตรายวัน (ฝ่ายผลิต) — Part C.3 ก้อน 5: รับขั้นตอน (job_route_id) แทนสถานี · นาทีแทนชั่วโมง · กะ/ช่วงเวลา/หน่วยรายช่อง · คงด่าน Line Clearance + เครื่องจักร';

-- ------------------------------------------------------------
-- (5) add_inprocess_check — เพิ่ม p_production_record_id + p_job_route_id
--     บอดี้ยกมาจาก 0059 ทั้งดุ้น
-- ------------------------------------------------------------
drop function if exists public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text
);

create or replace function public.add_inprocess_check(
  p_job_id               uuid,
  p_job_route_id         uuid,
  p_param                text,
  p_value                text         default null,
  p_unit                 text         default null,
  p_result               check_result default 'pass',
  p_note                 text         default null,
  p_production_record_id uuid         default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile    uuid;
  v_id         uuid;
  v_status     job_status;
  v_station_id uuid;
  v_route_job  uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('qc') or public.has_role('qc_lead') or public.has_role('manager')) then
    raise exception 'เฉพาะ QC/หัวหน้า QC/ผู้บริหารบันทึกผลตรวจระหว่างผลิตได้';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานที่เลือก'; end if;
  if v_status not in ('in_production', 'qc', 'qa') then
    raise exception 'บันทึกตรวจระหว่างผลิตได้เฉพาะงานที่กำลังผลิต/QC/QA';
  end if;

  p_param := nullif(btrim(coalesce(p_param, '')), '');
  if p_param is null then raise exception 'กรุณาระบุหัวข้อที่ตรวจ'; end if;
  if p_job_route_id is null then raise exception 'กรุณาเลือกขั้นตอนการผลิต'; end if;

  select job_id, station_id into v_route_job, v_station_id
    from public.job_routes where id = p_job_route_id;
  if v_station_id is null then raise exception 'ไม่พบขั้นตอนการผลิตที่เลือก'; end if;
  if v_route_job <> p_job_id then
    raise exception 'ขั้นตอนการผลิตนี้ไม่ใช่ของงานที่เลือก';
  end if;

  -- แถวบันทึกผลผลิตที่จะตรวจ (ถ้าระบุ) ต้องเป็นของขั้นตอนเดียวกัน
  if p_production_record_id is not null
     and not exists (
       select 1 from public.production_records
        where id = p_production_record_id
          and job_id = p_job_id
          and (job_route_id = p_job_route_id or station_id = v_station_id)
     ) then
    raise exception 'บันทึกผลผลิตที่เลือกไม่ได้อยู่ในขั้นตอนนี้';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกตรวจระหว่างผลิต ' || p_param, true);

  insert into public.inprocess_checks
    (job_id, job_route_id, station_id, production_record_id,
     param, value, unit, result, checked_by, note, created_by)
  values
    (p_job_id, p_job_route_id, v_station_id, p_production_record_id, p_param,
     nullif(btrim(coalesce(p_value, '')), ''),
     nullif(btrim(coalesce(p_unit, '')), ''),
     coalesce(p_result, 'pass'), v_profile,
     nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid
) from public;
revoke execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid
) from anon;
grant execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid
) to authenticated;

comment on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid
) is
  'บันทึกผลตรวจ in-process (QC) — Part C.3 ก้อน 5: รับขั้นตอน (job_route_id) แทนสถานี + ผูกกับแถวบันทึกผลผลิตที่ตรวจ';

-- ------------------------------------------------------------
-- (6) request_edit / review_edit_request — whitelist ตามคอลัมน์ใหม่
--     บอดี้ยกมาจาก 0059 แก้เฉพาะรายชื่อฟิลด์
--     🚨 คงโครง if / elsif / else raise ไว้เป๊ะ (บทเรียน Part C.2)
-- ------------------------------------------------------------
create or replace function public.request_edit(
  p_target_type edit_target_type,
  p_target_id   uuid,
  p_changes     jsonb,
  p_reason      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile    uuid;
  v_job        uuid;
  v_job_no     text;
  v_reason     text;
  v_id         uuid;
  v_allowed    text[];
  v_key        text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'กรุณาระบุเหตุผลการขอแก้ไข'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'ไม่มีรายการที่จะแก้ไข';
  end if;

  if p_target_type = 'production_record' then
    v_allowed := array['input_qty','output_qty','loss_qty','minutes','headcount','note',
                       'record_date','station_id','machine_id',
                       'input_unit','output_unit','loss_unit','shift','work_period'];
    select job_id into v_job from public.production_records where id = p_target_id;
  elsif p_target_type = 'material_requisition' then
    raise exception 'ระบบเบิกวัตถุดิบแบบเดิมถูกยกเลิกแล้ว — แก้รายการเบิกได้ที่หน้างานโดยตรง';
  else -- inprocess_check
    v_allowed := array['param','value','unit','result','note','station_id'];
    select job_id into v_job from public.inprocess_checks where id = p_target_id;
  end if;
  if v_job is null then raise exception 'ไม่พบรายการที่จะขอแก้ไข'; end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'ฟิลด์ "%" แก้ไขไม่ได้', v_key;
    end if;
  end loop;

  if exists (
    select 1 from public.edit_requests
    where target_type = p_target_type and target_id = p_target_id and status = 'pending'
  ) then
    raise exception 'มีคำขอแก้ไขรายการนี้ที่รออนุมัติอยู่แล้ว';
  end if;

  select job_no into v_job_no from public.jobs where id = v_job;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ยื่นคำขอแก้ไขย้อนหลัง', true);

  insert into public.edit_requests
    (target_type, target_id, job_id, changes, reason, requested_by, created_by)
  values
    (p_target_type, p_target_id, v_job, p_changes, v_reason, v_profile, v_profile)
  returning id into v_id;

  perform public.create_notification(
    'edit_request',
    'คำขอแก้ไขย้อนหลัง — งาน ' || coalesce(v_job_no, ''),
    v_reason, v_job, v_job_no, 'manager'::app_role, null::job_status);
  if p_target_type = 'inprocess_check' then
    perform public.create_notification(
      'edit_request',
      'คำขอแก้ไขผลตรวจ QC — งาน ' || coalesce(v_job_no, ''),
      v_reason, v_job, v_job_no, 'qa'::app_role, null::job_status);
  end if;

  return v_id;
end;
$fn$;

create or replace function public.review_edit_request(
  p_id       uuid,
  p_decision text,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_req     public.edit_requests%rowtype;
  v_note    text;
  v_job_no  text;
  v_in      numeric;
  v_out     numeric;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  select * into v_req from public.edit_requests where id = p_id for update;
  if not found then raise exception 'ไม่พบคำขอแก้ไข'; end if;
  if v_req.status <> 'pending' then raise exception 'คำขอนี้ถูกดำเนินการไปแล้ว'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'คำสั่งไม่ถูกต้อง'; end if;

  if not (public.has_role('manager')
          or (v_req.target_type = 'inprocess_check' and public.has_role('qa'))) then
    raise exception 'สิทธิ์ของคุณอนุมัติคำขอนี้ไม่ได้';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  select job_no into v_job_no from public.jobs where id = v_req.job_id;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_decision = 'reject' then
    perform set_config('app.audit_reason', 'ปฏิเสธคำขอแก้ไข', true);
    update public.edit_requests
       set status = 'rejected', reviewed_by = v_profile, reviewed_at = now(),
           review_note = v_note, updated_by = v_profile
     where id = p_id;
    perform public.create_notification(
      'edit_reviewed', 'คำขอแก้ไขถูกปฏิเสธ',
      coalesce(v_note, 'ไม่ระบุเหตุผล'), v_req.job_id, v_job_no, null::app_role, null::job_status);
    return;
  end if;

  perform set_config('app.audit_reason', 'แก้ไขย้อนหลังตามคำขอที่อนุมัติ', true);

  if v_req.target_type = 'production_record' then
    update public.production_records set
      input_qty   = case when v_req.changes ? 'input_qty'   then (v_req.changes->>'input_qty')::numeric   else input_qty   end,
      output_qty  = case when v_req.changes ? 'output_qty'  then (v_req.changes->>'output_qty')::numeric  else output_qty  end,
      loss_qty    = case when v_req.changes ? 'loss_qty'    then (v_req.changes->>'loss_qty')::numeric    else loss_qty    end,
      minutes     = case when v_req.changes ? 'minutes'     then (v_req.changes->>'minutes')::numeric     else minutes     end,
      headcount   = case when v_req.changes ? 'headcount'   then (v_req.changes->>'headcount')::integer   else headcount   end,
      note        = case when v_req.changes ? 'note'        then nullif(btrim(v_req.changes->>'note'), '') else note        end,
      record_date = case when v_req.changes ? 'record_date' then (v_req.changes->>'record_date')::date    else record_date end,
      station_id  = case when v_req.changes ? 'station_id'  then (v_req.changes->>'station_id')::uuid      else station_id end,
      machine_id  = case when v_req.changes ? 'machine_id'  then nullif(v_req.changes->>'machine_id', '')::uuid  else machine_id  end,
      input_unit  = case when v_req.changes ? 'input_unit'  then nullif(btrim(v_req.changes->>'input_unit'), '')  else input_unit  end,
      output_unit = case when v_req.changes ? 'output_unit' then nullif(btrim(v_req.changes->>'output_unit'), '') else output_unit end,
      loss_unit   = case when v_req.changes ? 'loss_unit'   then nullif(btrim(v_req.changes->>'loss_unit'), '')   else loss_unit   end,
      shift       = case when v_req.changes ? 'shift'       then nullif(v_req.changes->>'shift', '')::work_shift  else shift       end,
      work_period = case when v_req.changes ? 'work_period' then nullif(v_req.changes->>'work_period', '')::work_period else work_period end,
      updated_by  = v_profile
    where id = v_req.target_id;
    select input_qty, output_qty into v_in, v_out
    from public.production_records where id = v_req.target_id;
    if v_in is not null and v_out is not null and v_out > v_in then
      raise exception 'แก้ไม่ได้ — ผลิตได้ต้องไม่เกินยอดที่ต้องการ';
    end if;

  elsif v_req.target_type = 'inprocess_check' then
    update public.inprocess_checks set
      param      = case when v_req.changes ? 'param'  then nullif(btrim(v_req.changes->>'param'), '') else param  end,
      value      = case when v_req.changes ? 'value'  then nullif(btrim(v_req.changes->>'value'), '') else value  end,
      unit       = case when v_req.changes ? 'unit'   then nullif(btrim(v_req.changes->>'unit'), '')  else unit   end,
      result     = case when v_req.changes ? 'result' then (v_req.changes->>'result')::check_result   else result end,
      note       = case when v_req.changes ? 'note'   then nullif(btrim(v_req.changes->>'note'), '')  else note   end,
      station_id = case when v_req.changes ? 'station_id' then (v_req.changes->>'station_id')::uuid    else station_id end,
      updated_by = v_profile
    where id = v_req.target_id;

  else
    raise exception 'คำขอชนิดนี้เลิกใช้แล้ว อนุมัติไม่ได้ — กดปฏิเสธเพื่อปิดคำขอแทน';
  end if;

  update public.edit_requests
     set status = 'applied', reviewed_by = v_profile, reviewed_at = now(),
         review_note = v_note, updated_by = v_profile
   where id = p_id;

  perform public.create_notification(
    'edit_reviewed', 'คำขอแก้ไขได้รับอนุมัติ',
    'ข้อมูลถูกแก้ไขตามคำขอแล้ว', v_req.job_id, v_job_no, null::app_role, null::job_status);
end;
$fn$;

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้)
-- ------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_name = 'production_records'
--    and column_name in ('minutes','job_route_id','shift','work_period','input_unit','output_unit','loss_unit');
--                                                     -- ต้องได้ครบ 7 แถว
-- select column_name from information_schema.columns
--  where table_name = 'production_records' and column_name = 'hours';   -- ต้องได้ 0 แถว
-- select unnest(enum_range(null::work_shift));        -- morning, night
-- select unnest(enum_range(null::work_period));       -- normal, ot
-- select proname, count(*) from pg_proc
--  where proname in ('add_production_record','add_inprocess_check') group by proname;  -- ต้องได้ 1 ทั้งคู่
-- ============================================================
