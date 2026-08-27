-- ============================================================
-- PD Monitor — Part C.3 ก้อน 2 / 0059_drop_station_group.sql
-- ลบ "กลุ่มหลัก" (enum production_station) ออกจากระบบทั้งชุด — ใช้สถานีจริงอย่างเดียว
--
--   (0) pre-flight — คำขอแก้ไขค้างที่มี field 'station' จะ apply ไม่ได้หลังตัด whitelist
--   (1) drop ฟังก์ชันที่มี production_station อยู่ใน "signature" (บล็อก drop type)
--   (2) drop คอลัมน์ทั้ง 5 จุด
--   (3) drop type production_station
--   (4) recreate ฟังก์ชันที่อ้าง enum ใน body — ยกบอดี้ล่าสุดมาทั้งดุ้น แก้เฉพาะส่วนสถานี
--
-- ℹ️ นี่คือขั้น "contract" ของ expand → migrate → contract — ต้องรัน "หลัง" 0058 deploy ขึ้นเว็บแล้ว
--
-- ℹ️ ทำไมต้อง drop คอลัมน์ก่อน recreate ฟังก์ชัน:
--    production_records.station / inprocess_checks.station เป็น NOT NULL ไม่มี default
--    ฟังก์ชันเวอร์ชันใหม่ไม่ส่งค่าคอลัมน์นี้ → ถ้าคอลัมน์ยังอยู่ insert จะพังทันที
--
-- 🚨 Postgres ไม่ตรวจ dependency ของ "body" plpgsql — drop type ผ่านแม้ body ยังอ้าง enum อยู่
--    แต่ฟังก์ชันจะพังตอนเรียกใช้ → ไฟล์นี้จึง recreate ให้ครบ "ทุกตัว" ในไฟล์เดียวกัน
--    ห้ามรันครึ่งไฟล์เด็ดขาด
--
-- ⚠️ แดชบอร์ด / รายงานประจำวัน / eBR เปลี่ยนจากรวมยอด 4 กลุ่ม เป็นรวมยอด 9 สถานีจริง
--    (ตัวเลขรวมเท่าเดิม แต่หน้าตาต่างไป) — ฝั่งแอปแก้มาคู่กันในคอมมิตเดียวกัน
-- รัน "หลัง" 0001–0058
-- ============================================================

-- ------------------------------------------------------------
-- (0) pre-flight
-- ------------------------------------------------------------
do $$
declare
  v_pending int;
begin
  -- คำขอแก้ไขที่ค้างอยู่และขอแก้ field 'station' (enum) จะ apply ไม่ได้หลังตัด whitelist
  select count(*) into v_pending
    from public.edit_requests
   where status = 'pending' and changes ? 'station';
  if v_pending > 0 then
    raise exception 'มีคำขอแก้ไขค้างอยู่ % รายการที่ขอแก้ "สถานี (กลุ่มหลัก)" — ต้องอนุมัติหรือปฏิเสธก่อน', v_pending;
  end if;

  raise notice 'pre-flight ผ่าน — เริ่มลบกลุ่มหลักออกจากระบบ';
end $$;

-- ------------------------------------------------------------
-- (1) drop ฟังก์ชันที่มี production_station อยู่ใน signature
--     (ตัวที่มี enum อยู่แค่ใน body ไม่บล็อก drop type — recreate ในข้อ (4))
--
--     create_job_with_order = ฟังก์ชันสร้างงานรุ่นเก่า ถูกแทนด้วย create_production_jobs (0048)
--     แอปไม่เรียกแล้ว และ body อ้าง job_routes.station_group → ลบทิ้งแทนที่จะปล่อยให้พังเงียบ
-- ------------------------------------------------------------
drop function if exists public.upsert_station(
  uuid, text, text, production_station, integer, boolean
);
drop function if exists public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text, text, text, text, text
);

