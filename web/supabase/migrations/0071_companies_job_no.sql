-- ============================================================
-- PD Monitor — Part D ก้อน 2 / 0071_companies_job_no.sql
-- บริษัท (UMEDA / POUND) + แยกเลข Job No. ตามบริษัท + admin ตั้งเลขเริ่มต้น
--   (1) ตาราง companies + seed 2 บริษัท
--   (2) job_no_counters — เปลี่ยน PK เป็น (company_id, year_be)
--   (3) next_job_nos(company, count) — เลขเดินแยกกันต่อบริษัท
--   (4) admin_set_job_no_config — ตั้ง "เลขถัดไป" / "เลขตั้งต้นปีใหม่"
--   (5) jobs.company_id / jobs.company / jobs.note + backfill งานเก่า = UMEDA
--   (6) create_production_jobs — รับ p_company_id / p_note
--   (7) job_field_rules + update_job_details — เพิ่มช่อง "หมายเหตุ"
-- รัน "หลัง" 0070
--
-- 🔑 กติกาเลขงานที่ตกลงกับผู้ใช้:
--    เก็บใน DB มีอักษรนำหน้าต่อบริษัท (UMEDA = '' → 690001 · POUND = 'P' → P690001)
--    เพื่อให้ jobs.job_no ยัง unique และ URL /board/<job_no> ใช้ได้เหมือนเดิม
--    ฝั่งหน้าจอตัดอักษรนำออก แสดงเป็น 690001 เปล่าๆ + ป้ายบริษัท
--    → งานเก่าทั้งหมดไม่ต้องแตะเลย (ไม่มีอักษรนำ = UMEDA)
--
-- 🚨 drop function ตัวเก่าก่อน create ใหม่เสมอ (PGRST203) — รอบนี้ 2 ตัว:
--    next_job_nos(integer) · create_production_jobs(13 พารามิเตอร์)
-- ============================================================

-- ------------------------------------------------------------
-- (1) ตาราง companies — ทะเบียนบริษัท
--     โครงลอกจาก job_sub_statuses (0053) ทั้งชุด
-- ------------------------------------------------------------
create table if not exists public.companies (
  id             uuid primary key default gen_random_uuid(),
  code           text    not null,
  name           text    not null,
  job_no_prefix  text    not null default '',
  requires_note  boolean not null default false,
  year_start_seq integer not null default 1,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_by     uuid references public.profiles(id),
  updated_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1
);

comment on table public.companies is
  'ทะเบียนบริษัท (Part D · 0071) — jobs.company เก็บชื่อเป็น snapshot คู่ FK ตามหลัก ALCOA เดียวกับ 0047';
comment on column public.companies.job_no_prefix is
  'อักษรนำหน้าเลขงานใน DB — ต้องไม่ซ้ำกัน · ค่าว่างได้บริษัทเดียว (UMEDA = งานเดิมทั้งหมด) · หน้าจอตัดทิ้งก่อนแสดง';
comment on column public.companies.requires_note is
  'true = ฟอร์มสร้างงานโชว์ช่อง "หมายเหตุ" (POUND)';
comment on column public.companies.year_start_seq is
  'เลขตั้งต้นของ running 4 หลักเมื่อขึ้นปี พ.ศ. ใหม่ (ปกติ 1) — ตั้งได้ที่หน้า admin';

do $$
begin
  alter table public.companies
    add constraint chk_companies_prefix check (job_no_prefix ~ '^[A-Z]{0,2}$');
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.companies
    add constraint chk_companies_year_start check (year_start_seq between 1 and 9999);
exception when duplicate_object then null;
end $$;

create unique index if not exists idx_companies_code_uniq
  on public.companies (lower(btrim(code)));

-- 🚨 อักษรนำห้ามซ้ำ ไม่งั้น 2 บริษัทออกเลขชนกันได้จริง
create unique index if not exists idx_companies_prefix_uniq
  on public.companies (job_no_prefix);

