-- ============================================================
-- PD Monitor — D11 / 0022_stations.sql  (A4 ก้อน 3: สถานีย่อยจริง + route)
-- ⚠️ ไม่แตะ enum production_station เดิม (prep/mixing/tableting/packing)
--    เพื่อไม่ให้ production_records + dashboard เดิมพัง (ตาม Notion Roadmap)
-- ทำเป็นตาราง config แทน:
--   stations       = สถานีย่อยจริง (บด/ร่อน/ผสม/ตอก/ฉาบ/ฟิล์ม/คัด-ขัด/บรรจุ)
--                    + station_group map เข้า 1 ใน 4 กลุ่มเดิม (rollup dashboard)
--   product_routes = ยา → ลำดับสถานีที่ต้องผ่าน (step_no)
-- เขียนผ่าน RPC security definer (manager/admin)
-- รัน "หลัง" 0001–0021
-- ============================================================

-- ------------------------------------------------------------
-- stations — สถานีย่อย (config ได้) · station_group ใช้ enum เดิมเป็นกลุ่ม
-- ------------------------------------------------------------
create table if not exists public.stations (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  station_group production_station not null,  -- กลุ่มหลัก (เดิม) สำหรับ rollup
  seq           integer not null default 100, -- ลำดับแสดงผล
  is_active     boolean not null default true,
  created_by    uuid references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

-- ------------------------------------------------------------
-- product_routes — ลำดับสถานีที่ยาแต่ละตัวต้องผ่าน
-- ------------------------------------------------------------
create table if not exists public.product_routes (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  station_id  uuid not null references public.stations(id),
  step_no     integer not null,
  note        text,
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1,
  unique (product_id, station_id)  -- ยาผ่านสถานีหนึ่งได้ครั้งเดียว
);

create index if not exists idx_stations_group         on public.stations(station_group);
create index if not exists idx_product_routes_product on public.product_routes(product_id);
create index if not exists idx_product_routes_station on public.product_routes(station_id);

-- ------------------------------------------------------------
-- triggers: meta + audit
-- ------------------------------------------------------------
drop trigger if exists trg_meta_stations on public.stations;
create trigger trg_meta_stations before insert or update on public.stations
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_stations on public.stations;
create trigger trg_audit_stations after insert or update or delete on public.stations
  for each row execute function public.log_audit();

drop trigger if exists trg_meta_product_routes on public.product_routes;
create trigger trg_meta_product_routes before insert or update on public.product_routes
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_product_routes on public.product_routes;
create trigger trg_audit_product_routes after insert or update or delete on public.product_routes
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- RLS: เปิด (default-deny) · authenticated อ่านได้ · เขียนผ่าน RPC
-- ------------------------------------------------------------
alter table public.stations enable row level security;
alter table public.product_routes enable row level security;

drop policy if exists read_stations on public.stations;
create policy read_stations on public.stations
  for select to authenticated using (true);

drop policy if exists read_product_routes on public.product_routes;
create policy read_product_routes on public.product_routes
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- helper: เฉพาะผู้บริหาร/admin จัดการสถานี+route ได้
-- ------------------------------------------------------------
create or replace function public.can_manage_stations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('manager');
$$;

-- ------------------------------------------------------------
-- upsert_station — เพิ่ม/แก้สถานีย่อย
-- ------------------------------------------------------------
create or replace function public.upsert_station(
  p_id        uuid,
  p_code      text,
  p_name      text,
  p_group     production_station,
  p_seq       integer default 100,
  p_is_active boolean default true
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
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_stations() then
    raise exception 'เฉพาะผู้บริหารจัดการสถานีการผลิตได้';
  end if;

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  if p_code = '' then raise exception 'กรุณาระบุรหัสสถานี (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อสถานี'; end if;
  if p_group is null then raise exception 'กรุณาเลือกกลุ่มสถานี'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    if exists (select 1 from public.stations where code = p_code) then
      raise exception 'รหัสสถานี % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มสถานี ' || p_code, true);
    insert into public.stations (code, name, station_group, seq, is_active, created_by)
    values (p_code, p_name, p_group, coalesce(p_seq, 100),
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
       set code = p_code, name = p_name, station_group = p_group,
           seq = coalesce(p_seq, seq), is_active = coalesce(p_is_active, is_active),
           updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_station(uuid, text, text, production_station, integer, boolean)
  to authenticated;

-- ------------------------------------------------------------
-- set_product_route — แทนที่ลำดับสถานีของยาทั้งชุด (atomic)
--   p_items = jsonb array ของ { station_id, note } · ลำดับใน array = step_no
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
  if not public.can_manage_stations() then
    raise exception 'เฉพาะผู้บริหารจัดการขั้นตอนการผลิตได้';
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

grant execute on function public.set_product_route(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- seed: สถานีย่อยมาตรฐาน (รันซ้ำได้ — on conflict do nothing ตาม code)
-- ------------------------------------------------------------
insert into public.stations (code, name, station_group, seq) values
  ('ST-WEIGH', 'ชั่ง/เตรียมวัตถุดิบ', 'prep',      10),
  ('ST-MILL',  'บด',                  'mixing',    20),
  ('ST-SIEVE', 'ร่อน',                'mixing',    30),
  ('ST-DMIX',  'ผสมแห้ง',             'mixing',    40),
  ('ST-WMIX',  'ผสมเปียก',            'mixing',    50),
  ('ST-TAB',   'ตอกเม็ด',             'tableting', 60),
  ('ST-CAP',   'บรรจุแคปซูล',         'tableting', 70),
  ('ST-FILM',  'เคลือบฟิล์ม',         'tableting', 80),
  ('ST-SORT',  'คัด-ขัด',             'tableting', 90),
  ('ST-PACK',  'บรรจุ (Blister/Strip/ซอง/ขวด)', 'packing', 100)
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.stations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.product_routes;
exception when duplicate_object then null; end $$;