-- ------------------------------------------------------------
-- (2) drop คอลัมน์ "กลุ่มหลัก" ทั้ง 5 จุด (index ที่ผูกอยู่หายตามคอลัมน์เอง)
-- ------------------------------------------------------------
alter table public.production_records drop column if exists station;
alter table public.inprocess_checks   drop column if exists station;
alter table public.machines           drop column if exists station;
alter table public.job_routes         drop column if exists station_group;
alter table public.stations           drop column if exists station_group;

-- ------------------------------------------------------------
-- (3) drop type
-- ------------------------------------------------------------
drop type if exists public.production_station;

-- ============================================================
-- (4) recreate ฟังก์ชัน — ยกบอดี้ล่าสุดมาทั้งดุ้น แก้เฉพาะส่วนที่อ้างกลุ่มหลัก
-- ============================================================

-- ------------------------------------------------------------
-- (4.1) upsert_station — ตัดพารามิเตอร์ p_group (บอดี้เดิม 0022:98-159)
-- ------------------------------------------------------------
create or replace function public.upsert_station(
  p_id        uuid,
  p_code      text,
  p_name      text,
  p_seq       integer default 100,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_stations() then
    raise exception 'เฉพาะผู้บริหารจัดการสถานีการผลิตได้';
  end if;

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  if p_code = '' then raise exception 'กรุณาระบุรหัสสถานี (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อสถานี'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    if exists (select 1 from public.stations where code = p_code) then
      raise exception 'รหัสสถานี % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มสถานี ' || p_code, true);
    insert into public.stations (code, name, seq, is_active, created_by)
    values (p_code, p_name, coalesce(p_seq, 100),
            coalesce(p_is_active, true), v_profile)
    returning id into v_id;
  else
    if not exists (select 1 from public.stations where id = p_id) then
      raise exception 'ไม่พบสถานีที่เลือก';
    end if;
    if exists (select 1 from public.stations where code = p_code and id <> p_id) then
      raise exception 'รหัสสถานี % ถูกใช้กับสถานีอื่นแล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'แก้สถานี ' || p_code, true);
    update public.stations
       set code = p_code, name = p_name,
           seq = coalesce(p_seq, seq), is_active = coalesce(p_is_active, is_active),
           updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.upsert_station(uuid, text, text, integer, boolean) from public;
revoke execute on function public.upsert_station(uuid, text, text, integer, boolean) from anon;
grant  execute on function public.upsert_station(uuid, text, text, integer, boolean) to authenticated;

comment on function public.upsert_station(uuid, text, text, integer, boolean) is
  'เพิ่ม/แก้สถานีการผลิต (ผู้บริหาร) — Part C.3 ก้อน 2: ไม่มี "กลุ่มหลัก" แล้ว ใช้ชื่อสถานีอย่างเดียว';

-- ------------------------------------------------------------
-- (4.2) upsert_machine — ตัด lookup station_group (บอดี้จาก 0058)
-- ------------------------------------------------------------
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
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_manage_machines() then
    raise exception 'เฉพาะฝ่ายผลิต/วิศวกรรม/ผู้บริหารจัดการเครื่องจักรได้';
  end if;

  v_can_sched := public.can_set_machine_schedule();

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  if p_code = '' then raise exception 'กรุณาระบุรหัสเครื่อง (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อเครื่อง'; end if;

  if p_station_id is not null
     and not exists (select 1 from public.stations where id = p_station_id) then
    raise exception 'ไม่พบสถานีที่เลือก';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    if exists (select 1 from public.machines where code = p_code) then
      raise exception 'รหัสเครื่อง % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มเครื่องจักร ' || p_code, true);

    insert into public.machines
      (code, name, station_id, room, status, note,
       last_clean_date, next_maintenance_date, next_calibration_date, created_by)
    values
      (p_code, p_name, p_station_id,
       nullif(btrim(coalesce(p_room, '')), ''),
       coalesce(p_status, 'available'),
       nullif(btrim(coalesce(p_note, '')), ''),
       p_last_clean_date,
       case when v_can_sched then p_next_maintenance_date else null end,
       case when v_can_sched then p_next_calibration_date else null end,
       v_profile)
    returning id into v_id;
  else
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

