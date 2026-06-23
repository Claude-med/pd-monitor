-- ============================================================
-- PD Monitor — D10 / 0016_materials.sql  (A2 ก้อน 1: คลังวัตถุดิบ RM/PM)
-- ตาราง materials (ตัวแม่) + material_lots (ล็อตที่รับเข้า: สต็อก/สถานะ QC/วันหมดอายุ)
-- เขียนผ่าน RPC security definer (warehouse/manager/admin) ตามแพตเทิร์นเดิม
-- (ก้อนถัดไปค่อยทำใบเบิก material_requisitions ผูกกับงาน + ตัดสต็อก)
-- รัน "หลัง" 0001–0015
-- ============================================================

-- ------------------------------------------------------------
-- enums
-- ------------------------------------------------------------
do $$ begin
  create type material_type as enum ('rm', 'pm');  -- RM=วัตถุดิบ · PM=บรรจุภัณฑ์
exception when duplicate_object then null; end $$;

do $$ begin
  create type material_lot_status as enum (
    'available',   -- พร้อมใช้
    'quarantine',  -- กักกัน (รอปล่อย)
    'testing',     -- รอตรวจ (QC)
    'released',    -- ผ่าน (ปล่อยใช้)
    'rejected',    -- ไม่ผ่าน
    'expired'      -- หมดอายุ
  );
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- materials — รายการวัตถุดิบ/บรรจุภัณฑ์ (ตัวแม่)
-- ------------------------------------------------------------
create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  type        material_type not null default 'rm',
  unit        text not null default 'kg',
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);

-- ------------------------------------------------------------
-- material_lots — ล็อตที่รับเข้า (สต็อกคงเหลือ + สถานะ QC + วันหมดอายุ)
-- ------------------------------------------------------------
create table if not exists public.material_lots (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references public.materials(id) on delete cascade,
  lot_no        text not null,
  qty_on_hand   numeric(14,2) not null default 0 check (qty_on_hand >= 0),
  status        material_lot_status not null default 'quarantine',
  received_date date,
  expiry_date   date,
  note          text,
  created_by    uuid references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  unique (material_id, lot_no)
);

create index if not exists idx_material_lots_material on public.material_lots(material_id);
create index if not exists idx_material_lots_status   on public.material_lots(status);
create index if not exists idx_material_lots_expiry   on public.material_lots(expiry_date);

-- ------------------------------------------------------------
-- triggers: meta (updated_at/version) + audit
-- ------------------------------------------------------------
drop trigger if exists trg_meta_materials on public.materials;
create trigger trg_meta_materials before insert or update on public.materials
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_materials on public.materials;
create trigger trg_audit_materials after insert or update or delete on public.materials
  for each row execute function public.log_audit();

drop trigger if exists trg_meta_material_lots on public.material_lots;
create trigger trg_meta_material_lots before insert or update on public.material_lots
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_material_lots on public.material_lots;
create trigger trg_audit_material_lots after insert or update or delete on public.material_lots
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- RLS: เปิด (default-deny) · authenticated อ่านได้ทุกคน · เขียนผ่าน RPC เท่านั้น
-- ------------------------------------------------------------
alter table public.materials enable row level security;
alter table public.material_lots enable row level security;

drop policy if exists read_materials on public.materials;
create policy read_materials on public.materials
  for select to authenticated using (true);

drop policy if exists read_material_lots on public.material_lots;
create policy read_material_lots on public.material_lots
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- helper: เฉพาะคลัง/ผู้บริหาร/ผู้ดูแลระบบ จัดการคลังวัตถุดิบได้
--   (has_role ถือว่า admin ผ่านทุก role อยู่แล้ว)
-- ------------------------------------------------------------
create or replace function public.can_manage_materials()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('warehouse') or public.has_role('manager');
$$;

