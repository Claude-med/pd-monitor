-- ============================================================
-- PD Monitor — Part A / 0039_part_a_roles_machine_room.sql
-- ใช้งาน role ใหม่จาก 0038 + เพิ่มช่อง "ห้อง" ให้เครื่องจักร (feedback ทีม Part A)
--
--   A1 · planner (PLN)     → สร้างงานผลิต + เพิ่มยาใหม่ + กด "ยืนยันแผนผลิต"
--   A1 · cost (COST)       → ดูต้นทุนค่าแรง (คุมที่ฝั่งแอปอย่างเดียว ไม่มี guard ใน DB — เป็นการอ่านล้วน)
--   A2 · engineering (ENG) → กำหนดซ่อมบำรุง / สอบเทียบเครื่องจักร
--   A2 · production        → เพิ่ม/แก้เครื่องจักรได้ (แต่แก้ "กำหนดซ่อม/สอบเทียบ" ไม่ได้)
--   A2 · machines.room     → ช่อง "ห้อง" (text)
--
-- ⚠️ ต้องรัน 0038_roles_add_values.sql ให้ผ่านก่อน (คนละรอบ paste)
-- ⚠️ ไม่แตะ enum · ไม่แตะ RLS (เขียนทุกอย่างผ่าน RPC security definer อยู่แล้ว)
-- รัน "หลัง" 0001–0038
-- ============================================================

-- ------------------------------------------------------------
-- (1) machines.room — ห้องที่ติดตั้งเครื่อง
-- ------------------------------------------------------------
alter table public.machines add column if not exists room text;

-- ------------------------------------------------------------
-- (2) helper สิทธิ์ (แพตเทิร์นเดียวกับ can_manage_materials/can_manage_fg)
--     หมายเหตุ: has_role() ของ 0013 ให้ admin ผ่านทุก role อยู่แล้ว → ไม่ต้องเขียน admin ซ้ำ
-- ------------------------------------------------------------

-- เพิ่ม/แก้ทะเบียนเครื่องจักร = ฝ่ายผลิต · วิศวกรรม · ผู้บริหาร
create or replace function public.can_manage_machines()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('production')
      or public.has_role('engineering')
      or public.has_role('manager');
$$;

grant execute on function public.can_manage_machines() to authenticated;

-- ตั้ง "กำหนดซ่อมบำรุง / สอบเทียบ" = วิศวกรรม · ผู้บริหาร เท่านั้น (GMP: คนคุมแผนต้องเป็นวิศวกรรม)
create or replace function public.can_set_machine_schedule()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('engineering') or public.has_role('manager');
$$;

grant execute on function public.can_set_machine_schedule() to authenticated;

-- สร้างงานผลิต / เพิ่มยา / ยืนยันแผน = ฝ่ายวางแผน · ผู้บริหาร
create or replace function public.can_plan_jobs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('planner') or public.has_role('manager');
$$;

grant execute on function public.can_plan_jobs() to authenticated;

-- ------------------------------------------------------------
-- (3) upsert_machine — เพิ่มพารามิเตอร์ p_room + สิทธิ์ใหม่ + field-level guard
--     ⚠️ เพิ่มพารามิเตอร์ = signature ใหม่ → ต้อง drop ตัวเก่าก่อน ไม่งั้นจะเป็น overload ซ้อนกัน 2 ตัว
-- ------------------------------------------------------------
drop function if exists public.upsert_machine(
  uuid, text, text, production_station, machine_status, text, date, date, date
);

