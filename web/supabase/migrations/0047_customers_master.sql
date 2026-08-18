-- ============================================================
-- PD Monitor — Part 3 ก้อน 1 / 0047_customers_master.sql
-- ทะเบียนลูกค้า — เลิกพิมพ์ชื่อลูกค้าอิสระในหน้าสร้างงาน เปลี่ยนเป็นเลือกจากทะเบียน
--
--   (1) ตาราง customers (เก็บแค่ชื่อ) + trigger meta/audit + RLS + realtime
--   (2) orders.customer_id — FK ชี้ทะเบียน (คง orders.customer เป็น snapshot ชื่อไว้เหมือนเดิม)
--   (3) backfill — ดึงชื่อลูกค้าที่พิมพ์ไว้เดิมมาตั้งเป็นทะเบียน แล้วผูก customer_id ให้ครบ
--   (4) upsert_customer  — เพิ่ม/แก้ (แก้ชื่อแล้ว sync snapshot ใน orders ให้ด้วย)
--   (5) delete_customer  — ลบจริงถ้าไม่มีใครใช้ · มีงานผูกอยู่ต้องเลือกลูกค้าใหม่ให้ก่อน
--
-- ℹ️ ทำไมเก็บ "ทั้ง customer_id และ customer (text)":
--    ชื่อลูกค้า ณ วันสั่งผลิตต้องแช่แข็งไว้ตาม GMP/ALCOA (เอกสาร eBR ที่พิมพ์ไปแล้วต้องตรงกัน)
--    และทำให้หน้าจอ 8 ไฟล์ที่อ่าน orders.customer อยู่ ไม่ต้องแก้เลยสักไฟล์
-- ℹ️ FK เป็น NO ACTION โดยตั้งใจ — DB กันลบลูกค้าที่ยังมี order เป็นชั้นสุดท้าย
--    บังคับให้ผ่าน flow "ย้ายงานไปลูกค้าใหม่ก่อน" ของ delete_customer เสมอ
-- ℹ️ ก้อนนี้ยังไม่แตะ create_job_with_order — หน้าสร้างงานยังส่งชื่อลูกค้าเป็น text เหมือนเดิม
--    (ก้อน 2 จะเปลี่ยนไปส่ง customer_id พร้อมรื้อ RPC สร้างงานทั้งตัว)
-- รัน "หลัง" 0001–0046
-- ============================================================

-- ------------------------------------------------------------
-- (1) ตาราง customers — เก็บแค่ชื่อตามที่ทีมขอ
-- ------------------------------------------------------------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_active  boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

comment on table public.customers is
  'ทะเบียนลูกค้า/หน่วยงาน (Part 3) — orders.customer_id ชี้มาที่นี่ · orders.customer เก็บชื่อ ณ วันสั่งเป็น snapshot';

-- ชื่อห้ามซ้ำแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย
create unique index if not exists idx_customers_name_uniq
  on public.customers (lower(btrim(name)));

drop trigger if exists trg_meta_customers on public.customers;
create trigger trg_meta_customers before insert or update on public.customers
  for each row execute function public.set_row_meta();

drop trigger if exists trg_audit_customers on public.customers;
create trigger trg_audit_customers after insert or update or delete on public.customers
  for each row execute function public.log_audit();

-- RLS: default-deny · ทุกคนที่ล็อกอินอ่านได้ · เขียนผ่าน RPC security definer เท่านั้น
alter table public.customers enable row level security;

drop policy if exists read_customers on public.customers;
create policy read_customers on public.customers
  for select to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.customers;
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- (2) orders.customer_id — NO ACTION โดยตั้งใจ (ดูหมายเหตุหัวไฟล์)
-- ------------------------------------------------------------
alter table public.orders
  add column if not exists customer_id uuid references public.customers(id);

create index if not exists idx_orders_customer_id on public.orders(customer_id);

comment on column public.orders.customer_id is
  'ทะเบียนลูกค้า (0047) — ใช้จัดกลุ่ม/แก้ชื่อย้อนหลัง';