-- ------------------------------------------------------------
-- upsert_material — เพิ่ม/แก้รายการวัตถุดิบ
-- ------------------------------------------------------------
create or replace function public.upsert_material(
  p_id   uuid,
  p_code text,
  p_name text,
  p_type material_type default 'rm',
  p_unit text          default 'kg'
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
  if not public.can_manage_materials() then
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารจัดการคลังวัตถุดิบได้';
  end if;

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  if p_code = '' then raise exception 'กรุณาระบุรหัสวัตถุดิบ (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อวัตถุดิบ'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    if exists (select 1 from public.materials where code = p_code) then
      raise exception 'รหัสวัตถุดิบ % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มวัตถุดิบ ' || p_code, true);
    insert into public.materials (code, name, type, unit, created_by)
    values (p_code, p_name, coalesce(p_type, 'rm'),
            coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'kg'), v_profile)
    returning id into v_id;
  else
    if not exists (select 1 from public.materials where id = p_id) then
      raise exception 'ไม่พบวัตถุดิบที่เลือก';
    end if;
    if exists (select 1 from public.materials where code = p_code and id <> p_id) then
      raise exception 'รหัสวัตถุดิบ % ถูกใช้กับรายการอื่นแล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'แก้วัตถุดิบ ' || p_code, true);
    update public.materials
       set code = p_code, name = p_name,
           type = coalesce(p_type, type),
           unit = coalesce(nullif(btrim(coalesce(p_unit, '')), ''), unit),
           updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_material(uuid, text, text, material_type, text)
  to authenticated;

-- ------------------------------------------------------------
-- upsert_material_lot — เพิ่ม/แก้ล็อต (สต็อก/สถานะ/วันหมดอายุ)
-- ------------------------------------------------------------
create or replace function public.upsert_material_lot(
  p_id            uuid,
  p_material_id   uuid,
  p_lot_no        text,
  p_qty           numeric,
  p_status        material_lot_status default 'quarantine',
  p_received_date date                default null,
  p_expiry_date   date                default null,
  p_note          text                default null
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
  if not public.can_manage_materials() then
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารจัดการคลังวัตถุดิบได้';
  end if;

  p_lot_no := btrim(coalesce(p_lot_no, ''));
  if p_material_id is null
     or not exists (select 1 from public.materials where id = p_material_id) then
    raise exception 'ไม่พบวัตถุดิบที่เลือก';
  end if;
  if p_lot_no = '' then raise exception 'กรุณาระบุเลขล็อต (lot)'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'จำนวนคงเหลือห้ามติดลบ'; end if;
  if p_expiry_date is not null and p_received_date is not null
     and p_expiry_date < p_received_date then
    raise exception 'วันหมดอายุต้องไม่ก่อนวันรับเข้า';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'จัดการล็อตวัตถุดิบ ' || p_lot_no, true);

  if p_id is null then
    if exists (select 1 from public.material_lots
                where material_id = p_material_id and lot_no = p_lot_no) then
      raise exception 'ล็อต % ของวัตถุดิบนี้มีอยู่แล้ว', p_lot_no;
    end if;
    insert into public.material_lots
      (material_id, lot_no, qty_on_hand, status, received_date, expiry_date, note, created_by)
    values
      (p_material_id, p_lot_no, p_qty, coalesce(p_status, 'quarantine'),
       p_received_date, p_expiry_date, nullif(btrim(coalesce(p_note, '')), ''), v_profile)
    returning id into v_id;
  else
    if not exists (select 1 from public.material_lots where id = p_id) then
      raise exception 'ไม่พบล็อตที่เลือก';
    end if;
    if exists (select 1 from public.material_lots
                where material_id = p_material_id and lot_no = p_lot_no and id <> p_id) then
      raise exception 'ล็อต % ของวัตถุดิบนี้ซ้ำกับล็อตอื่น', p_lot_no;
    end if;
    update public.material_lots
       set lot_no = p_lot_no, qty_on_hand = p_qty,
           status = coalesce(p_status, status),
           received_date = p_received_date, expiry_date = p_expiry_date,
           note = nullif(btrim(coalesce(p_note, '')), ''), updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_material_lot(
  uuid, uuid, text, numeric, material_lot_status, date, date, text
) to authenticated;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.materials;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.material_lots;
exception when duplicate_object then null; end $$;
