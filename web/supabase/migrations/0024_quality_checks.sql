-- ============================================================
-- PD Monitor — D11 / 0024_quality_checks.sql  (A6 ก้อน 2: in-process QC + QA sample)
--   inprocess_checks = ผลตรวจ QC ระหว่างผลิต (param/ค่า/ผ่าน-ไม่ผ่าน ต่อสถานี)
--   qa_samples       = จุด/รอบเก็บตัวอย่างของ QA
-- เขียนผ่าน RPC security definer · in-process = qc/manager · sample = qa/manager
-- (หมายเหตุ: in-process ที่ "ไม่ผ่าน" จะเชื่อม deviation B3 ภายหลัง)
-- รัน "หลัง" 0001–0023
-- ============================================================

do $$ begin
  create type check_result as enum ('pass', 'fail');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- inprocess_checks — QC ระหว่างผลิต
-- ------------------------------------------------------------
create table if not exists public.inprocess_checks (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  station     production_station not null,
  param       text not null,                 -- หัวข้อตรวจ เช่น น้ำหนักเม็ด/ความแข็ง/ความชื้น
  value       text,                           -- ค่าที่วัดได้ (ตัวเลขหรือข้อความ)
  unit        text,
  result      check_result not null default 'pass',
  checked_at  timestamptz not null default now(),
  checked_by  uuid references public.profiles(id),
  note        text,
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);

-- ------------------------------------------------------------
-- qa_samples — จุด/รอบเก็บตัวอย่าง QA
-- ------------------------------------------------------------
create table if not exists public.qa_samples (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  sample_point text not null,                 -- เช่น ต้นรอบ/กลางรอบ/ปลายรอบ
  qty          numeric(14,2) check (qty is null or qty >= 0),
  unit         text,
  collected_at timestamptz not null default now(),
  collected_by uuid references public.profiles(id),
  note         text,
  created_by   uuid references public.profiles(id),
  updated_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);

create index if not exists idx_inprocess_checks_job on public.inprocess_checks(job_id);
create index if not exists idx_qa_samples_job        on public.qa_samples(job_id);

-- ------------------------------------------------------------
-- triggers: meta + audit
-- ------------------------------------------------------------
drop trigger if exists trg_meta_inprocess_checks on public.inprocess_checks;
create trigger trg_meta_inprocess_checks before insert or update on public.inprocess_checks
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_inprocess_checks on public.inprocess_checks;
create trigger trg_audit_inprocess_checks after insert or update or delete on public.inprocess_checks
  for each row execute function public.log_audit();

drop trigger if exists trg_meta_qa_samples on public.qa_samples;
create trigger trg_meta_qa_samples before insert or update on public.qa_samples
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_qa_samples on public.qa_samples;
create trigger trg_audit_qa_samples after insert or update or delete on public.qa_samples
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.inprocess_checks enable row level security;
alter table public.qa_samples enable row level security;

drop policy if exists read_inprocess_checks on public.inprocess_checks;
create policy read_inprocess_checks on public.inprocess_checks
  for select to authenticated using (true);

drop policy if exists read_qa_samples on public.qa_samples;
create policy read_qa_samples on public.qa_samples
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- add_inprocess_check — บันทึกผลตรวจ QC ระหว่างผลิต
-- ------------------------------------------------------------
create or replace function public.add_inprocess_check(
  p_job_id  uuid,
  p_station production_station,
  p_param   text,
  p_value   text   default null,
  p_unit    text   default null,
  p_result  check_result default 'pass',
  p_note    text   default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  if p_station is null then raise exception 'กรุณาเลือกสถานี'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกตรวจระหว่างผลิต ' || p_param, true);

  insert into public.inprocess_checks
    (job_id, station, param, value, unit, result, checked_by, note, created_by)
  values
    (p_job_id, p_station, p_param,
     nullif(btrim(coalesce(p_value, '')), ''),
     nullif(btrim(coalesce(p_unit, '')), ''),
     coalesce(p_result, 'pass'), v_profile,
     nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.add_inprocess_check(
  uuid, production_station, text, text, text, check_result, text
) to authenticated;

-- ------------------------------------------------------------
-- add_qa_sample — บันทึกจุด/รอบเก็บตัวอย่าง QA
-- ------------------------------------------------------------
create or replace function public.add_qa_sample(
  p_job_id       uuid,
  p_sample_point text,
  p_qty          numeric default null,
  p_unit         text    default null,
  p_note         text    default null
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
  if not (public.has_role('qa') or public.has_role('manager')) then
    raise exception 'เฉพาะ QA/ผู้บริหารบันทึกจุดเก็บตัวอย่างได้';
  end if;

  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'ไม่พบงานที่เลือก';
  end if;
  p_sample_point := nullif(btrim(coalesce(p_sample_point, '')), '');
  if p_sample_point is null then raise exception 'กรุณาระบุจุด/รอบเก็บตัวอย่าง'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'จำนวนตัวอย่างห้ามติดลบ'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกจุดเก็บตัวอย่าง QA ' || p_sample_point, true);

  insert into public.qa_samples
    (job_id, sample_point, qty, unit, collected_by, note, created_by)
  values
    (p_job_id, p_sample_point, p_qty,
     nullif(btrim(coalesce(p_unit, '')), ''),
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.add_qa_sample(uuid, text, numeric, text, text)
  to authenticated;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.inprocess_checks;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.qa_samples;
exception when duplicate_object then null; end $$;
