-- ============================================================
-- PD Monitor — Part F / 0090_perms_cost_lead_recipes_jobno.sql
--   (1) ทำให้ "บัญชีต้นทุน" เป็นฝ่ายจริง เพื่อให้ cost_lead (0089) ใช้งานได้
--   (2) แยกยาม "ตั้งค่าสถานีการผลิต" ออกจาก "แก้ขั้นตอนการผลิต (Route)"
--   (3) เปิดแท็บ "บริษัท / เลขงาน" ให้ฝ่ายวางแผน
--
-- 🚨 ต้องรัน "หลัง" 0089 เท่านั้น (ไฟล์นี้อ้างค่า enum cost_lead)
-- รันซ้ำได้ทั้งไฟล์ (create or replace ล้วน ไม่มี DDL ที่ทำลายข้อมูล)
--
-- 🧠 บทเรียนที่ยึดตามในไฟล์นี้
--   · ยกบอดี้ฟังก์ชันเก่ามาทั้งก้อนแล้ว diff เทียบ — เปลี่ยนเฉพาะบรรทัดที่ตั้งใจ (Part Notification)
--   · grant ต้องครบ 3 บรรทัด revoke public + revoke anon + grant authenticated
--     "grant to authenticated เฉย ๆ ไม่ถอน EXECUTE ของ PUBLIC" (0088:61-62)
--     → ไฟล์นี้ถือโอกาสปิดของเก่าที่ตกไปด้วย (set_product_route เดิมมีแต่ grant)
-- ============================================================


-- ------------------------------------------------------------
-- (1) dept_of_role — cost กลายเป็นฝ่ายจริง
--
-- เดิม cost อยู่ในกลุ่ม "ไม่สังกัดฝ่าย" ร่วมกับ manager/admin (0079:64)
-- ผลคือถ้าเพิ่ม cost_lead เฉย ๆ จะพังทั้ง 2 ทาง:
--   · head_assignable_roles() ของ cost_lead จะว่างเปล่า (null = any(...) ไม่เคย match)
--   · ฝั่งแอป deptOfRole() คืน null ⇒ หน้า /admin/users ตอบ "ไม่มีสิทธิ์" ตั้งแต่ประตู
--
-- 🎁 ปิดช่องโหว่แถม: วันนี้โปรไฟล์ที่ถือแต่ cost นับว่า "ไม่มีฝ่าย"
--    head_may_manage() มีข้อยกเว้น "เป้าหมายไม่มีฝ่าย = หัวหน้ารับเข้าฝ่ายตัวเองได้" (0079:169-171)
--    ⇒ หัวหน้าทุกฝ่ายแตะบัญชีบัญชีต้นทุนได้หมด · พอ cost เป็นฝ่ายจริง ช่องนี้ปิดเอง
--
-- ⚠️ ต้องตรงกับ deptOfRole() ใน web/lib/data/dept-constants.ts เสมอ
-- ------------------------------------------------------------
create or replace function public.dept_of_role(_role app_role)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when _role::text in ('manager', 'admin') then null
    when right(_role::text, 5) = '_lead' then left(_role::text, length(_role::text) - 5)
    else _role::text
  end;
$$;

comment on function public.dept_of_role(app_role) is
  'ฝ่ายของ role (ตัด _lead ออก) — manager/admin คืน null · cost/cost_lead เป็นฝ่าย cost (0090) · ต้องตรงกับ deptOfRole() ใน web/lib/data/dept-constants.ts';


-- ------------------------------------------------------------
-- (2) current_role_group / current_role_badge — เพิ่มบรรทัด cost_lead
--
-- 🚨 ห้ามสลับลำดับของเดิม (คำเตือน 0072:11-14 · 0078:77-80)
--    ที่ทำคือ "แทรก cost_lead ไว้เหนือ cost เดิม" ซึ่งให้ผลเดิมทุกเคส (คืนค่าฝ่ายเดียวกัน)
-- ------------------------------------------------------------
create or replace function public.current_role_group()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_profile_id() is null       then null
    when public.has_exact_role('qa_lead')          then 'qa'
    when public.has_exact_role('qa')               then 'qa'
    when public.has_exact_role('qc_lead')          then 'qc'
    when public.has_exact_role('qc')               then 'qc'
    when public.has_exact_role('production_lead')  then 'production'
    when public.has_exact_role('production')       then 'production'
    when public.has_exact_role('engineering_lead') then 'engineering'
    when public.has_exact_role('engineering')      then 'engineering'
    when public.has_exact_role('warehouse_lead')   then 'warehouse'
    when public.has_exact_role('warehouse')        then 'warehouse'
    when public.has_exact_role('planner_lead')     then 'planner'
    when public.has_exact_role('planner')          then 'planner'
    when public.has_exact_role('cost_lead')        then 'cost'
    when public.has_exact_role('cost')             then 'cost'
    when public.has_exact_role('manager')          then 'manager'
    when public.has_exact_role('admin')            then 'manager'
    else 'other'
  end;