-- ------------------------------------------------------------
-- (4.3) add_production_record — ตัด station(enum) ออกจาก insert (บอดี้เดิม 0037:29-138)
--       audit reason เปลี่ยนจากชื่อกลุ่มเป็น "ชื่อสถานีจริง"
-- ------------------------------------------------------------
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
as $fn$
declare
  v_profile uuid;
  v_status  job_status;
  v_loss    numeric := coalesce(p_loss, 0);
  v_id      uuid;
  v_mc      record;
  v_st_name text;
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

  -- สถานี (ใช้สถานีจริงอย่างเดียวแล้ว — ไม่มีกลุ่มหลักให้ lookup)
  if p_station_id is null then raise exception 'กรุณาเลือกสถานี'; end if;
  select name into v_st_name from public.stations where id = p_station_id;
  if v_st_name is null then raise exception 'ไม่พบสถานีที่เลือก'; end if;

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
  perform set_config('app.audit_reason', 'บันทึกผลผลิต ' || v_st_name, true);

  insert into public.production_records
    (job_id, station_id, record_date, input_qty, output_qty, loss_qty, hours,
     operator_id, note, created_by, client_id, machine_id, headcount)
  values
    (p_job_id, p_station_id, p_record_date, p_input, p_output, v_loss, p_hours,
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

-- ------------------------------------------------------------
-- (4.4) add_inprocess_check — ตัด station(enum) (บอดี้เดิม 0032:28-87)
-- ------------------------------------------------------------
create or replace function public.add_inprocess_check(
  p_job_id     uuid,
  p_station_id uuid,
  p_param      text,
  p_value      text   default null,
  p_unit       text   default null,
  p_result     check_result default 'pass',
  p_note       text   default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_id      uuid;
  v_status  job_status;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('qc') or public.has_role('manager')) then
    raise exception 'เฉพาะ QC/ผู้บริหารบันทึกผลตรวจระหว่างผลิตได้';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานที่เลือก'; end if;
  if v_status not in ('in_production', 'qc', 'qa') then
    raise exception 'บันทึกตรวจระหว่างผลิตได้เฉพาะงานที่กำลังผลิต/QC/QA';
  end if;

  p_param := nullif(btrim(coalesce(p_param, '')), '');
  if p_param is null then raise exception 'กรุณาระบุหัวข้อที่ตรวจ'; end if;
  if p_station_id is null then raise exception 'กรุณาเลือกสถานี'; end if;

  if not exists (select 1 from public.stations where id = p_station_id) then
    raise exception 'ไม่พบสถานีที่เลือก';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกตรวจระหว่างผลิต ' || p_param, true);

  insert into public.inprocess_checks
    (job_id, station_id, param, value, unit, result, checked_by, note, created_by)
  values
    (p_job_id, p_station_id, p_param,
     nullif(btrim(coalesce(p_value, '')), ''),
     nullif(btrim(coalesce(p_unit, '')), ''),
     coalesce(p_result, 'pass'), v_profile,
     nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  return v_id;
end;
$fn$;

-- ------------------------------------------------------------
-- (4.5) create_production_jobs — job_routes ไม่มี station_group แล้ว (บอดี้เดิม 0048:145-257)
-- ------------------------------------------------------------
create or replace function public.create_production_jobs(
  p_customer_id    uuid,
  p_product_id     uuid,
  p_quantity       numeric,
  p_unit           text,
  p_due_date       date,
  p_request_no     text    default null,
  p_cpo_date       date    default null,
  p_sub_status     text    default null,
  p_pack_type      text    default null,
  p_pack_pattern_1 text    default null,
  p_pack_pattern_2 text    default null,
  p_pack_pattern_3 text    default null,
  p_count          integer default 1
)
returns text[]
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile  uuid;
  v_customer text;
  v_code     text;
  v_unit     text;
  v_request  text;
  v_sub      text;
  v_nos      text[];
  v_job_no   text;
  v_order    uuid;
  v_job      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารสร้างงานผลิตได้';
  end if;

  -- ---------- validate ----------
  if p_customer_id is null then raise exception 'กรุณาเลือกลูกค้า'; end if;
  select name into v_customer from public.customers where id = p_customer_id;
  if v_customer is null then raise exception 'ไม่พบลูกค้าที่เลือก'; end if;

  if p_product_id is null then raise exception 'กรุณาเลือกผลิตภัณฑ์'; end if;
  select code into v_code from public.products where id = p_product_id;
  if v_code is null then raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก'; end if;

  -- ด่าน GMP (0045) — ห้ามถอด: ไม่มีขั้นตอนการผลิต = บันทึกผลผลิต/ตรวจ in-process ไม่ได้
  if not public.product_has_route(p_product_id) then
    raise exception
      'ผลิตภัณฑ์ % ยังไม่ได้ตั้งขั้นตอนการผลิต — ไปตั้งที่หน้า "ผลิตภัณฑ์ / ขั้นตอนการผลิต" ก่อนสร้างงาน', v_code;
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Batch size ต้องมากกว่า 0';
  end if;

  if p_count is null or p_count < 1 then
    raise exception 'จำนวนใบที่จะสร้างต้องอย่างน้อย 1 ใบ';
  end if;
  if p_count > 50 then
    raise exception 'สร้างได้สูงสุด 50 ใบต่อครั้ง (ขอมา % ใบ)', p_count;
  end if;

  v_unit    := coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'เม็ด');
  v_request := nullif(btrim(coalesce(p_request_no, '')), '');
  v_sub     := nullif(btrim(coalesce(p_sub_status, '')), '');

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'สร้างงานผลิต ' || p_count || ' ใบ · ' || v_code || ' · ลูกค้า ' || v_customer
    || coalesce(' · ใบคำขอ ' || v_request, ''), true);

  -- ---------- จองเลขงานทั้งชุด ----------
  v_nos := public.next_job_nos(p_count);

  foreach v_job_no in array v_nos loop
    insert into public.orders
      (order_no, customer, customer_id, product_id, quantity, unit, due_date, created_by)
    values
      ('ORD-' || v_job_no, v_customer, p_customer_id, p_product_id,
       p_quantity, v_unit, p_due_date, v_profile)
    returning id into v_order;

    insert into public.jobs
      (job_no, order_id, batch_id, status,
       request_no, cpo_date, sub_status,
       pack_type, pack_pattern_1, pack_pattern_2, pack_pattern_3, created_by)
    values
      (v_job_no, v_order, null, 'pending_announce',
       v_request, p_cpo_date, v_sub,
       nullif(btrim(coalesce(p_pack_type, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_1, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_2, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_3, '')), ''),
       v_profile)
    returning id into v_job;

    -- snapshot ขั้นตอนการผลิตตาม GMP — กรองสถานีที่ปิดใช้งานออก (0045)
    insert into public.job_routes (job_id, station_id, step_no, note, created_by)
    select v_job, pr.station_id, pr.step_no, pr.note, v_profile
      from public.product_routes pr
      join public.stations s on s.id = pr.station_id
     where pr.product_id = p_product_id
       and s.is_active;
  end loop;

  return v_nos;
