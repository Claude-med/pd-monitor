-- ============================================================
-- PD Monitor — D10 / 0014_machines.sql  (A1 ก้อน 1: ทะเบียนเครื่องจักร)
-- ตาราง machines + RPC upsert (manager/admin) ตามแพตเทิร์นเดิม:
--   เขียนผ่านฟังก์ชัน security definer → บังคับสิทธิ์ที่ server + ตั้ง audit GUC
-- (ก้อนถัดไปค่อยผูก machine_id ใน production_records + กันใช้เครื่องที่ซ่อม)
-- รัน "หลัง" 0001–0013
-- ============================================================

-- ------------------------------------------------------------
-- enum สถานะเครื่องจักร (ตาม brief CEO: พร้อม/ใช้งาน/ทำความสะอาด/ซ่อม/calibration หมดอายุ)
-- ------------------------------------------------------------
do $$ begin
  create type machine_status as enum (
    'available',       -- พร้อมใช้
    'in_use',          -- กำลังใช้งาน
    'cleaning',        -- ทำความสะอาด
    'maintenance',     -- ซ่อมบำรุง
    'calibration_due'  -- ถึงกำหนดสอบเทียบ (calibration)
  );
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- ตาราง machines + คอลัมน์ ALCOA + trigger meta/audit
-- ------------------------------------------------------------
create table if not exists public.machines (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  name                   text not null,
  station                production_station,           -- เครื่องนี้อยู่สถานีไหน (null = ไม่ระบุ)
  status                 machine_status not null default 'available',
  note                   text,
  last_clean_date        date,
  next_maintenance_date  date,
  next_calibration_date  date,
  is_active              boolean not null default true,
  created_by             uuid references public.profiles(id),
  updated_by             uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                integer not null default 1
);

create index if not exists idx_machines_station on public.machines(station);
create index if not exists idx_machines_status  on public.machines(status);

drop trigger if exists trg_meta_machines on public.machines;
create trigger trg_meta_machines before insert or update on public.machines
  for each row execute function public.set_row_meta();

drop trigger if exists trg_audit_machines on public.machines;
create trigger trg_audit_machines after insert or update or delete on public.machines
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- RLS: เปิด (default-deny) · authenticated อ่านได้ทุกคน (ทุกฝ่ายเห็นสถานะเครื่อง)
--      เขียนผ่าน RPC security definer ด้านล่าง (ไม่เปิด write policy ตรง)
-- ------------------------------------------------------------
alter table public.machines enable row level security;

drop policy if exists read_machines on public.machines;
create policy read_machines on public.machines
  for select to authenticated
  using (true);

-- ------------------------------------------------------------
-- upsert_machine — เพิ่ม/แก้เครื่องจักร (manager หรือ admin)
--   p_id = null → เพิ่มใหม่ · มีค่า → แก้ของเดิม
-- ------------------------------------------------------------
create or replace function public.upsert_machine(
  p_id                    uuid,
  p_code                  text,
  p_name                  text,
  p_station               production_station default null,
  p_status                machine_status     default 'available',
  p_note                  text               default null,
  p_last_clean_date       date               default null,
  p_next_maintenance_date date               default null,
  p_next_calibration_date date               default null
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
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหาร/ผู้ดูแลระบบจัดการเครื่องจักรได้';
  end if;

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
      (code, name, station, status, note,
       last_clean_date, next_maintenance_date, next_calibration_date, created_by)
    values
      (p_code, p_name, p_station, coalesce(p_status, 'available'),
       nullif(btrim(coalesce(p_note, '')), ''),
       p_last_clean_date, p_next_maintenance_date, p_next_calibration_date, v_profile)
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
           status = coalesce(p_status, status),
           note = nullif(btrim(coalesce(p_note, '')), ''),
           last_clean_date = p_last_clean_date,
           next_maintenance_date = p_next_maintenance_date,
           next_calibration_date = p_next_calibration_date,
           updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_machine(
  uuid, text, text, production_station, machine_status, text, date, date, date
) to authenticated;

-- ------------------------------------------------------------
-- เปิด realtime ให้ตาราง machines (หน้าจอ subscribe เพื่ออัปเดตสถานะสด) · รันซ้ำได้
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.machines;
exception when duplicate_object then null; end $$;