drop trigger if exists trg_meta_companies on public.companies;
create trigger trg_meta_companies before insert or update on public.companies
  for each row execute function public.set_row_meta();

drop trigger if exists trg_audit_companies on public.companies;
create trigger trg_audit_companies after insert or update or delete on public.companies
  for each row execute function public.log_audit();

alter table public.companies enable row level security;

drop policy if exists read_companies on public.companies;
create policy read_companies on public.companies
  for select to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.companies;
exception when duplicate_object then null;
end $$;

-- seed idempotent
insert into public.companies (code, name, job_no_prefix, requires_note, sort_order)
select 'UMEDA', 'UMEDA CO., LTD.', '', false, 10
 where not exists (select 1 from public.companies where lower(btrim(code)) = 'umeda');

insert into public.companies (code, name, job_no_prefix, requires_note, sort_order)
select 'POUND', 'POUND CHEMICAL COMPANY LIMITED', 'P', true, 20
 where not exists (select 1 from public.companies where lower(btrim(code)) = 'pound');

-- ------------------------------------------------------------
-- (2) job_no_counters — ตัวนับแยกต่อบริษัท
--     ของเดิม PK = (year_be) → ใหม่ (company_id, year_be)
-- ------------------------------------------------------------
alter table public.job_no_counters
  add column if not exists company_id uuid references public.companies(id);

update public.job_no_counters
   set company_id = (select id from public.companies where code = 'UMEDA')
 where company_id is null;

alter table public.job_no_counters alter column company_id set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.job_no_counters'::regclass
       and conname  = 'job_no_counters_pkey'
       and array_length(conkey, 1) = 1
  ) then
    alter table public.job_no_counters drop constraint job_no_counters_pkey;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.job_no_counters'::regclass
       and conname  = 'job_no_counters_pkey'
  ) then
    alter table public.job_no_counters
      add constraint job_no_counters_pkey primary key (company_id, year_be);
  end if;
end $$;

comment on table public.job_no_counters is
  'ตัวนับเลขงานต่อ (บริษัท × ปี พ.ศ.) — next_job_nos() จองเลขจากที่นี่ · เต็มที่ 9999 ใบ/ปี/บริษัท';

-- ------------------------------------------------------------
-- (3) next_job_nos — จองเลขงานของบริษัทหนึ่งทีละชุด
-- ------------------------------------------------------------
drop function if exists public.next_job_nos(integer);

create or replace function public.next_job_nos(
  p_company_id uuid,
  p_count      integer default 1
)
returns text[]
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_year   smallint;
  v_last   integer;
  v_seq    integer;
  v_no     text;
  v_out    text[] := '{}';
  v_guard  integer := 0;
  v_prefix text;
  v_start  integer;
  v_found  boolean;
