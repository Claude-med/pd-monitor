-- ============================================================
-- PD Monitor — D12 / 0025_deviations.sql  (B3: Deviation / Incident)
--   deviations = บันทึกเหตุผิดปกติ (ประเภท/ความรุนแรง/ผู้รับผิดชอบ/กำหนดปิด/root cause/CAPA)
--     ผูกกับ job · (ออปชัน) เครื่องจักร · (ออปชัน) ผลตรวจ in-process ที่ "ไม่ผ่าน"
-- กติกา (ยืนยันกับผู้ใช้):
--   - เปิด deviation ได้: production / qc / qa / manager
--   - ปิด deviation (status=closed) ได้เฉพาะ: qa / manager  + ต้องมี root_cause + capa
--   - GATE: ถ้างานมี deviation "เปิดค้าง" (status ≠ closed) → ห้ามเปลี่ยน qa → finished_goods
-- เขียนผ่าน RPC security definer · รัน "หลัง" 0001–0024
-- ============================================================

do $$ begin
  create type deviation_severity as enum ('minor', 'major', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type deviation_status as enum ('open', 'investigating', 'closed');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- deviations — เหตุผิดปกติต่องาน
-- ------------------------------------------------------------
create table if not exists public.deviations (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs(id) on delete cascade,
  machine_id         uuid references public.machines(id),
  inprocess_check_id uuid references public.inprocess_checks(id) on delete set null,
  title              text not null,
  description        text,
  dev_type           text not null default 'other',  -- in_process_fail / equipment / material / process / other
  severity           deviation_severity not null default 'minor',
  status             deviation_status   not null default 'open',
  reported_by        uuid references public.profiles(id),
  assigned_to        uuid references public.profiles(id),
  due_date           date,
  root_cause         text,
  capa               text,                            -- การแก้ไข/ป้องกัน (corrective/preventive action)
  closed_by          uuid references public.profiles(id),
  closed_at          timestamptz,
  created_by         uuid references public.profiles(id),
  updated_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1
);

create index if not exists idx_deviations_job      on public.deviations(job_id);
create index if not exists idx_deviations_status   on public.deviations(status);
create index if not exists idx_deviations_severity on public.deviations(severity);

-- ------------------------------------------------------------
-- triggers: meta + audit
-- ------------------------------------------------------------
drop trigger if exists trg_meta_deviations on public.deviations;
create trigger trg_meta_deviations before insert or update on public.deviations
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_deviations on public.deviations;
create trigger trg_audit_deviations after insert or update or delete on public.deviations
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- RLS — อ่านได้ทุก authenticated · เขียนผ่าน RPC เท่านั้น
-- ------------------------------------------------------------
alter table public.deviations enable row level security;
drop policy if exists read_deviations on public.deviations;
create policy read_deviations on public.deviations
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- helper: งานนี้มี deviation "เปิดค้าง" (ยังไม่ closed) ไหม
-- ------------------------------------------------------------
create or replace function public.has_open_deviation(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.deviations
     where job_id = p_job_id and status <> 'closed'
  );
$$;

-- ------------------------------------------------------------
-- open_deviation — เปิดเหตุผิดปกติใหม่ (production/qc/qa/manager)
-- ------------------------------------------------------------
create or replace function public.open_deviation(
  p_job_id             uuid,
  p_title              text,
  p_description        text   default null,
  p_dev_type           text   default 'other',
  p_severity           deviation_severity default 'minor',
  p_machine_id         uuid   default null,
  p_inprocess_check_id uuid   default null,
  p_assigned_to        uuid   default null,
  p_due_date           date   default null
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
  if not (public.has_role('production') or public.has_role('qc')
          or public.has_role('qa') or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณเปิด deviation ไม่ได้';
  end if;

  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'ไม่พบงานที่เลือก';
  end if;
  p_title := nullif(btrim(coalesce(p_title, '')), '');
  if p_title is null then raise exception 'กรุณาระบุหัวข้อ deviation'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'เปิด deviation: ' || p_title, true);

  insert into public.deviations
    (job_id, machine_id, inprocess_check_id, title, description, dev_type,
     severity, status, reported_by, assigned_to, due_date, created_by)
  values
    (p_job_id, p_machine_id, p_inprocess_check_id, p_title,
     nullif(btrim(coalesce(p_description, '')), ''),
     coalesce(nullif(btrim(coalesce(p_dev_type, '')), ''), 'other'),
     coalesce(p_severity, 'minor'), 'open', v_profile, p_assigned_to,
     p_due_date, v_profile)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.open_deviation(
  uuid, text, text, text, deviation_severity, uuid, uuid, uuid, date
) to authenticated;

-- ------------------------------------------------------------
-- update_deviation — แก้ไข/สอบสวน/ปิด deviation
--   เปิด/แก้ได้: production/qc/qa/manager · ปิด (status=closed) เฉพาะ qa/manager + ต้องมี root_cause + capa
-- ------------------------------------------------------------
create or replace function public.update_deviation(
  p_id          uuid,
  p_status      deviation_status,
  p_root_cause  text default null,
  p_capa        text default null,
  p_assigned_to uuid default null,
  p_due_date    date default null,
  p_severity    deviation_severity default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_cur     record;
  v_rc      text;
  v_capa    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('production') or public.has_role('qc')
          or public.has_role('qa') or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณแก้ไข deviation ไม่ได้';
  end if;

  select * into v_cur from public.deviations where id = p_id for update;
  if v_cur.id is null then raise exception 'ไม่พบ deviation'; end if;

  v_rc   := coalesce(nullif(btrim(coalesce(p_root_cause, '')), ''), v_cur.root_cause);
  v_capa := coalesce(nullif(btrim(coalesce(p_capa, '')), ''), v_cur.capa);

  -- ปิด deviation = สิทธิ์สูง + ต้องมี root cause + CAPA
  if p_status = 'closed' then
    if not (public.has_role('qa') or public.has_role('manager')) then
      raise exception 'ปิด deviation ได้เฉพาะ QA/ผู้บริหาร';
    end if;
    if v_rc is null or v_capa is null then
      raise exception 'ต้องระบุสาเหตุ (root cause) และการแก้ไข/ป้องกัน (CAPA) ก่อนปิด deviation';
    end if;
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'อัปเดต deviation → ' || p_status::text, true);

  update public.deviations
     set status      = coalesce(p_status, status),
         root_cause  = v_rc,
         capa        = v_capa,
         assigned_to = coalesce(p_assigned_to, assigned_to),
         due_date    = coalesce(p_due_date, due_date),
         severity    = coalesce(p_severity, severity),
         closed_by   = case when p_status = 'closed' then v_profile else null end,
         closed_at   = case when p_status = 'closed' then now()      else null end,
         updated_by  = v_profile
   where id = p_id;
end;
$$;

grant execute on function public.update_deviation(
  uuid, deviation_status, text, text, uuid, date, deviation_severity
) to authenticated;

-- ============================================================
-- ยกเครื่อง advance_job_status: เพิ่ม GATE Deviation ที่ qa → finished_goods
-- (คง GATE Line Clearance เดิมจาก 0018 ไว้ทุกประการ)
-- ============================================================
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
  v_is_reject boolean := false;
  v_allowed   boolean := false;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  select status into v_from from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from = p_to then
    raise exception 'สถานะไม่เปลี่ยนแปลง';
  end if;

  if    v_from = 'pending_announce' and p_to = 'planned' then
    v_allowed := public.has_role('manager');
  elsif v_from = 'planned'          and p_to = 'in_production' then
    v_allowed := public.has_role('production') or public.has_role('manager');
    -- GATE: ต้องผ่าน Line Clearance ก่อนเริ่มผลิต (A3)
    if v_allowed and not public.line_clearance_passed(p_job_id) then
      raise exception 'เริ่มผลิตไม่ได้ — ต้องทำ Line Clearance ให้ผ่านก่อน (เคลียร์ของเก่า/ทำความสะอาด/ตั้งเครื่อง + ผู้ตรวจรับเซ็น)';
    end if;
  elsif v_from = 'in_production'     and p_to = 'qc' then
    v_allowed := public.has_role('production');
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
end;
$$;

grant execute on function public.advance_job_status(uuid, job_status, text) to authenticated;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.deviations;
exception when duplicate_object then null; end $$;