end;
$fn$;

-- ------------------------------------------------------------
-- (4.6) sync_job_route — job_routes ไม่มี station_group แล้ว (บอดี้เดิม 0045:185-246)
-- ------------------------------------------------------------
create or replace function public.sync_job_route(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile    uuid;
  v_job_no     text;
  v_status     job_status;
  v_product_id uuid;
  v_code       text;
  v_count      integer;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารซ่อมขั้นตอนการผลิตของงานได้';
  end if;

  select j.job_no, j.status, o.product_id
    into v_job_no, v_status, v_product_id
    from public.jobs j
    join public.orders o on o.id = j.order_id
   where j.id = p_job_id;

  if v_job_no is null then raise exception 'ไม่พบงานที่เลือก'; end if;

  -- (ก) ห้ามทับของเดิมเด็ดขาด
  if exists (select 1 from public.job_routes where job_id = p_job_id) then
    raise exception 'งาน % มีขั้นตอนการผลิตอยู่แล้ว — แก้ย้อนหลังไม่ได้ตามหลัก GMP', v_job_no;
  end if;

  -- (ข) เลยขั้นผลิตไปแล้วห้ามเติม
  if v_status not in ('pending_announce', 'planned', 'in_production') then
    raise exception 'งาน % เลยขั้นตอนการผลิตไปแล้ว (สถานะ %) — เติมขั้นตอนย้อนหลังไม่ได้', v_job_no, v_status;
  end if;

  select code into v_code from public.products where id = v_product_id;
  if not public.product_has_route(v_product_id) then
    raise exception
      'ผลิตภัณฑ์ % ยังไม่ได้ตั้งขั้นตอนการผลิต — ไปตั้งที่หน้า "ผลิตภัณฑ์ / ขั้นตอนการผลิต" ก่อน',
      coalesce(v_code, '');
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'เติมขั้นตอนการผลิตย้อนหลังให้งาน ' || v_job_no || ' (ตอนสร้างงานผลิตภัณฑ์ยังไม่มี route)', true);

  insert into public.job_routes (job_id, station_id, step_no, note, created_by)
  select p_job_id, pr.station_id, pr.step_no, pr.note, v_profile
  from public.product_routes pr
  join public.stations s on s.id = pr.station_id
  where pr.product_id = v_product_id
    and s.is_active;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- ------------------------------------------------------------