$$;

revoke execute on function public.current_role_group() from public;
revoke execute on function public.current_role_group() from anon;
grant  execute on function public.current_role_group() to authenticated;

create or replace function public.current_role_badge()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_profile_id() is null       then null
    when public.has_exact_role('admin')            then 'manager'
    when public.has_exact_role('manager')          then 'manager'
    when public.has_exact_role('qa_lead')          then 'qa'
    when public.has_exact_role('qa')               then 'qa'
    when public.has_exact_role('qc_lead')          then 'qc'
    when public.has_exact_role('qc')               then 'qc'
    when public.has_exact_role('production_lead')  then 'production'
    when public.has_exact_role('production')       then 'production'
    when public.has_exact_role('engineering_lead') then 'engineering'
    when public.has_exact_role('engineering')      then 'engineering'
    when public.has_exact_role('warehouse_lead')   then 'warehouse'
    when public.has_exact_role('warehouse')        then 'warehouse'
    when public.has_exact_role('planner_lead')     then 'planner'
    when public.has_exact_role('planner')          then 'planner'
    when public.has_exact_role('cost_lead')        then 'cost'
    when public.has_exact_role('cost')             then 'cost'
    else 'other'
  end;
$$;

revoke execute on function public.current_role_badge() from public;
revoke execute on function public.current_role_badge() from anon;
grant  execute on function public.current_role_badge() to authenticated;


-- ------------------------------------------------------------
-- (3) แยกยาม: "สถานีการผลิต" (master) ออกจาก "ขั้นตอนการผลิต / Route"
--
-- ของเดิม can_manage_stations() = has_role('manager') คุมทั้ง 2 เรื่องพร้อมกัน (0022:85-93)
-- ทีมขอให้คนที่ทำงานจริงเข้าถึงได้:
--   · สถานี (master)        → ฝ่ายวิศวกรรม + หัวหน้าฝ่ายผลิต
--   · Route ของผลิตภัณฑ์    → ฝ่ายวางแผน + หัวหน้าฝ่ายผลิต
--
-- 🔑 has_role('engineering')     ครอบ engineering_lead ให้เองตามกติกาสืบทอด (0078)
-- 🔑 has_role('production_lead') ผ่านเฉพาะหัวหน้าจริง (+admin) = "production เฉพาะ head" พอดี
-- ------------------------------------------------------------
create or replace function public.can_manage_stations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('manager')
      or public.has_role('engineering')
      or public.has_role('production_lead');
$$;

comment on function public.can_manage_stations() is
  'จัดการทะเบียนสถานีการผลิตได้ไหม — ผู้บริหาร/วิศวกรรม/หัวหน้าฝ่ายผลิต (0090) · ต้องตรงกับ canManageStations() ใน web/lib/data/role-access.ts';

create or replace function public.can_edit_product_route()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('manager')
      or public.has_role('planner')
      or public.has_role('production_lead');
$$;

revoke execute on function public.can_edit_product_route() from public;
revoke execute on function public.can_edit_product_route() from anon;
grant  execute on function public.can_edit_product_route() to authenticated;

comment on function public.can_edit_product_route() is
  'แก้ขั้นตอนการผลิต (Route) ของผลิตภัณฑ์ได้ไหม — ผู้บริหาร/ฝ่ายวางแผน/หัวหน้าฝ่ายผลิต (0090) · ต้องตรงกับ canEditProductRoute() ใน web/lib/data/role-access.ts';

create or replace function public.can_set_job_no()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('manager')
      or public.has_role('planner');
$$;

revoke execute on function public.can_set_job_no() from public;
revoke execute on function public.can_set_job_no() from anon;
grant  execute on function public.can_set_job_no() to authenticated;

