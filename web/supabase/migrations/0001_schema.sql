-- ============================================================
-- PD Monitor — D2 / 0001_schema.sql
-- โครงสร้างฐานข้อมูลหลัก + คอลัมน์ ALCOA+ + trigger updated_at/version
-- (อ่านคู่กับ docs/recommendations.md หมวด A2/A4/A5/D)
-- รันไฟล์นี้ "ก่อน" 0002 และ 0003 เสมอ
-- ============================================================

-- gen_random_uuid() มากับ pgcrypto (Supabase เปิดให้อยู่แล้ว แต่ใส่กันเหนียว)
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------

-- role ของผู้ใช้ (requirement: ผลิต/QC/QA/คลัง/ผู้บริหาร)
do $$ begin
  create type app_role as enum ('production', 'qc', 'qa', 'warehouse', 'manager');
exception when duplicate_object then null; end $$;

-- สถานะงานผลิต — state machine (requirement ข้อ 2: ห้ามข้ามลำดับ)
-- รอแจ้งผลิต -> มีแผนแล้ว -> กำลังผลิต -> QC -> QA -> FG
do $$ begin
  create type job_status as enum (
    'pending_announce',  -- รอแจ้งผลิต
    'planned',           -- มีแผนแล้ว
    'in_production',     -- กำลังผลิต
    'qc',                -- รอ/อยู่ระหว่าง QC
    'qa',                -- รอ/อยู่ระหว่าง QA
    'finished_goods'     -- FG (เสร็จ เข้าคลัง)
  );
exception when duplicate_object then null; end $$;

-- ป้ายปัญหา (requirement ข้อ 3) — แยกจาก flow หลัก เป็น null ได้ = ปกติ
do $$ begin
  create type problem_flag as enum (
    'blocked',     -- ติดปัญหา
    'waiting_fix', -- รอแก้ไข
    'delayed'      -- ล่าช้า
  );
exception when duplicate_object then null; end $$;

-- สถานีผลิต (PRD: เตรียมยา/ผสม/ตอก/บรรจุ)
do $$ begin
  create type production_station as enum ('prep', 'mixing', 'tableting', 'packing');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- helper: trigger ตั้ง updated_at = เวลา server + เพิ่ม version
-- + กัน client เขียนทับ created_at/created_by (ALCOA: Original)
-- ------------------------------------------------------------
create or replace function public.set_row_meta()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if (tg_op = 'UPDATE') then
    new.version    := coalesce(old.version, 1) + 1;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- profiles — ตัวแทนผู้ใช้ในระบบ
-- (D2 ยังไม่มี auth จริง → ตารางนี้ standalone, ผูก auth.users ใน D3)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,                 -- เชื่อม auth.users ใน D3
  full_name    text not null,
  department   text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);

-- user_roles — 1 ผู้ใช้มีได้หลาย role
create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       app_role not null,
  created_at timestamptz not null default now(),
  unique (profile_id, role)
);

-- ------------------------------------------------------------
-- products — ฐานข้อมูลยา (PRD: Products Database + Standard Time)
-- ------------------------------------------------------------
create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  dosage_form         text,                          -- รูปแบบ เช่น เม็ด/แคปซูล/ครีม
  standard_time_hours numeric(10,2) check (standard_time_hours >= 0),
  is_active           boolean not null default true,
  created_by          uuid references public.profiles(id),
  updated_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1
);

-- ------------------------------------------------------------
-- orders — Pending Order จากลูกค้า
-- ------------------------------------------------------------
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  order_no    text not null unique,
  customer    text not null,
  product_id  uuid references public.products(id),
  quantity    numeric(14,2) not null check (quantity > 0),
  unit        text not null default 'เม็ด',
  due_date    date,
  note        text,
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);

-- ------------------------------------------------------------
-- batches — lot/batch + วันผลิต/วันหมดอายุ (A4 traceability)
-- ------------------------------------------------------------
create table if not exists public.batches (
  id               uuid primary key default gen_random_uuid(),
  lot_no           text not null unique,
  order_id         uuid references public.orders(id),
  product_id       uuid references public.products(id),
  manufacture_date date,
  expiry_date      date,
  created_by       uuid references public.profiles(id),
  updated_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  constraint batches_expiry_after_mfg
    check (expiry_date is null or manufacture_date is null or expiry_date > manufacture_date)
);

-- ------------------------------------------------------------
-- jobs — งานผลิต 1 งาน/order (หัวใจ state machine)
-- ------------------------------------------------------------
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  job_no        text not null unique,
  order_id      uuid not null references public.orders(id),
  batch_id      uuid references public.batches(id),    -- ผูก lot เมื่อเริ่มผลิต
  status        job_status not null default 'pending_announce',
  problem       problem_flag,                          -- null = ปกติ
  problem_note  text,
  planned_start date,
  planned_end   date,
  created_by    uuid references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

-- ------------------------------------------------------------
-- production_records — Daily Report ของแต่ละสถานี
-- (C2: output <= input, ห้ามค่าติดลบ — ตรวจที่ DB ด้วย)
-- ------------------------------------------------------------
create table if not exists public.production_records (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  station     production_station not null,
  record_date date not null default current_date,
  input_qty   numeric(14,2) check (input_qty  >= 0),
  output_qty  numeric(14,2) check (output_qty >= 0),
  loss_qty    numeric(14,2) check (loss_qty   >= 0),
  hours       numeric(8,2)  check (hours       >= 0),
  operator_id uuid references public.profiles(id),
  note        text,
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1,
  constraint prod_output_le_input
    check (input_qty is null or output_qty is null or output_qty <= input_qty)
);

-- ------------------------------------------------------------
-- index สำหรับ FK / คอลัมน์ที่ใช้ค้น-กรอง-RLS บ่อย
-- ------------------------------------------------------------
create index if not exists idx_user_roles_profile     on public.user_roles(profile_id);
create index if not exists idx_orders_product          on public.orders(product_id);
create index if not exists idx_batches_order           on public.batches(order_id);
create index if not exists idx_batches_product         on public.batches(product_id);
create index if not exists idx_batches_lot             on public.batches(lot_no);
create index if not exists idx_jobs_order              on public.jobs(order_id);
create index if not exists idx_jobs_batch              on public.jobs(batch_id);
create index if not exists idx_jobs_status             on public.jobs(status);
create index if not exists idx_prod_job                on public.production_records(job_id);
create index if not exists idx_prod_station            on public.production_records(station);
create index if not exists idx_prod_date               on public.production_records(record_date);

-- ------------------------------------------------------------
-- ผูก trigger set_row_meta (updated_at + version) ทุกตารางหลัก
-- ------------------------------------------------------------
drop trigger if exists trg_meta_profiles            on public.profiles;
drop trigger if exists trg_meta_products            on public.products;
drop trigger if exists trg_meta_orders              on public.orders;
drop trigger if exists trg_meta_batches             on public.batches;
drop trigger if exists trg_meta_jobs                on public.jobs;
drop trigger if exists trg_meta_production_records  on public.production_records;

create trigger trg_meta_profiles           before insert or update on public.profiles
  for each row execute function public.set_row_meta();
create trigger trg_meta_products           before insert or update on public.products
  for each row execute function public.set_row_meta();
create trigger trg_meta_orders             before insert or update on public.orders
  for each row execute function public.set_row_meta();
create trigger trg_meta_batches            before insert or update on public.batches
  for each row execute function public.set_row_meta();
create trigger trg_meta_jobs               before insert or update on public.jobs
  for each row execute function public.set_row_meta();
create trigger trg_meta_production_records before insert or update on public.production_records
  for each row execute function public.set_row_meta();