-- (4.7) request_edit — ตัด 'station' ออกจาก whitelist (บอดี้เดิม 0057:70-145)
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
    -- Part C.3: ตัด 'station' (กลุ่มหลัก) ออก — เหลือ station_id อย่างเดียว
    v_allowed := array['input_qty','output_qty','loss_qty','hours','headcount','note','record_date','station_id','machine_id'];
    select job_id into v_job from public.production_records where id = p_target_id;
  elsif p_target_type = 'material_requisition' then
    -- Part C.2: ระบบเบิกแบบผูกล็อตถูกยกเลิก — ของใหม่ฝ่ายผลิตแก้ได้เองที่หน้างาน
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

-- ------------------------------------------------------------
-- (4.8) review_edit_request — ตัดการ set station(enum) ควบ (บอดี้เดิม 0057:165-270)
--
--     🚨 คงโครง if / elsif / else raise ไว้เป๊ะ (บทเรียน Part C.2):
--        ห้ามให้ชนิดที่ไม่รู้จักตกลง else แล้ว update ผิดตารางแบบเงียบ ๆ
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
      machine_id  = case when v_req.changes ? 'machine_id'  then nullif(v_req.changes->>'machine_id', '')::uuid  else machine_id  end,
      updated_by  = v_profile
    where id = v_req.target_id;
    select input_qty, output_qty into v_in, v_out
    from public.production_records where id = v_req.target_id;
    if v_in is not null and v_out is not null and v_out > v_in then
      raise exception 'แก้ไม่ได้ — ผลิตได้ต้องไม่เกินจำนวนตั้งต้น';
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
    -- material_requisition (และชนิดอื่นที่อาจเพิ่มใน enum ภายหลัง) — ต้อง raise เสมอ
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
-- select to_regtype('public.production_station');           -- ต้องได้ null
-- select table_name, column_name from information_schema.columns
--  where table_schema = 'public' and column_name in ('station', 'station_group');  -- ต้องได้ 0 แถว
-- select proname, count(*) from pg_proc
--  where proname in ('upsert_station','upsert_machine','add_production_record',
--                    'add_inprocess_check','create_production_jobs','sync_job_route',
--                    'request_edit','review_edit_request')
--  group by proname;                                        -- ทุกตัวต้องได้ 1 (ไม่มี overload ซ้อน)
-- select to_regprocedure('public.create_job_with_order(text,uuid,numeric,text,date,text,date,date,text,text,text,text,text)');
--                                                           -- ต้องได้ null (ลบทิ้งแล้ว)
-- ============================================================