create or replace function public.upsert_machine(
  p_id                    uuid,
  p_code                  text,
  p_name                  text,
  p_station               production_station default null,
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
as $$
declare
  v_profile   uuid;
  v_id        uuid;
  v_can_sched boolean;
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

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    -- เพิ่มใหม่
    if exists (select 1 from public.machines where code = p_code) then
      raise exception 'รหัสเครื่อง % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มเครื่องจักร ' || p_code, true);

    insert into public.machines
      (code, name, station, room, status, note,
       last_clean_date, next_maintenance_date, next_calibration_date, created_by)
    values
      (p_code, p_name, p_station,
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
           station = p_station,
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
$$;

grant execute on function public.upsert_machine(
  uuid, text, text, production_station, machine_status, text, date, date, date, text
) to authenticated;

-- ------------------------------------------------------------
-- (4) create_product — ฝ่ายวางแผนเพิ่มยาใหม่ได้ (body เดิมของ 0011 · แก้เฉพาะ guard)
-- ------------------------------------------------------------
create or replace function public.create_product(
  p_code               text,
  p_name               text,
  p_dosage_form        text    default null,
  p_standard_time_hours numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารเพิ่มผลิตภัณฑ์ได้';
  end if;

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  if p_code = '' then raise exception 'กรุณาระบุรหัสยา (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อยา'; end if;
  if exists (select 1 from public.products where code = p_code) then
    raise exception 'รหัสยา % มีอยู่แล้ว', p_code;
  end if;
  if p_standard_time_hours is not null and p_standard_time_hours < 0 then
    raise exception 'เวลามาตรฐาน (ชม.) ห้ามติดลบ';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'เพิ่มผลิตภัณฑ์ ' || p_code, true);

  insert into public.products (code, name, dosage_form, standard_time_hours, created_by)
  values (p_code, p_name, nullif(btrim(coalesce(p_dosage_form, '')), ''),
          p_standard_time_hours, v_profile)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_product(text, text, text, numeric) to authenticated;

-- ------------------------------------------------------------
-- (5) create_job_with_order — ฝ่ายวางแผนสร้างงานได้
--     body = ของ 0034 ทั้งดุ้น (ออกเลขงานอัตโนมัติ + ผูกสูตร active + copy job_routes) · แก้เฉพาะ guard
-- ------------------------------------------------------------
create or replace function public.create_job_with_order(
  p_customer      text,
  p_product_id    uuid,
  p_quantity      numeric,
  p_unit          text,
  p_due_date      date,
  p_job_no        text,
  p_planned_start date default null,
  p_planned_end   date default null,
  p_lot_no        text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_order   uuid;
  v_batch   uuid;
  v_job     uuid;
  v_recipe  uuid;
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารสร้างงานผลิตได้';
  end if;

  -- ---------- validate ----------
  p_customer := btrim(coalesce(p_customer, ''));
  v_job_no   := btrim(coalesce(p_job_no, ''));
  if p_customer = '' then raise exception 'กรุณาระบุลูกค้า'; end if;
  if p_product_id is null then raise exception 'กรุณาเลือกผลิตภัณฑ์'; end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'จำนวนต้องมากกว่า 0';
  end if;

  -- ออกเลขงานอัตโนมัติถ้าเว้นว่าง (กันชนด้วย sequence + วน loop เผื่อชนเลขที่ใส่มือไว้)
  if v_job_no = '' then
    loop
      v_job_no := 'JOB-' || to_char(current_date, 'YYYY') || '-'
                  || lpad(nextval('public.job_no_seq')::text, 4, '0');
      exit when not exists (select 1 from public.jobs where job_no = v_job_no);
    end loop;
  else
    if exists (select 1 from public.jobs where job_no = v_job_no) then
      raise exception 'เลขงาน % มีอยู่แล้ว — กรุณาใช้เลขอื่น', v_job_no;
    end if;
  end if;

  if p_planned_start is not null and p_planned_end is not null
     and p_planned_end < p_planned_start then
    raise exception 'วันสิ้นสุดแผนต้องไม่ก่อนวันเริ่ม';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'สร้างงานผลิตใหม่ ' || v_job_no, true);

  -- ---------- order ----------
  insert into public.orders (order_no, customer, product_id, quantity, unit, due_date, created_by)
  values ('ORD-' || v_job_no, p_customer, p_product_id, p_quantity,
          coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'เม็ด'), p_due_date, v_profile)
  returning id into v_order;

  -- ---------- batch (ถ้าระบุล็อต) ----------
  if p_lot_no is not null and btrim(p_lot_no) <> '' then
    if exists (select 1 from public.batches where lot_no = btrim(p_lot_no)) then
      raise exception 'เลขล็อต % มีอยู่แล้ว', btrim(p_lot_no);
    end if;
    insert into public.batches (lot_no, order_id, product_id, created_by)
    values (btrim(p_lot_no), v_order, p_product_id, v_profile)
    returning id into v_batch;
  end if;

  -- ---------- auto เลือกสูตร active ของยา (ถ้ามี) ----------
  select id into v_recipe
  from public.product_recipes
  where product_id = p_product_id and is_active
  order by updated_at desc
  limit 1;

  -- ---------- job ----------
  insert into public.jobs
    (job_no, order_id, batch_id, recipe_id, status, planned_start, planned_end, created_by)
  values
    (v_job_no, v_order, v_batch, v_recipe, 'pending_announce', p_planned_start, p_planned_end, v_profile)
  returning id into v_job;

  -- ---------- copy route ของยา → job_routes (snapshot) ----------
  insert into public.job_routes (job_id, station_id, step_no, station_group, note, created_by)
  select v_job, pr.station_id, pr.step_no, s.station_group, pr.note, v_profile
  from public.product_routes pr
  join public.stations s on s.id = pr.station_id
  where pr.product_id = p_product_id;

  return v_job_no;