comment on function public.can_set_job_no() is
  'ตั้งค่าเลขงาน (บริษัท / เลขงาน) ได้ไหม — ผู้บริหาร/ฝ่ายวางแผน (0090) · ต้องตรงกับ canSetJobNo() ใน web/lib/data/role-access.ts';


-- ------------------------------------------------------------
-- (4) ยกบอดี้เดิมมาแก้ "เฉพาะข้อความ" — ยามยังเป็น can_manage_stations() ตัวเดิม
--     ที่เนื้อในเปลี่ยนไปแล้วในข้อ (3)
--     ต้นฉบับ: upsert_station 0081:61-119 · set_station_active 0040:167-201 · delete_station 0044:252-312
-- ------------------------------------------------------------
create or replace function public.upsert_station(
  p_id         uuid,
  p_code       text,
  p_name       text,
  p_seq        integer default 100,
  p_is_active  boolean default true,
  p_is_packing boolean default false
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
    raise exception 'ไม่มีสิทธิ์จัดการสถานีการผลิต (เฉพาะฝ่ายวิศวกรรม · หัวหน้าฝ่ายผลิต · ผู้บริหาร)';
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
    insert into public.stations (code, name, seq, is_active, is_packing, created_by)
    values (p_code, p_name, coalesce(p_seq, 100),
            coalesce(p_is_active, true), coalesce(p_is_packing, false), v_profile)
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
           is_packing = coalesce(p_is_packing, is_packing),
           updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$fn$;

create or replace function public.set_station_active(
  p_id        uuid,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_code    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_stations() then
    raise exception 'ไม่มีสิทธิ์จัดการสถานีการผลิต (เฉพาะฝ่ายวิศวกรรม · หัวหน้าฝ่ายผลิต · ผู้บริหาร)';
  end if;

  select code into v_code from public.stations where id = p_id;
  if v_code is null then raise exception 'ไม่พบสถานีที่เลือก'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    case when coalesce(p_is_active, true)
         then 'เปิดใช้งานสถานี ' || v_code
         else 'ปิดใช้งานสถานี ' || v_code end, true);

  update public.stations
     set is_active = coalesce(p_is_active, true), updated_by = v_profile
   where id = p_id;

  return p_id;
end;
$$;

create or replace function public.delete_station(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_code    text;
  v_jroutes integer;
  v_checks  integer;
  v_records integer;
  v_proutes integer;
  v_parts   text[] := '{}';
  v_msg     text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_stations() then
    raise exception 'ไม่มีสิทธิ์จัดการสถานีการผลิต (เฉพาะฝ่ายวิศวกรรม · หัวหน้าฝ่ายผลิต · ผู้บริหาร)';
  end if;

  select code into v_code from public.stations where id = p_id;
  if v_code is null then raise exception 'ไม่พบสถานีที่เลือก'; end if;

  select count(*) into v_jroutes from public.job_routes         where station_id = p_id;
  select count(*) into v_checks  from public.inprocess_checks   where station_id = p_id;
  select count(*) into v_records from public.production_records where station_id = p_id;
  select count(*) into v_proutes from public.product_routes     where station_id = p_id;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if v_jroutes = 0 and v_checks = 0 and v_records = 0 then
    perform set_config('app.audit_reason',
      'ลบสถานี ' || v_code || ' (ยังไม่ถูกใช้งาน — ลบจริง'
      || case when v_proutes > 0
              then ' · ถอดออกจากสูตร ' || v_proutes || ' รายการ' else '' end || ')', true);
    delete from public.stations where id = p_id;
    return jsonb_build_object(
      'action', 'deleted',
      'message', 'ลบสถานี ' || v_code || ' ออกจากระบบแล้ว'
        || case when v_proutes > 0
                then ' (ถอดออกจากขั้นตอนการผลิตของผลิตภัณฑ์ ' || v_proutes || ' รายการ)' else '' end
    );
  end if;

  if v_records > 0 then v_parts := v_parts || ('บันทึกผลผลิต ' || v_records || ' รายการ'); end if;
  if v_checks  > 0 then v_parts := v_parts || ('ผลตรวจ in-process ' || v_checks || ' รายการ'); end if;
  if v_jroutes > 0 then v_parts := v_parts || ('ขั้นตอนการผลิตของงาน ' || v_jroutes || ' รายการ'); end if;
  v_msg := 'ลบไม่ได้ — มี' || array_to_string(v_parts, ' · ') || ' ใช้อยู่ · เปลี่ยนเป็นปิดใช้งานแทนแล้ว';

  perform set_config('app.audit_reason',
    'ปิดใช้งานสถานี ' || v_code || ' (' || array_to_string(v_parts, ' · ') || ')', true);

  update public.stations
     set is_active = false, updated_by = v_profile
   where id = p_id;

  return jsonb_build_object('action', 'deactivated', 'message', v_msg);
end;
$$;

-- 🔒 set_station_active / delete_station เดิมมีแต่ grant to authenticated
--    ⇒ PUBLIC ยังถือ EXECUTE ติดมาโดยปริยาย · ปิดให้ครบตามแพทเทิร์น 0088 ที่นี่
revoke execute on function public.upsert_station(uuid, text, text, integer, boolean, boolean) from public;
revoke execute on function public.upsert_station(uuid, text, text, integer, boolean, boolean) from anon;
grant  execute on function public.upsert_station(uuid, text, text, integer, boolean, boolean) to authenticated;

revoke execute on function public.set_station_active(uuid, boolean) from public;
revoke execute on function public.set_station_active(uuid, boolean) from anon;
grant  execute on function public.set_station_active(uuid, boolean) to authenticated;

revoke execute on function public.delete_station(uuid) from public;
revoke execute on function public.delete_station(uuid) from anon;
grant  execute on function public.delete_station(uuid) to authenticated;


-- ------------------------------------------------------------
-- (5) set_product_route — เปลี่ยนยามเป็น can_edit_product_route()
--     ยกบอดี้จาก 0022:165-225 · เปลี่ยน 2 บรรทัด (ยาม + ข้อความ) ที่เหลือเหมือนเดิมเป๊ะ
-- ------------------------------------------------------------
create or replace function public.set_product_route(
  p_product_id uuid,
  p_items      jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_edit_product_route() then
    raise exception 'ไม่มีสิทธิ์แก้ขั้นตอนการผลิต (เฉพาะฝ่ายวางแผน · หัวหน้าฝ่ายผลิต · ผู้บริหาร)';
  end if;
  if p_product_id is null
     or not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'ไม่พบยา/ผลิตภัณฑ์ที่เลือก';
  end if;

  p_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'รูปแบบลำดับสถานีไม่ถูกต้อง';
  end if;

  -- ตรวจ: สถานีทุกตัวต้องมีจริง
  if exists (
    select 1 from jsonb_array_elements(p_items) it
    where not exists (
      select 1 from public.stations s where s.id = (it->>'station_id')::uuid
    )
  ) then
    raise exception 'มีสถานีในลำดับที่ไม่พบในระบบ';
  end if;

  -- ตรวจ: ห้ามสถานีซ้ำ
  if exists (
    select (it->>'station_id') as sid
    from jsonb_array_elements(p_items) it
    group by (it->>'station_id')
    having count(*) > 1
  ) then
    raise exception 'มีสถานีซ้ำกันในลำดับ — สถานีหนึ่งใส่ได้ครั้งเดียว';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ปรับลำดับสถานีการผลิต (route)', true);

  delete from public.product_routes where product_id = p_product_id;

  insert into public.product_routes (product_id, station_id, step_no, note, created_by)
  select p_product_id,
         (it->>'station_id')::uuid,
         ord::int,
         nullif(btrim(coalesce(it->>'note', '')), ''),
         v_profile
  from jsonb_array_elements(p_items) with ordinality as t(it, ord);
end;
$$;

revoke execute on function public.set_product_route(uuid, jsonb) from public;
revoke execute on function public.set_product_route(uuid, jsonb) from anon;
grant  execute on function public.set_product_route(uuid, jsonb) to authenticated;


-- ------------------------------------------------------------
-- (6) admin_set_job_no_config — เปลี่ยนยามเป็น can_set_job_no()
--     ยกบอดี้จาก 0071:233-316 · เปลี่ยน 2 บรรทัด (ยาม + ข้อความ)
-- ------------------------------------------------------------
create or replace function public.admin_set_job_no_config(
  p_company_id     uuid,
  p_next_seq       integer default null,
  p_year_start_seq integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_year    smallint;
  v_last    integer;
  v_name    text;
  v_reason  text := '';
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_set_job_no() then
    raise exception 'ไม่มีสิทธิ์ตั้งเลขงาน (เฉพาะฝ่ายวางแผน · ผู้บริหาร)';
  end if;

  select name into v_name from public.companies where id = p_company_id;
  if v_name is null then raise exception 'ไม่พบบริษัทที่เลือก'; end if;

  if p_next_seq is null and p_year_start_seq is null then
    raise exception 'ไม่มีค่าที่จะเปลี่ยน';
  end if;

  v_year := ((extract(year from (now() at time zone 'Asia/Bangkok'))::int + 543) % 100)::smallint;

  if p_year_start_seq is not null then
    if p_year_start_seq < 1 or p_year_start_seq > 9999 then
      raise exception 'เลขตั้งต้นปีใหม่ต้องอยู่ระหว่าง 1–9999';
    end if;
    v_reason := v_reason || format(' · เลขตั้งต้นปีใหม่ = %s', p_year_start_seq);
  end if;

  if p_next_seq is not null then
    if p_next_seq < 1 or p_next_seq > 9999 then
      raise exception 'เลขถัดไปต้องอยู่ระหว่าง 1–9999';
    end if;

    select last_seq into v_last
      from public.job_no_counters
     where company_id = p_company_id and year_be = v_year;
    v_last := coalesce(v_last, 0);

    -- 🚨 ตั้งย้อนหลังไม่ได้ — เลขที่ออกไปแล้วจะถูกออกซ้ำ
    if p_next_seq <= v_last then
      raise exception
        'ตั้งเลขถัดไปเป็น % ไม่ได้ — ปี % ของ % ออกเลขถึง % แล้ว ต้องตั้งมากกว่านั้น',
        p_next_seq, v_year, v_name, v_last;
    end if;
    v_reason := v_reason || format(' · เลขถัดไป = %s%s', lpad(v_year::text, 2, '0'), lpad(p_next_seq::text, 4, '0'));
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'ตั้งค่าเลขงาน ' || v_name || ' ' || btrim(v_reason), true);

  -- แตะ companies เสมอ เพื่อให้ trigger audit บันทึกว่าใครเปลี่ยนอะไร
  update public.companies
     set year_start_seq = coalesce(p_year_start_seq, year_start_seq),
         updated_by     = v_profile
   where id = p_company_id;

  if p_next_seq is not null then
    insert into public.job_no_counters (company_id, year_be, last_seq, updated_at)
    values (p_company_id, v_year, p_next_seq - 1, now())
    on conflict (company_id, year_be) do update
      set last_seq = p_next_seq - 1, updated_at = now();
  end if;

  return jsonb_build_object(
    'company_id',     p_company_id,
    'year_be',        v_year,
    'year_start_seq', (select year_start_seq from public.companies where id = p_company_id),
    'next_seq',       coalesce((select last_seq + 1 from public.job_no_counters
                                 where company_id = p_company_id and year_be = v_year), 1)
  );
end;
$fn$;

revoke execute on function public.admin_set_job_no_config(uuid, integer, integer) from public;
revoke execute on function public.admin_set_job_no_config(uuid, integer, integer) from anon;
grant  execute on function public.admin_set_job_no_config(uuid, integer, integer) to authenticated;


-- ============================================================
-- ✅ ตรวจหลัง paste
--   select public.dept_of_role('cost'), public.dept_of_role('cost_lead');
--        -- ต้องได้ cost / cost  (เดิมได้ null / cost)
--   select proname, prosrc like '%cost_lead%' as ok
--     from pg_proc where proname in ('current_role_group','current_role_badge');   -- ok = true ทั้ง 2
--   select position('engineering' in prosrc) > 0 from pg_proc where proname = 'can_manage_stations';   -- true
--   select proname from pg_proc where proname in ('can_edit_product_route','can_set_job_no');          -- 2 แถว
--   select prosrc like '%can_edit_product_route%' from pg_proc where proname = 'set_product_route';    -- true
--   select prosrc like '%can_set_job_no%'         from pg_proc where proname = 'admin_set_job_no_config'; -- true
--
-- ⚠️ ผลข้างเคียงที่ตั้งใจ: บัญชีที่ถือแต่ role cost จะไม่ถูกมองว่า "ไม่มีฝ่าย" อีกต่อไป
--    ⇒ หัวหน้าฝ่ายอื่นแตะบัญชีกลุ่มนี้ไม่ได้แล้ว เหลือ cost_lead + ผู้บริหาร/admin
-- ============================================================