begin
  if p_count is null or p_count < 1 then
    raise exception 'จำนวนใบที่จะสร้างต้องอย่างน้อย 1 ใบ';
  end if;
  if p_company_id is null then
    raise exception 'กรุณาเลือกบริษัท';
  end if;

  select true, job_no_prefix, year_start_seq
    into v_found, v_prefix, v_start
    from public.companies
   where id = p_company_id and is_active;
  if not coalesce(v_found, false) then
    raise exception 'ไม่พบบริษัทที่เลือก หรือบริษัทถูกปิดใช้งาน';
  end if;

  -- ⚠️ ต้องแปลงเป็นเวลาไทยก่อน — session ของ Supabase เป็น UTC
  --    ถ้าใช้ current_date ดิบ ช่วงเที่ยงคืน–07:00 ของวันปีใหม่จะออกเลขปีเก่า
  v_year := ((extract(year from (now() at time zone 'Asia/Bangkok'))::int + 543) % 100)::smallint;

  -- จองเลขทั้งช่วงในคำสั่งเดียว (atomic)
  -- แถวแรกของปี/บริษัทนั้นเริ่มนับจาก year_start_seq ที่ admin ตั้งไว้
  insert into public.job_no_counters (company_id, year_be, last_seq, updated_at)
  values (p_company_id, v_year, greatest(coalesce(v_start, 1), 1) - 1 + p_count, now())
  on conflict (company_id, year_be) do update
    set last_seq   = public.job_no_counters.last_seq + p_count,
        updated_at = now()
  returning last_seq into v_last;

  if v_last > 9999 then
    raise exception 'เลขงานของปี % สำหรับบริษัทนี้เต็มแล้ว (9999 ใบ) — ติดต่อผู้ดูแลระบบ', v_year;
  end if;

  for v_seq in (v_last - p_count + 1) .. v_last loop
    v_no := v_prefix || lpad(v_year::text, 2, '0') || lpad(v_seq::text, 4, '0');

    -- กันชนกับเลขที่เคย import มือไว้ล่วงหน้า: จองเพิ่มทีละใบจนกว่าจะได้เลขว่าง
    while exists (select 1 from public.jobs where job_no = v_no) loop
      v_guard := v_guard + 1;
      if v_guard > 1000 then
        raise exception 'ออกเลขงานไม่สำเร็จ — มีเลขซ้ำในระบบมากผิดปกติ';
      end if;
      update public.job_no_counters
         set last_seq = last_seq + 1, updated_at = now()
       where company_id = p_company_id and year_be = v_year
      returning last_seq into v_last;
      if v_last > 9999 then
        raise exception 'เลขงานของปี % สำหรับบริษัทนี้เต็มแล้ว (9999 ใบ)', v_year;
      end if;
      v_no := v_prefix || lpad(v_year::text, 2, '0') || lpad(v_last::text, 4, '0');
    end loop;

    v_out := v_out || v_no;
  end loop;

  return v_out;
end;
$fn$;

grant execute on function public.next_job_nos(uuid, integer) to authenticated;

comment on function public.next_job_nos(uuid, integer) is
  'จองเลขงานของบริษัทหนึ่ง — คืน text[] · เลขในระบบมีอักษรนำของบริษัท (P690001) หน้าจอตัดทิ้งก่อนแสดง';

-- ------------------------------------------------------------
-- (4) admin_set_job_no_config — ผู้บริหาร/admin ตั้งเลขงาน
--     p_next_seq       = เลขถัดไปที่จะออก "ทันที" (ของปีปัจจุบัน)
--     p_year_start_seq = เลขตั้งต้นเมื่อขึ้นปี พ.ศ. ใหม่
--     ส่ง null = ไม่เปลี่ยนค่านั้น
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
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหาร/ผู้ดูแลระบบตั้งเลขงานได้';
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

-- ------------------------------------------------------------
-- (5) jobs — บริษัท + หมายเหตุ
-- ------------------------------------------------------------
alter table public.jobs
  add column if not exists company_id uuid references public.companies(id);
alter table public.jobs
  add column if not exists company text;
alter table public.jobs
  add column if not exists note text;

comment on column public.jobs.company is
  'ชื่อบริษัท snapshot ตอนสร้างงาน — คู่กับ company_id (หลัก ALCOA เดียวกับ orders.customer)';
comment on column public.jobs.note is
  'หมายเหตุของงาน (Part D · 0071) — บริษัท POUND ใช้เป็นหลัก แต่ทุกบริษัทกรอกได้';

-- backfill: งานเก่าทั้งหมดเป็นของ UMEDA (เลขไม่มีอักษรนำ)
update public.jobs j
   set company_id = c.id,
       company    = c.name
  from public.companies c
 where c.code = 'UMEDA'
   and j.company_id is null;

create index if not exists idx_jobs_company on public.jobs (company_id);