end;
$$;

grant execute on function public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text
) to authenticated;

-- ------------------------------------------------------------
-- (6) advance_job_status — ฝ่ายวางแผนกด "ยืนยันแผนผลิต" ได้ (pending_announce → planned)
--     ⚠️ body = ของ 0034 ทั้งดุ้น (GATE line clearance + in-process + deviation + บล็อกแจ้งเตือนครบ)
--        แก้บรรทัดเดียวคือสิทธิ์ของ pending_announce → planned
-- ------------------------------------------------------------
create or replace function public.advance_job_status(
  p_job_id uuid,
  p_to     job_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile   uuid;
  v_from      job_status;
  v_job_no    text;
  v_is_reject boolean := false;
  v_allowed   boolean := false;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  select status, job_no into v_from, v_job_no from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from = p_to then
    raise exception 'สถานะไม่เปลี่ยนแปลง';
  end if;

  if    v_from = 'pending_announce' and p_to = 'planned' then
    v_allowed := public.can_plan_jobs();          -- Part A: ฝ่ายวางแผน + ผู้บริหาร
  elsif v_from = 'planned'          and p_to = 'in_production' then
    v_allowed := public.has_role('production') or public.has_role('manager');
    -- GATE: ต้องผ่าน Line Clearance ก่อนเริ่มผลิต (A3)
    if v_allowed and not public.line_clearance_passed(p_job_id) then
      raise exception 'เริ่มผลิตไม่ได้ — ต้องทำ Line Clearance ให้ผ่านก่อน (เคลียร์ของเก่า/ทำความสะอาด/ตั้งเครื่อง + ผู้ตรวจรับเซ็น)';
    end if;
  elsif v_from = 'in_production'     and p_to = 'qc' then
    v_allowed := public.has_role('production');
    -- GATE: ต้องตรวจ in-process QC (ผ่าน) ตามสูตรก่อนส่ง QC (E2 · ผ่อนเป็น ≥1 สถานีใน 0034)
    if v_allowed and not public.inprocess_route_complete(p_job_id) then
      raise exception 'ส่ง QC ไม่ได้ — ต้องมีผลตรวจ in-process QC (ผ่าน) อย่างน้อย 1 สถานีในสูตรก่อน';
    end if;
  elsif v_from = 'qc'               and p_to = 'qa' then
    v_allowed := public.has_role('qc');
  elsif v_from = 'qc'               and p_to = 'in_production' then
    v_allowed := public.has_role('qc'); v_is_reject := true;
  elsif v_from = 'qa'               and p_to = 'finished_goods' then
    v_allowed := public.has_role('qa');
    -- GATE: ปล่อยผ่าน FG ไม่ได้ถ้ายังมี deviation เปิดค้าง (B3)
    if v_allowed and public.has_open_deviation(p_job_id) then
      raise exception 'ปล่อยผ่าน FG ไม่ได้ — ยังมี deviation เปิดค้าง ต้องปิด (closed) ก่อน';
    end if;
  elsif v_from = 'qa'               and p_to = 'in_production' then
    v_allowed := public.has_role('qa'); v_is_reject := true;
  else
    raise exception 'เปลี่ยนสถานะจาก "%" ไป "%" ไม่ได้ (ผิดลำดับ)', v_from, p_to;
  end if;

  if not v_allowed then
    raise exception 'สิทธิ์ของคุณไม่สามารถทำขั้นตอนนี้ได้';
  end if;

  if v_is_reject and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'การตีกลับต้องระบุเหตุผล';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config(
    'app.audit_reason',
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
             case when v_is_reject then 'ตีกลับ' else 'เปลี่ยนสถานะ' end),
    true
  );

  update public.jobs
     set status     = p_to,
         updated_by = v_profile
   where id = p_job_id;

  -- ---------- แจ้งเตือน ----------
  if v_is_reject then
    -- B4: แจ้งฝ่ายผลิตเมื่องานถูกตีกลับ (relevant = in_production → ซ่อนเมื่อส่งต่อไปแล้ว)
    perform public.create_notification(
      'reject',
      'งาน ' || v_job_no || ' ถูกตีกลับ',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ไม่ระบุเหตุผล'),
      p_job_id, v_job_no, 'production', 'in_production');
  else
    -- C1a: แจ้ง role ปลายทางว่า "งานมาถึงหน้าที่คุณแล้ว"
    if    p_to = 'planned' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ยืนยันแผนแล้ว — พร้อมเริ่มผลิต',
        null, p_job_id, v_job_no, 'production', 'planned');
    elsif p_to = 'qc' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ส่งถึง QC แล้ว',
        'รอตรวจสอบคุณภาพ (QC)', p_job_id, v_job_no, 'qc', 'qc');
    elsif p_to = 'qa' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ส่งถึง QA แล้ว',
        'รอ QA ปล่อยผ่าน', p_job_id, v_job_no, 'qa', 'qa');
    elsif p_to = 'finished_goods' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' พร้อมรับเข้าคลัง FG',
        'QA ปล่อยผ่านแล้ว — รอฝ่ายคลังรับเข้า', p_job_id, v_job_no, 'warehouse', 'finished_goods');
    end if;
  end if;
end;
$$;

grant execute on function public.advance_job_status(uuid, job_status, text) to authenticated;

-- ------------------------------------------------------------
-- (7) current_role_group — ให้ฝ่ายวิศวกรรมเขียนหมายเหตุ deviation ได้ (เครื่องจักรเสีย/ซ่อม)
--     body เดิมของ 0030 + เพิ่ม branch engineering (คอลัมน์ role_group เป็น text ไม่มี check constraint)
-- ------------------------------------------------------------
create or replace function public.current_role_group()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.has_role('production')  then 'production'
    when public.has_role('qc')          then 'qc'
    when public.has_role('qa')          then 'qa'
    when public.has_role('engineering') then 'engineering'
    when public.has_role('manager')     then 'manager'
    else null
  end;
$$;

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   select column_name from information_schema.columns
--    where table_name = 'machines' and column_name = 'room';
--   select proname, pronargs from pg_proc where proname = 'upsert_machine';   -- ต้องเหลือแถวเดียว (10)
--   select public.can_manage_machines(), public.can_set_machine_schedule(), public.can_plan_jobs();
-- ============================================================
