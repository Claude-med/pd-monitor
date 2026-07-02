-- ============================================================
-- PD Monitor — 0037_recipe_station_bom.sql  (ข้อ 5: ผูกสูตรกับบันทึกผลิต + เบิกตาม BOM)
--   (ก) บันทึกผลผลิตเลือก "สถานีย่อยตาม route" แทน 4 กลุ่มกว้าง
--       - production_records.station_id (FK stations) ควบ enum station เดิม (คง dashboard rollup)
--       - add_production_record รับ p_station_id → lookup station_group → set ทั้ง station_id + station(enum)
--         (แพตเทิร์นเดียวกับ add_inprocess_check · ห้ามแตะ enum production_station)
--       - request_edit/review_edit_request: production_record แก้ station_id ได้ (set enum group ควบ)
--   (ข) เบิกตาม BOM = ทำที่ UI/data layer (กรอง dropdown เฉพาะวัตถุดิบใน recipe) — ไม่ต้องแก้ DB
-- รัน "หลัง" 0001–0036
-- ============================================================

-- ------------------------------------------------------------
-- (ก1) production_records.station_id — สถานีย่อย (nullable: แถวเก่า = null)
-- ------------------------------------------------------------
alter table public.production_records
  add column if not exists station_id uuid references public.stations(id);

create index if not exists idx_production_records_station on public.production_records(station_id);

-- ------------------------------------------------------------
-- (ก2) add_production_record — รับ p_station_id (แทน enum ตรงๆ)
--   drop signature เดิม (รับ production_station) กัน overload กำกวม
--   คง guard สถานะ in_production (B3) + machine + validation + idempotency + headcount เดิมครบ
-- ------------------------------------------------------------
drop function if exists public.add_production_record(
  uuid, production_station, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer
);