-- ------------------------------------------------------------
-- (6) create_production_jobs — เพิ่ม p_company_id / p_note
--     บอดี้เดิม 0059:413-522 · เปลี่ยนแค่ validate บริษัท + เรียก next_job_nos ใหม่ + insert 3 คอลัมน์
-- ------------------------------------------------------------
drop function if exists public.create_production_jobs(
  uuid, uuid, numeric, text, date, text, date, text, text, text, text, text, integer);

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
  p_count          integer default 1,
  p_company_id     uuid    default null,
  p_note           text    default null
)
returns text[]
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile  uuid;
  v_customer text;
  v_company  text;
  v_code     text;
  v_unit     text;
  v_request  text;
  v_sub      text;
  v_note     text;
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
  if p_company_id is null then raise exception 'กรุณาเลือกบริษัท'; end if;
  select name into v_company from public.companies where id = p_company_id and is_active;
  if v_company is null then raise exception 'ไม่พบบริษัทที่เลือก หรือบริษัทถูกปิดใช้งาน'; end if;

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
  v_note    := nullif(btrim(coalesce(p_note, '')), '');

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'สร้างงานผลิต ' || p_count || ' ใบ · ' || v_company || ' · ' || v_code || ' · ลูกค้า ' || v_customer
    || coalesce(' · ใบคำขอ ' || v_request, ''), true);

  -- ---------- จองเลขงานทั้งชุด (แยกตามบริษัท) ----------
  v_nos := public.next_job_nos(p_company_id, p_count);

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
       pack_type, pack_pattern_1, pack_pattern_2, pack_pattern_3,
       company_id, company, note, created_by)
    values
      (v_job_no, v_order, null, 'pending_announce',
       v_request, p_cpo_date, v_sub,
       nullif(btrim(coalesce(p_pack_type, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_1, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_2, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_3, '')), ''),
       p_company_id, v_company, v_note,
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

grant execute on function public.create_production_jobs(
  uuid, uuid, numeric, text, date, text, date, text, text, text, text, text, integer, uuid, text
) to authenticated;

-- ------------------------------------------------------------
-- (7) job_field_rules — เพิ่มช่อง "หมายเหตุ"
--     ⚠️ ไม่ใส่ company_id ที่นี่โดยตั้งใจ = แก้บริษัทหลังสร้างงานไม่ได้
--        (เลขงานผูกกับบริษัทไปแล้ว เปลี่ยนบริษัท = เลขต้องเปลี่ยนตาม)
-- ------------------------------------------------------------
create or replace function public.job_field_rules()
returns table (key text, label text, perm text, lock_from integer)
language sql
immutable
as $$
  values
    ('sub_status',     'Status',            'both', null::integer),
    ('plan_month',     'เดือนแผน',            'both', null),
    ('due_date',       'กำหนดส่ง',            'plan', null),
    ('customer_id',    'ลูกค้า',              'plan', 6),
    ('cpo_date',       'C.P.O DATE',        'plan', 6),
    ('request_no',     'ใบคำขอ',             'both', 6),
    ('note',           'หมายเหตุ',            'both', null),
    ('planned_start',  'แผนเริ่ม',            'prod', 6),
    ('planned_end',    'แผนเสร็จ',            'prod', 6),
    ('quantity',       'Batch Size',        'plan', 3),
    ('pack_type',      'รูปแบบบรรจุ',          'plan', 3),
    ('pack_pattern_1', 'Pack Size (1)',      'plan', 3),
    ('pack_pattern_2', 'Pack Size (2)',      'plan', 3),
    ('pack_pattern_3', 'Pack Size (3)',      'plan', 3),
    -- 3 ช่องล่างคุมด้วยด่านของ set_job_lot (0049) ต่างหาก
    -- lock_from = null ตรงนี้ ไม่ได้แปลว่าไม่มีด่าน
    ('lot_no',         'LOT No.',           'prod', null),
    ('mfg_date',       'วันผลิต',             'lot',  null),
    ('exp_date',       'วันหมดอายุ',           'lot',  null)
$$;

revoke execute on function public.job_field_rules() from public;
revoke execute on function public.job_field_rules() from anon;
revoke execute on function public.job_field_rules() from authenticated;

comment on function public.job_field_rules() is
  'กติกาสิทธิ์/ด่านล็อกของแต่ละช่องในหน้ารายละเอียดงาน — Part D (0071) เพิ่ม note · เรียกได้เฉพาะจาก update_job_details';

-- ------------------------------------------------------------
-- (8) update_job_details — บอดี้เดิม 0055:67-354 + เขียนค่า note
-- ------------------------------------------------------------
create or replace function public.update_job_details(
  p_job_id uuid,
  p_fields jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_seq constant text[] := array[
    'pending_announce', 'planned', 'in_production', 'qc', 'qa', 'finished_goods'
  ];
  v_profile   uuid;
  v_job       record;
  v_idx       integer;
  v_can_plan  boolean;
  v_can_prod  boolean;
  v_is_mgr    boolean;
  v_reason    text;
  v_bad       text;
  v_updated   text[] := '{}';
  v_sub       text;
  v_month     date;
  v_needs_mth boolean;
  v_qty       numeric;
  v_start     date;
  v_end       date;
  v_cust      uuid;
  v_lot       text;
  v_mfg       date;
  v_exp       date;
  v_labels    text;
  v_status_th text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if p_fields is null or p_fields = '{}'::jsonb then
    raise exception 'ไม่มีข้อมูลที่จะบันทึก';
  end if;

  select j.id, j.job_no, j.status, j.batch_id, j.order_id, j.sub_status, j.plan_month,
         j.planned_start, j.planned_end,
         o.quantity, o.due_date,
         b.lot_no, b.manufacture_date, b.expiry_date
    into v_job
    from public.jobs j
    join public.orders o on o.id = j.order_id
    left join public.batches b on b.id = j.batch_id
   where j.id = p_job_id
   for update of j;

  if v_job.id is null then raise exception 'ไม่พบงานที่เลือก'; end if;

  v_idx      := array_position(v_order_seq, v_job.status::text);
  v_can_plan := public.can_plan_jobs();
  v_can_prod := public.can_set_job_lot();
  v_is_mgr   := public.has_role('manager');
  v_status_th := case v_job.status::text
                   when 'pending_announce' then 'รอแจ้งผลิต'
                   when 'planned'          then 'มีแผนแล้ว'
                   when 'in_production'    then 'กำลังผลิต'
                   when 'qc'               then 'QC'
                   when 'qa'               then 'QA'
                   when 'finished_goods'   then 'FG (เข้าคลัง)'
                   else v_job.status::text end;
  v_reason   := nullif(btrim(coalesce(p_reason, '')), '');

  -- (ก) คีย์ที่ไม่รู้จัก = บั๊กฝั่งแอป ต้องดังทันที ไม่ปล่อยผ่านเงียบ
  select string_agg(k, ', ') into v_bad
    from jsonb_object_keys(p_fields) k
   where k not in (select r.key from public.job_field_rules() r);
  if v_bad is not null then
    raise exception 'ช่องที่ไม่รู้จัก: %', v_bad;
  end if;

  -- (ข) สิทธิ์ตามฝ่าย
  select string_agg(r.label, ' · ') into v_bad
    from jsonb_object_keys(p_fields) k
    join public.job_field_rules() r on r.key = k
   where not (
     case r.perm
       when 'plan' then v_can_plan
       when 'prod' then v_can_prod
       when 'both' then v_can_plan or v_can_prod
       when 'lot'  then v_can_prod or v_can_plan   -- วันผลิต/วันหมดอายุ: ฝ่ายวางแผนแก้ได้ถ้ามีล็อตแล้ว
       else false
     end
   );
  if v_bad is not null then
    raise exception 'ไม่มีสิทธิ์แก้ช่อง: %', v_bad;
  end if;

  -- (ค) ด่านล็อกตามสถานะ — ผู้บริหารข้ามได้ถ้าระบุเหตุผล
  select string_agg(r.label, ' · ') into v_bad
    from jsonb_object_keys(p_fields) k
    join public.job_field_rules() r on r.key = k
   where r.lock_from is not null and v_idx >= r.lock_from;
  if v_bad is not null then
    if not v_is_mgr then
      raise exception 'งาน % อยู่ในขั้น "%" แล้ว แก้ช่องนี้ไม่ได้: % (ต้องให้ผู้บริหารแก้พร้อมระบุเหตุผล)',
        v_job.job_no, v_status_th, v_bad;
    end if;
    if v_reason is null then
      raise exception 'การแก้ช่องที่ถูกล็อก (%) ต้องระบุเหตุผลกำกับไว้ในประวัติ', v_bad;
    end if;
  end if;

  -- ---------- Status + เดือนแผน ----------
  if p_fields ? 'sub_status' or p_fields ? 'plan_month' then
    v_sub := coalesce(
      case when p_fields ? 'sub_status'
           then nullif(btrim(coalesce(p_fields->>'sub_status', '')), '') end,
      v_job.sub_status);
    v_month := case when p_fields ? 'plan_month'
                    then nullif(btrim(coalesce(p_fields->>'plan_month', '')), '')::date
                    else v_job.plan_month end;

    if v_sub is not null then
      select s.requires_plan_month into v_needs_mth
        from public.job_sub_statuses s
       where lower(btrim(s.name)) = lower(btrim(v_sub))
         and s.is_active;
      if v_needs_mth is null then
        raise exception 'สถานะ "%" ไม่มีในทะเบียน (กดปุ่มจัดการเพื่อเพิ่มก่อน)', v_sub;
      end if;
      if v_needs_mth then
        if v_month is null then
          raise exception 'สถานะ "%" ต้องระบุเดือนที่ลงแผนด้วย', v_sub;
        end if;
        v_month := date_trunc('month', v_month)::date;   -- normalize เป็นวันที่ 1 เสมอ
      else
        v_month := null;   -- เปลี่ยนไปสถานะที่ไม่ผูกเดือน → ห้ามให้เดือนเก่าค้าง
      end if;
    else
      v_month := null;
    end if;
  end if;

  -- ---------- validate ค่าที่มีกติกาใน DB อยู่แล้ว (ดักเองเพื่อให้ได้ข้อความไทย) ----------
  if p_fields ? 'quantity' then
    v_qty := nullif(btrim(coalesce(p_fields->>'quantity', '')), '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Batch Size ต้องมากกว่า 0';
    end if;
  end if;

  if p_fields ? 'planned_start' or p_fields ? 'planned_end' then
    v_start := case when p_fields ? 'planned_start'
                    then nullif(btrim(coalesce(p_fields->>'planned_start', '')), '')::date
                    else v_job.planned_start end;
    v_end   := case when p_fields ? 'planned_end'
                    then nullif(btrim(coalesce(p_fields->>'planned_end', '')), '')::date
                    else v_job.planned_end end;
    if v_start is not null and v_end is not null and v_end < v_start then
      raise exception 'วันเสร็จตามแผนต้องไม่ก่อนวันเริ่ม';
    end if;
  end if;

  if p_fields ? 'customer_id' then
    v_cust := nullif(btrim(coalesce(p_fields->>'customer_id', '')), '')::uuid;
    if v_cust is null then raise exception 'กรุณาเลือกลูกค้า'; end if;
    if not exists (select 1 from public.customers where id = v_cust) then
      raise exception 'ไม่พบลูกค้าที่เลือกในทะเบียน';
    end if;
  end if;

  -- ---------- เก็บชื่อช่องที่แก้ ไว้เขียนลง audit ----------
  select string_agg(r.label, ' · ' order by r.label) into v_labels
    from jsonb_object_keys(p_fields) k
    join public.job_field_rules() r on r.key = k;
  v_labels := coalesce(v_labels, '-');

  perform set_config('app.current_profile_id', v_profile::text, true);

  -- ---------- jobs ----------
  if p_fields ?| array['sub_status','plan_month','cpo_date','request_no','planned_start',
                       'planned_end','pack_type','pack_pattern_1','pack_pattern_2','pack_pattern_3',
                       'note'] then
    perform set_config('app.audit_reason',
      'แก้ข้อมูลงาน ' || v_job.job_no || ': ' || v_labels ||
      coalesce(' — เหตุผล: ' || v_reason, ''), true);

    update public.jobs
       set sub_status = case when p_fields ? 'sub_status' then v_sub else sub_status end,
           plan_month = case when p_fields ? 'sub_status' or p_fields ? 'plan_month'
                             then v_month else plan_month end,
           cpo_date   = case when p_fields ? 'cpo_date'
                             then nullif(btrim(coalesce(p_fields->>'cpo_date', '')), '')::date
                             else cpo_date end,
           request_no = case when p_fields ? 'request_no'
                             then nullif(btrim(coalesce(p_fields->>'request_no', '')), '')
                             else request_no end,
           planned_start = case when p_fields ? 'planned_start' then v_start else planned_start end,
           planned_end   = case when p_fields ? 'planned_end'   then v_end   else planned_end end,
           pack_type  = case when p_fields ? 'pack_type'
                             then nullif(btrim(coalesce(p_fields->>'pack_type', '')), '')
                             else pack_type end,
           pack_pattern_1 = case when p_fields ? 'pack_pattern_1'
                                 then nullif(btrim(coalesce(p_fields->>'pack_pattern_1', '')), '')
                                 else pack_pattern_1 end,
           pack_pattern_2 = case when p_fields ? 'pack_pattern_2'
                                 then nullif(btrim(coalesce(p_fields->>'pack_pattern_2', '')), '')
                                 else pack_pattern_2 end,
           pack_pattern_3 = case when p_fields ? 'pack_pattern_3'
                                 then nullif(btrim(coalesce(p_fields->>'pack_pattern_3', '')), '')
                                 else pack_pattern_3 end,
           -- หมายเหตุ (Part D · 0071) — ช่องอิสระของงาน · บริษัท POUND ใช้เป็นหลัก
           note       = case when p_fields ? 'note'
                             then nullif(btrim(coalesce(p_fields->>'note', '')), '')
                             else note end,
           updated_by = v_profile
     where id = p_job_id;

    v_updated := array_append(v_updated, 'jobs');
  end if;

  -- ---------- orders ----------
  if p_fields ?| array['quantity','due_date','customer_id'] then
    perform set_config('app.audit_reason',
      'แก้ข้อมูลงาน ' || v_job.job_no || ': ' || v_labels ||
      coalesce(' — เหตุผล: ' || v_reason, ''), true);

    update public.orders
       set quantity = case when p_fields ? 'quantity' then v_qty else quantity end,
           due_date = case when p_fields ? 'due_date'
                           then nullif(btrim(coalesce(p_fields->>'due_date', '')), '')::date
                           else due_date end,
           -- ลูกค้า: เขียน snapshot ชื่อคู่ FK เสมอ (หลัก ALCOA เดียวกับ 0047)
           customer_id = case when p_fields ? 'customer_id' then v_cust else customer_id end,
           customer    = case when p_fields ? 'customer_id'
                              then (select name from public.customers where id = v_cust)
                              else customer end,
           updated_by  = v_profile
     where id = v_job.order_id;

    v_updated := array_append(v_updated, 'orders');
  end if;

  -- ---------- batches (LOT No. / วันผลิต / วันหมดอายุ) ----------
  if p_fields ? 'lot_no' then
    -- มีเลขล็อตมาด้วย → ส่งต่อให้ set_job_lot ของเดิมทั้งชุด (ด่าน GMP 0049 ทำงานเต็ม)
    v_lot := nullif(btrim(coalesce(p_fields->>'lot_no', '')), '');
    v_mfg := case when p_fields ? 'mfg_date'
                  then nullif(btrim(coalesce(p_fields->>'mfg_date', '')), '')::date
                  else v_job.manufacture_date end;
    v_exp := case when p_fields ? 'exp_date'
                  then nullif(btrim(coalesce(p_fields->>'exp_date', '')), '')::date
                  else v_job.expiry_date end;
    perform public.set_job_lot(p_job_id, v_lot, v_mfg, v_exp);
    v_updated := array_append(v_updated, 'batches');

  elsif p_fields ?| array['mfg_date','exp_date'] then
    -- แก้เฉพาะวัน (ฝ่ายวางแผนทำได้) — ต้องมีล็อตอยู่ก่อน เพราะ batches.lot_no เป็น not null
    if v_job.batch_id is null then
      raise exception 'ยังไม่มีเลขล็อตของงานนี้ — รอฝ่ายผลิตกรอก LOT No. ก่อนถึงจะใส่วันผลิต/วันหมดอายุได้';
    end if;
    if v_idx > 2 then
      raise exception 'งาน % เริ่มผลิตแล้ว — วันผลิต/วันหมดอายุถูกล็อกตามหลัก GMP', v_job.job_no;
    end if;

    v_mfg := case when p_fields ? 'mfg_date'
                  then nullif(btrim(coalesce(p_fields->>'mfg_date', '')), '')::date
                  else v_job.manufacture_date end;
    v_exp := case when p_fields ? 'exp_date'
                  then nullif(btrim(coalesce(p_fields->>'exp_date', '')), '')::date
                  else v_job.expiry_date end;
    if v_mfg is not null and v_exp is not null and v_exp <= v_mfg then
      raise exception 'วันหมดอายุต้องหลังวันผลิต';
    end if;

    perform set_config('app.audit_reason',
      'แก้ข้อมูลงาน ' || v_job.job_no || ': ' || v_labels ||
      coalesce(' — เหตุผล: ' || v_reason, ''), true);

    update public.batches
       set manufacture_date = v_mfg,
           expiry_date      = v_exp,
           updated_by       = v_profile
     where id = v_job.batch_id;

    v_updated := array_append(v_updated, 'batches');
  end if;

  return jsonb_build_object(
    'ok', true,
    'tables', to_jsonb(v_updated),
    'fields', v_labels,
    'message', 'บันทึกแล้ว: ' || v_labels
  );
end;
$$;

revoke execute on function public.update_job_details(uuid, jsonb, text) from public;
grant  execute on function public.update_job_details(uuid, jsonb, text) to authenticated;

comment on function public.update_job_details(uuid, jsonb, text) is
  'แก้ข้อมูลงานตามสิทธิ์ฝ่าย + ด่านล็อกตามสถานะ — Part D (0071) รองรับช่อง note';

-- ============================================================
-- ✅ ตรวจหลังรัน (paste แยกใน SQL Editor)
--
--   -- 1) ทะเบียนบริษัท ต้องมี 2 แถว · prefix ห้ามซ้ำ
--   select code, name, job_no_prefix, requires_note, year_start_seq from public.companies order by sort_order;
--
--   -- 2) ตัวนับต้องมี company_id และ PK เป็น (company_id, year_be)
--   select c.code, k.year_be, k.last_seq from public.job_no_counters k
--     join public.companies c on c.id = k.company_id;
--
--   -- 3) งานเก่าทุกใบต้องเป็น UMEDA และไม่มีใบไหน company_id เป็น null
--   select company, count(*) from public.jobs group by 1;
--
--   -- 4) ต้องเหลือฟังก์ชันเวอร์ชันเดียวทั้ง 2 ตัว
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('next_job_nos','create_production_jobs');
--
--   -- 5) job_field_rules ต้องมี note
--   select * from public.job_field_rules() where key = 'note';
-- ============================================================
