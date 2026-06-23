-- ============================================================
-- PD Monitor — D10 / 0018_line_clearance.sql  (A3: Line Clearance / Set-up)
-- เตรียมสายการผลิตก่อนเริ่มผลิต (GMP): เคลียร์ของเก่า / ทำความสะอาด / ตั้งเครื่อง
--   + สองลายเซ็น (ผู้เคลียร์ ≠ ผู้ตรวจรับ)
--   + เป็น GATE: ต้องผ่าน Line Clearance ก่อนเปลี่ยน "มีแผนแล้ว → กำลังผลิต"
-- รัน "หลัง" 0001–0017
-- ============================================================

create table if not exists public.line_clearances (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null unique references public.jobs(id) on delete cascade,
  cleared_old   boolean not null default false,  -- เคลียร์ของเก่า/รุ่นก่อน
  cleaned       boolean not null default false,  -- ทำความสะอาด
  setup_done    boolean not null default false,  -- ตั้งเครื่อง (set-up)
  setup_minutes numeric(8,2) check (setup_minutes >= 0),  -- เวลา set-up (นาที)
  note          text,
  performed_by  uuid references public.profiles(id),
  performed_at  timestamptz,
  checked_by    uuid references public.profiles(id),
  checked_at    timestamptz,
  created_by    uuid references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

create index if not exists idx_line_clearances_job on public.line_clearances(job_id);

drop trigger if exists trg_meta_line_clearances on public.line_clearances;
create trigger trg_meta_line_clearances before insert or update on public.line_clearances
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_line_clearances on public.line_clearances;
create trigger trg_audit_line_clearances after insert or update or delete on public.line_clearances
  for each row execute function public.log_audit();

alter table public.line_clearances enable row level security;
drop policy if exists read_line_clearances on public.line_clearances;
create policy read_line_clearances on public.line_clearances
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- helper: line clearance ของงานนี้ "ผ่าน" แล้วหรือยัง
--   = ติ๊กครบ 3 ข้อ + มีผู้ตรวจรับเซ็น (checked_by)
-- ------------------------------------------------------------
create or replace function public.line_clearance_passed(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select checked_by is not null and cleared_old and cleaned and setup_done
       from public.line_clearances where job_id = p_job_id),
    false);
$$;

-- ------------------------------------------------------------
-- perform_line_clearance — ผู้ปฏิบัติบันทึกการเคลียร์ไลน์ (ฝ่ายผลิต/ผู้บริหาร)
--   การบันทึกใหม่ = ล้างลายเซ็นผู้ตรวจรับเดิม (ต้องตรวจรับใหม่)
-- ------------------------------------------------------------
create or replace function public.perform_line_clearance(
  p_job_id        uuid,
  p_cleared_old   boolean,
  p_cleaned       boolean,
  p_setup_done    boolean,
  p_setup_minutes numeric default null,
  p_note          text    default null
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
  if not (public.has_role('production') or public.has_role('manager')) then
    raise exception 'เฉพาะฝ่ายผลิต/ผู้บริหารบันทึก Line Clearance ได้';
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'ไม่พบงานนี้';
  end if;
  if p_setup_minutes is not null and p_setup_minutes < 0 then
    raise exception 'เวลา set-up ห้ามติดลบ';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึก Line Clearance', true);

  insert into public.line_clearances
    (job_id, cleared_old, cleaned, setup_done, setup_minutes, note,
     performed_by, performed_at, created_by)
  values
    (p_job_id, coalesce(p_cleared_old, false), coalesce(p_cleaned, false),
     coalesce(p_setup_done, false), p_setup_minutes,
     nullif(btrim(coalesce(p_note, '')), ''), v_profile, now(), v_profile)
  on conflict (job_id) do update
    set cleared_old   = excluded.cleared_old,
        cleaned       = excluded.cleaned,
        setup_done    = excluded.setup_done,
        setup_minutes = excluded.setup_minutes,
        note          = excluded.note,
        performed_by  = v_profile,
        performed_at  = now(),
        checked_by    = null,   -- บันทึกใหม่ = ต้องตรวจรับใหม่
        checked_at    = null,
        updated_by    = v_profile;
end;
$$;

grant execute on function public.perform_line_clearance(uuid, boolean, boolean, boolean, numeric, text)
  to authenticated;

-- ------------------------------------------------------------
-- check_line_clearance — ผู้ตรวจรับเซ็น (ต้องคนละคนกับผู้เคลียร์ + ติ๊กครบ)
--   ผู้ตรวจรับ = ฝ่ายผลิต/QC/QA/ผู้บริหาร
-- ------------------------------------------------------------
create or replace function public.check_line_clearance(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_lc      record;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('production') or public.has_role('qc')
          or public.has_role('qa') or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณตรวจรับ Line Clearance ไม่ได้';
  end if;

  select * into v_lc from public.line_clearances where job_id = p_job_id for update;
  if v_lc.id is null or v_lc.performed_by is null then
    raise exception 'ยังไม่มีการบันทึกเคลียร์ไลน์ ให้ฝ่ายผลิตบันทึกก่อน';
  end if;
  if not (v_lc.cleared_old and v_lc.cleaned and v_lc.setup_done) then
    raise exception 'ต้องทำครบทั้ง 3 ข้อ (เคลียร์ของเก่า/ทำความสะอาด/ตั้งเครื่อง) ก่อนตรวจรับ';
  end if;
  if v_lc.performed_by = v_profile then
    raise exception 'ผู้ตรวจรับต้องเป็นคนละคนกับผู้เคลียร์ไลน์ (สองลายเซ็นตามแนว GMP)';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ตรวจรับ Line Clearance', true);

  update public.line_clearances
     set checked_by = v_profile, checked_at = now(), updated_by = v_profile
   where job_id = p_job_id;
end;
$$;

grant execute on function public.check_line_clearance(uuid) to authenticated;

-- ============================================================
-- ยกเครื่อง advance_job_status: เพิ่ม GATE Line Clearance ที่ planned → in_production
-- (เนื้อหาอื่นเหมือน 0006 ทุกประการ)
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

-- realtime
do $$ begin
  alter publication supabase_realtime add table public.line_clearances;
exception when duplicate_object then null; end $$;