create or replace function public.add_production_record(
  p_job_id      uuid,
  p_station_id  uuid,
  p_input       numeric,
  p_output      numeric,
  p_loss        numeric default 0,
  p_hours       numeric default null,
  p_record_date date    default current_date,
  p_note        text    default null,
  p_client_id   uuid    default null,
  p_machine_id  uuid    default null,
  p_headcount   integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_status  job_status;
  v_loss    numeric := coalesce(p_loss, 0);
  v_id      uuid;
  v_mc      record;
  v_group   production_station;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  if not (public.has_role('production') or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณบันทึกผลผลิตไม่ได้ (เฉพาะฝ่ายผลิต/ผู้บริหาร)';
  end if;

  -- idempotency
  if p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  -- งาน + guard สถานะ (B3: เฉพาะกำลังผลิตเท่านั้น)
  select status into v_status from public.jobs where id = p_job_id for update;
  if v_status is null then raise exception 'ไม่พบงานนี้'; end if;
  if v_status <> 'in_production' then
    raise exception 'บันทึกผลผลิตได้เฉพาะงานที่กำลังผลิตอยู่ (สถานะปัจจุบัน: %)', v_status;
  end if;

  -- สถานีย่อย → ดึงกลุ่มหลัก (enum) มา set ควบ (คง dashboard/รายงาน)
  if p_station_id is null then raise exception 'กรุณาเลือกสถานี'; end if;
  select station_group into v_group from public.stations where id = p_station_id;
  if v_group is null then raise exception 'ไม่พบสถานีที่เลือก'; end if;

  -- เครื่องจักร (ถ้าระบุ)
  if p_machine_id is not null then
    select id, code, status, is_active into v_mc
      from public.machines where id = p_machine_id;
    if v_mc.id is null then raise exception 'ไม่พบเครื่องจักรที่เลือก'; end if;
    if not v_mc.is_active then raise exception 'เครื่อง % ถูกปิดใช้งานแล้ว เลือกไม่ได้', v_mc.code; end if;
    if v_mc.status in ('maintenance', 'calibration_due') then
      raise exception 'เครื่อง % อยู่สถานะซ่อม/ถึงกำหนดสอบเทียบ — เริ่มงานบนเครื่องนี้ไม่ได้', v_mc.code;
    end if;
  end if;

  -- validation
  if p_input is null or p_input < 0 then
    raise exception 'ยอดตั้งต้น (input) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if p_output is null or p_output < 0 then
    raise exception 'ยอดผลิตได้ (output) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if v_loss < 0 then raise exception 'ของเสีย (loss) ห้ามติดลบ'; end if;
  if p_hours is not null and (p_hours < 0 or p_hours > 24) then
    raise exception 'ชั่วโมงทำงานต้องอยู่ระหว่าง 0–24';
  end if;
  if p_headcount is not null and p_headcount < 1 then
    raise exception 'จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
  end if;
  if p_output > p_input then
    raise exception 'ยอดผลิตได้ (%) มากกว่ายอดตั้งต้น (%) ไม่ได้', p_output, p_input;
  end if;
  if (p_output + v_loss) > p_input then
    raise exception 'ผลิตได้ + ของเสีย (%) มากกว่ายอดตั้งต้น (%) ไม่ได้', (p_output + v_loss), p_input;
  end if;
  if p_record_date > current_date then
    raise exception 'วันที่บันทึกเป็นวันในอนาคตไม่ได้';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกผลผลิต ' || v_group::text, true);

  insert into public.production_records
    (job_id, station, station_id, record_date, input_qty, output_qty, loss_qty, hours,
     operator_id, note, created_by, client_id, machine_id, headcount)
  values
    (p_job_id, v_group, p_station_id, p_record_date, p_input, p_output, v_loss, p_hours,
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile, p_client_id,
     p_machine_id, p_headcount)
  on conflict (client_id) do nothing
  returning id into v_id;

  if v_id is null and p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer
) to authenticated;

-- ------------------------------------------------------------
-- (ก3) request_edit — production_record เพิ่ม 'station_id' ใน whitelist
--   (คง 'station' enum เดิมไว้ backward · คง inprocess station_id (0036) · guard ใบเบิก issued (0034))
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
as $$
declare
  v_profile    uuid;
  v_job        uuid;
  v_job_no     text;
  v_reason     text;
  v_id         uuid;
  v_allowed    text[];
  v_key        text;
  v_req_status requisition_status;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'กรุณาระบุเหตุผลการขอแก้ไข'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'ไม่มีรายการที่จะแก้ไข';
  end if;

  if p_target_type = 'production_record' then
    v_allowed := array['input_qty','output_qty','loss_qty','hours','headcount','note','record_date','station','station_id','machine_id'];
    select job_id into v_job from public.production_records where id = p_target_id;
  elsif p_target_type = 'material_requisition' then
    v_allowed := array['qty','note'];
    select job_id, status into v_job, v_req_status from public.material_requisitions where id = p_target_id;
    if v_req_status = 'issued' then
      raise exception 'ใบเบิกที่จ่ายแล้ว (issued) แก้ไขไม่ได้';
    end if;
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
$$;

grant execute on function public.request_edit(edit_target_type, uuid, jsonb, text) to authenticated;

-- ------------------------------------------------------------
-- (ก4) review_edit_request — production branch รองรับ station_id (set station(group) ควบ)
--   (คง inprocess station_id (0036) · material_requisition · reject เดิม)
-- ------------------------------------------------------------
create or replace function public.review_edit_request(
  p_id       uuid,
  p_decision text,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  -- ---------- ปฏิเสธ ----------
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

  -- ---------- อนุมัติ → apply UPDATE จริง (audit_log trigger เก็บ old→new) ----------
  perform set_config('app.audit_reason', 'แก้ไขย้อนหลังตามคำขอที่อนุมัติ', true);

  if v_req.target_type = 'production_record' then
    update public.production_records set
      input_qty   = case when v_req.changes ? 'input_qty'   then (v_req.changes->>'input_qty')::numeric   else input_qty   end,
      output_qty  = case when v_req.changes ? 'output_qty'  then (v_req.changes->>'output_qty')::numeric  else output_qty  end,
      loss_qty    = case when v_req.changes ? 'loss_qty'    then (v_req.changes->>'loss_qty')::numeric    else loss_qty    end,
      hours       = case when v_req.changes ? 'hours'       then (v_req.changes->>'hours')::numeric       else hours       end,
      headcount   = case when v_req.changes ? 'headcount'   then (v_req.changes->>'headcount')::integer   else headcount   end,
      note        = case when v_req.changes ? 'note'        then nullif(btrim(v_req.changes->>'note'), '') else note        end,
      record_date = case when v_req.changes ? 'record_date' then (v_req.changes->>'record_date')::date    else record_date end,
      station_id  = case when v_req.changes ? 'station_id'  then (v_req.changes->>'station_id')::uuid      else station_id end,
      -- station(enum group): มาจาก station_id ใหม่ (ถ้าแก้) · หรือ station enum ตรงๆ (backward) · หรือคงเดิม
      station     = case
                      when v_req.changes ? 'station_id'
                        then (select s.station_group from public.stations s
                               where s.id = (v_req.changes->>'station_id')::uuid)
                      when v_req.changes ? 'station'
                        then (v_req.changes->>'station')::production_station
                      else station
                    end,
      machine_id  = case when v_req.changes ? 'machine_id'  then nullif(v_req.changes->>'machine_id', '')::uuid  else machine_id  end,
      updated_by  = v_profile
    where id = v_req.target_id;
    select input_qty, output_qty into v_in, v_out
    from public.production_records where id = v_req.target_id;
    if v_in is not null and v_out is not null and v_out > v_in then
      raise exception 'แก้ไม่ได้ — ผลิตได้ต้องไม่เกินจำนวนตั้งต้น';
    end if;

  elsif v_req.target_type = 'material_requisition' then
    update public.material_requisitions set
      qty        = case when v_req.changes ? 'qty'  then (v_req.changes->>'qty')::numeric        else qty  end,
      note       = case when v_req.changes ? 'note' then nullif(btrim(v_req.changes->>'note'), '') else note end,
      updated_by = v_profile
    where id = v_req.target_id;

  else -- inprocess_check (station_id + set station(group) ควบ)
    update public.inprocess_checks set
      param      = case when v_req.changes ? 'param'  then nullif(btrim(v_req.changes->>'param'), '') else param  end,
      value      = case when v_req.changes ? 'value'  then nullif(btrim(v_req.changes->>'value'), '') else value  end,
      unit       = case when v_req.changes ? 'unit'   then nullif(btrim(v_req.changes->>'unit'), '')  else unit   end,
      result     = case when v_req.changes ? 'result' then (v_req.changes->>'result')::check_result   else result end,
      note       = case when v_req.changes ? 'note'   then nullif(btrim(v_req.changes->>'note'), '')  else note   end,
      station_id = case when v_req.changes ? 'station_id' then (v_req.changes->>'station_id')::uuid    else station_id end,
      station    = case when v_req.changes ? 'station_id'
                        then (select s.station_group from public.stations s
                               where s.id = (v_req.changes->>'station_id')::uuid)
                        else station end,
      updated_by = v_profile
    where id = v_req.target_id;
  end if;

  update public.edit_requests
     set status = 'applied', reviewed_by = v_profile, reviewed_at = now(),
         review_note = v_note, updated_by = v_profile
   where id = p_id;

  perform public.create_notification(
    'edit_reviewed', 'คำขอแก้ไขได้รับอนุมัติ',
    'ข้อมูลถูกแก้ไขตามคำขอแล้ว', v_req.job_id, v_job_no, null::app_role, null::job_status);
end;
$$;

grant execute on function public.review_edit_request(uuid, text, text) to authenticated;