comment on column public.orders.customer is
  'ชื่อลูกค้า ณ วันสั่งผลิต (snapshot ตาม GMP/ALCOA) — RPC เขียนจาก customers.name เสมอ ห้ามให้ผู้ใช้พิมพ์เอง';

-- ------------------------------------------------------------
-- (3) backfill — ชื่อที่เคยพิมพ์ไว้ → ทะเบียน → ผูก customer_id
--     รันซ้ำได้ (idempotent)
-- ------------------------------------------------------------
do $$
begin
  perform set_config('app.audit_reason', 'ตั้งทะเบียนลูกค้าจากชื่อที่พิมพ์ไว้เดิม (0047)', true);

  insert into public.customers (name)
  select distinct btrim(o.customer)
    from public.orders o
   where btrim(coalesce(o.customer, '')) <> ''
     and not exists (
       select 1 from public.customers c
        where lower(btrim(c.name)) = lower(btrim(o.customer))
     );

  update public.orders o
     set customer_id = c.id
    from public.customers c
   where o.customer_id is null
     and lower(btrim(o.customer)) = lower(btrim(c.name));
end $$;

-- ------------------------------------------------------------
-- (4) upsert_customer — เพิ่ม/แก้ทะเบียนลูกค้า
--     แก้ชื่อแล้วต้อง sync snapshot ใน orders ด้วย ไม่งั้นหน้าจอเก่าโชว์ชื่อเดิมตลอดไป
-- ------------------------------------------------------------
create or replace function public.upsert_customer(
  p_id   uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_name    text;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารจัดการทะเบียนลูกค้าได้';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then raise exception 'กรุณาระบุชื่อลูกค้า'; end if;

  if exists (
    select 1 from public.customers
     where lower(btrim(name)) = lower(v_name)
       and (p_id is null or id <> p_id)
  ) then
    raise exception 'มีลูกค้าชื่อ % อยู่แล้ว', v_name;
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    perform set_config('app.audit_reason', 'เพิ่มลูกค้า ' || v_name, true);
    insert into public.customers (name, created_by)
    values (v_name, v_profile)
    returning id into v_id;
  else
    if not exists (select 1 from public.customers where id = p_id) then
      raise exception 'ไม่พบลูกค้าที่เลือก';
    end if;
    perform set_config('app.audit_reason', 'แก้ชื่อลูกค้าเป็น ' || v_name, true);
    update public.customers
       set name = v_name, updated_by = v_profile
     where id = p_id
    returning id into v_id;

    -- sync snapshot: ชื่อในใบสั่งผลิตต้องตามชื่อใหม่ ไม่งั้นบอร์ด/eBR โชว์ชื่อเดิมค้าง
    update public.orders
       set customer = v_name
     where customer_id = v_id
       and customer is distinct from v_name;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_customer(uuid, text) to authenticated;

comment on function public.upsert_customer(uuid, text) is
  'เพิ่ม/แก้ทะเบียนลูกค้า (วางแผน/ผู้บริหาร) — แก้ชื่อแล้ว sync orders.customer ให้อัตโนมัติ';

-- ------------------------------------------------------------
-- (5) delete_customer — ลบทะเบียนลูกค้า
--     ไม่มีใครใช้        → ลบจริง                      {action:'deleted'}
--     มีงานผูกอยู่ + ไม่ส่งปลายทาง → บอกว่าติดอะไรอยู่  {action:'blocked', orders, jobs}
--     มีงานผูกอยู่ + ส่งปลายทาง   → ย้ายทุกใบแล้วลบ    {action:'reassigned_deleted', moved}
--     (ทั้ง 3 กรณีอยู่ในทรานแซกชันเดียว — ย้ายไม่สำเร็จก็ไม่ลบ)
-- ------------------------------------------------------------
create or replace function public.delete_customer(
  p_id          uuid,
  p_reassign_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile  uuid;
  v_name     text;
  v_to_name  text;
  v_orders   integer;
  v_jobs     integer;
  v_moved    integer;
  v_parts    text[] := '{}';
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารจัดการทะเบียนลูกค้าได้';
  end if;

  select name into v_name from public.customers where id = p_id;
  if v_name is null then raise exception 'ไม่พบลูกค้าที่เลือก'; end if;

  select count(*) into v_orders from public.orders where customer_id = p_id;
  select count(*) into v_jobs
    from public.jobs j
    join public.orders o on o.id = j.order_id
   where o.customer_id = p_id;

  perform set_config('app.current_profile_id', v_profile::text, true);

  -- ไม่มีใครใช้ → ลบจริง
  if v_orders = 0 then
    perform set_config('app.audit_reason',
      'ลบลูกค้า ' || v_name || ' (ยังไม่มีงานผูกอยู่)', true);
    delete from public.customers where id = p_id;
    return jsonb_build_object(
      'action',  'deleted',
      'message', 'ลบลูกค้า ' || v_name || ' ออกจากทะเบียนแล้ว'
    );
  end if;

  -- มีงานผูกอยู่ แต่ยังไม่ได้เลือกปลายทาง → บอกว่าติดอะไร ให้หน้าจอไปถามผู้ใช้ก่อน
  if p_reassign_to is null then
    if v_jobs   > 0 then v_parts := v_parts || ('งานผลิต '   || v_jobs   || ' ใบ'); end if;
    if v_orders > 0 then v_parts := v_parts || ('ใบสั่งผลิต ' || v_orders || ' ใบ'); end if;
    return jsonb_build_object(
      'action',  'blocked',
      'orders',  v_orders,
      'jobs',    v_jobs,
      'message', 'ลบไม่ได้ — ลูกค้า ' || v_name || ' มี'
                 || array_to_string(v_parts, ' · ')
                 || ' ผูกอยู่ · กรุณาเลือกลูกค้าใหม่ให้งานเหล่านี้ก่อน'
    );
  end if;

  -- เลือกปลายทางมาแล้ว → ย้ายทุกใบ แล้วลบ (ทรานแซกชันเดียว)
  if p_reassign_to = p_id then
    raise exception 'เลือกลูกค้าปลายทางเป็นตัวเดียวกับที่จะลบไม่ได้';
  end if;
  select name into v_to_name from public.customers where id = p_reassign_to;
  if v_to_name is null then raise exception 'ไม่พบลูกค้าปลายทางที่เลือก'; end if;

  perform set_config('app.audit_reason',
    'ย้ายงานจากลูกค้า ' || v_name || ' → ' || v_to_name || ' ก่อนลบทะเบียน', true);

  update public.orders
     set customer_id = p_reassign_to,
         customer    = v_to_name,     -- snapshot ต้องตามไปด้วย
         updated_by  = v_profile
   where customer_id = p_id;
  get diagnostics v_moved = row_count;

  perform set_config('app.audit_reason',
    'ลบลูกค้า ' || v_name || ' (ย้ายงาน ' || v_moved || ' ใบไป ' || v_to_name || ' แล้ว)', true);
  delete from public.customers where id = p_id;

  return jsonb_build_object(
    'action',  'reassigned_deleted',
    'moved',   v_moved,
    'message', 'ย้ายใบสั่งผลิต ' || v_moved || ' ใบไปที่ ' || v_to_name
               || ' แล้วลบลูกค้า ' || v_name || ' เรียบร้อย'
  );
end;
$$;

grant execute on function public.delete_customer(uuid, uuid) to authenticated;

comment on function public.delete_customer(uuid, uuid) is
  'ลบทะเบียนลูกค้า — ไม่มีงานผูก=ลบจริง · มีงานผูกต้องส่ง p_reassign_to มาย้ายก่อน (คืน jsonb {action,message})';

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   select id, name from public.customers order by name;
--   select count(*) from public.orders where customer_id is null;   -- ควรเป็น 0
--   select proname, pg_get_function_identity_arguments(oid)
--     from pg_proc where proname in ('upsert_customer','delete_customer');
-- ============================================================
