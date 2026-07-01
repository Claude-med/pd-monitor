-- ============================================================
-- PD Monitor — เฟสหลัง / 0033_edit_requests.sql  (F1: ขออนุมัติแก้ไขย้อนหลัง)
--   ข้อมูลที่บันทึกแล้วเป็น append-only (GMP) — ถ้ากรอกผิดต้อง "ขออนุมัติแก้"
--   edit_requests = คำขอแก้ไข (target_type + changes jsonb + เหตุผล)
--   อนุมัติ = manager/admin เสมอ · qa อนุมัติได้เฉพาะข้อมูล QC (inprocess_check)
--   approve → UPDATE ตารางจริง (audit_log trigger เก็บ old→new อัตโนมัติ)
-- ครอบ 3 ชนิด: production_records · material_requisitions · inprocess_checks
-- รัน "หลัง" 0001–0032
-- ============================================================

do $$ begin
  create type edit_target_type as enum
    ('production_record', 'material_requisition', 'inprocess_check');
exception when duplicate_object then null; end $$;

do $$ begin
  create type edit_request_status as enum ('pending', 'applied', 'rejected');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- edit_requests
-- ------------------------------------------------------------
create table if not exists public.edit_requests (
  id           uuid primary key default gen_random_uuid(),
  target_type  edit_target_type not null,
  target_id    uuid not null,
  job_id       uuid references public.jobs(id) on delete cascade,  -- context/แจ้งเตือน
  changes      jsonb not null,                                     -- ค่าฟิลด์ใหม่ (เฉพาะที่ whitelist)
  reason       text not null,
  status       edit_request_status not null default 'pending',
  requested_by uuid references public.profiles(id),
  reviewed_by  uuid references public.profiles(id),
  review_note  text,
  requested_at timestamptz not null default now(),
  reviewed_at  timestamptz,
  created_by   uuid references public.profiles(id),
  updated_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);

create index if not exists idx_edit_requests_job    on public.edit_requests(job_id);
create index if not exists idx_edit_requests_status on public.edit_requests(status);
create index if not exists idx_edit_requests_target on public.edit_requests(target_type, target_id);

-- ------------------------------------------------------------
-- triggers: meta + audit
-- ------------------------------------------------------------
drop trigger if exists trg_meta_edit_requests on public.edit_requests;
create trigger trg_meta_edit_requests before insert or update on public.edit_requests
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_edit_requests on public.edit_requests;
create trigger trg_audit_edit_requests after insert or update or delete on public.edit_requests
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- RLS: authenticated อ่านได้ (ผู้ขอเห็นสถานะ · ผู้อนุมัติเห็นรายการ) · เขียนผ่าน RPC
-- ------------------------------------------------------------
alter table public.edit_requests enable row level security;
drop policy if exists read_edit_requests on public.edit_requests;
create policy read_edit_requests on public.edit_requests
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- request_edit — ยื่นคำขอแก้ไข (ผู้ใช้ที่ล็อกอิน) · whitelist ฟิลด์ต่อชนิด
-- ------------------------------------------------------------
create or replace function public.request_edit(
  p_target_type edit_target_type,
  p_target_id   uuid,
  p_changes     jsonb,
  p_reason      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_job     uuid;
  v_job_no  text;
  v_reason  text;
  v_id      uuid;
  v_allowed text[];
  v_key     text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'กรุณาระบุเหตุผลการขอแก้ไข'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'ไม่มีรายการที่จะแก้ไข';
  end if;

  -- whitelist ฟิลด์ + ดึง job_id ต่อชนิด
  if p_target_type = 'production_record' then
    v_allowed := array['input_qty','output_qty','loss_qty','hours','headcount','note','record_date','station','machine_id'];
    select job_id into v_job from public.production_records where id = p_target_id;
  elsif p_target_type = 'material_requisition' then
    v_allowed := array['qty','note'];
    select job_id into v_job from public.material_requisitions where id = p_target_id;
  else -- inprocess_check
    v_allowed := array['param','value','unit','result','note'];
    select job_id into v_job from public.inprocess_checks where id = p_target_id;
  end if;
  if v_job is null then raise exception 'ไม่พบรายการที่จะขอแก้ไข'; end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'ฟิลด์ "%" แก้ไขไม่ได้', v_key;
    end if;
  end loop;

  -- กันคำขอค้างซ้ำต่อรายการเดียวกัน
  if exists (
    select 1 from public.edit_requests
    where target_type = p_target_type and target_id = p_target_id and status = 'pending'
  ) then
    raise exception 'มีคำขอแก้ไขรายการนี้ที่รออนุมัติอยู่แล้ว';
  end if;

  select job_no into v_job_no from public.jobs where id = v_job;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ยื่นคำขอแก้ไขย้อนหลัง', true);

  insert into public.edit_requests
    (target_type, target_id, job_id, changes, reason, requested_by, created_by)
  values
    (p_target_type, p_target_id, v_job, p_changes, v_reason, v_profile, v_profile)
  returning id into v_id;

  -- แจ้งผู้อนุมัติ: manager เสมอ (+ qa ถ้าเป็นข้อมูล QC)
  perform public.create_notification(
    'edit_request',
    'คำขอแก้ไขย้อนหลัง — งาน ' || coalesce(v_job_no, ''),
    v_reason, v_job, v_job_no, 'manager'::app_role, null::job_status);
  if p_target_type = 'inprocess_check' then
    perform public.create_notification(
      'edit_request',
      'คำขอแก้ไขผลตรวจ QC — งาน ' || coalesce(v_job_no, ''),
      v_reason, v_job, v_job_no, 'qa'::app_role, null::job_status);
  end if;

  return v_id;
end;
$$;

grant execute on function public.request_edit(edit_target_type, uuid, jsonb, text) to authenticated;

-- ------------------------------------------------------------
-- review_edit_request — อนุมัติ (→ apply) / ปฏิเสธ คำขอ
--   manager/admin เสมอ · qa เฉพาะ target_type = inprocess_check
-- ------------------------------------------------------------
create or replace function public.review_edit_request(
  p_id       uuid,
  p_decision text,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_req     public.edit_requests%rowtype;
  v_note    text;
  v_job_no  text;
  v_in      numeric;
  v_out     numeric;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  select * into v_req from public.edit_requests where id = p_id for update;
  if not found then raise exception 'ไม่พบคำขอแก้ไข'; end if;
  if v_req.status <> 'pending' then raise exception 'คำขอนี้ถูกดำเนินการไปแล้ว'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'คำสั่งไม่ถูกต้อง'; end if;

  -- สิทธิ์อนุมัติ
  if not (public.has_role('manager')
          or (v_req.target_type = 'inprocess_check' and public.has_role('qa'))) then
    raise exception 'สิทธิ์ของคุณอนุมัติคำขอนี้ไม่ได้';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  select job_no into v_job_no from public.jobs where id = v_req.job_id;

  perform set_config('app.current_profile_id', v_profile::text, true);

  -- ---------- ปฏิเสธ ----------
  if p_decision = 'reject' then
    perform set_config('app.audit_reason', 'ปฏิเสธคำขอแก้ไข', true);
    update public.edit_requests
       set status = 'rejected', reviewed_by = v_profile, reviewed_at = now(),
           review_note = v_note, updated_by = v_profile
     where id = p_id;
    perform public.create_notification(
      'edit_reviewed', 'คำขอแก้ไขถูกปฏิเสธ',
      coalesce(v_note, 'ไม่ระบุเหตุผล'), v_req.job_id, v_job_no, null::app_role, null::job_status);
    return;
  end if;

  -- ---------- อนุมัติ → apply UPDATE จริง (audit_log trigger เก็บ old→new) ----------
  perform set_config('app.audit_reason', 'แก้ไขย้อนหลังตามคำขอที่อนุมัติ', true);

  if v_req.target_type = 'production_record' then
    update public.production_records set
      input_qty   = case when v_req.changes ? 'input_qty'   then (v_req.changes->>'input_qty')::numeric   else input_qty   end,
      output_qty  = case when v_req.changes ? 'output_qty'  then (v_req.changes->>'output_qty')::numeric  else output_qty  end,
      loss_qty    = case when v_req.changes ? 'loss_qty'    then (v_req.changes->>'loss_qty')::numeric    else loss_qty    end,
      hours       = case when v_req.changes ? 'hours'       then (v_req.changes->>'hours')::numeric       else hours       end,
      headcount   = case when v_req.changes ? 'headcount'   then (v_req.changes->>'headcount')::integer   else headcount   end,
      note        = case when v_req.changes ? 'note'        then nullif(btrim(v_req.changes->>'note'), '') else note        end,
      record_date = case when v_req.changes ? 'record_date' then (v_req.changes->>'record_date')::date    else record_date end,
      station     = case when v_req.changes ? 'station'     then (v_req.changes->>'station')::production_station else station end,
      machine_id  = case when v_req.changes ? 'machine_id'  then nullif(v_req.changes->>'machine_id', '')::uuid  else machine_id  end,
      updated_by  = v_profile
    where id = v_req.target_id;
    -- re-validate: ผลิตได้ต้องไม่เกินตั้งต้น
    select input_qty, output_qty into v_in, v_out
    from public.production_records where id = v_req.target_id;
    if v_in is not null and v_out is not null and v_out > v_in then
      raise exception 'แก้ไม่ได้ — ผลิตได้ต้องไม่เกินจำนวนตั้งต้น';
    end if;

  elsif v_req.target_type = 'material_requisition' then
    update public.material_requisitions set
      qty        = case when v_req.changes ? 'qty'  then (v_req.changes->>'qty')::numeric        else qty  end,
      note       = case when v_req.changes ? 'note' then nullif(btrim(v_req.changes->>'note'), '') else note end,
      updated_by = v_profile
    where id = v_req.target_id;

  else -- inprocess_check
    update public.inprocess_checks set
      param      = case when v_req.changes ? 'param'  then nullif(btrim(v_req.changes->>'param'), '') else param  end,
      value      = case when v_req.changes ? 'value'  then nullif(btrim(v_req.changes->>'value'), '') else value  end,
      unit       = case when v_req.changes ? 'unit'   then nullif(btrim(v_req.changes->>'unit'), '')  else unit   end,
      result     = case when v_req.changes ? 'result' then (v_req.changes->>'result')::check_result   else result end,
      note       = case when v_req.changes ? 'note'   then nullif(btrim(v_req.changes->>'note'), '')  else note   end,
      updated_by = v_profile
    where id = v_req.target_id;
  end if;

  update public.edit_requests
     set status = 'applied', reviewed_by = v_profile, reviewed_at = now(),
         review_note = v_note, updated_by = v_profile
   where id = p_id;

  perform public.create_notification(
    'edit_reviewed', 'คำขอแก้ไขได้รับอนุมัติ',
    'ข้อมูลถูกแก้ไขตามคำขอแล้ว', v_req.job_id, v_job_no, null::app_role, null::job_status);
end;
$$;

grant execute on function public.review_edit_request(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- cancel_edit_request — ผู้ขอ (หรือ manager) ยกเลิกคำขอที่ยังรออนุมัติ
-- ------------------------------------------------------------
create or replace function public.cancel_edit_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_req     public.edit_requests%rowtype;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  select * into v_req from public.edit_requests where id = p_id for update;
  if not found then raise exception 'ไม่พบคำขอแก้ไข'; end if;
  if v_req.status <> 'pending' then raise exception 'คำขอถูกดำเนินการไปแล้ว ยกเลิกไม่ได้'; end if;
  if v_req.requested_by <> v_profile and not public.has_role('manager') then
    raise exception 'ยกเลิกได้เฉพาะผู้ยื่นคำขอหรือผู้บริหาร';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ยกเลิกคำขอแก้ไข', true);
  update public.edit_requests
     set status = 'rejected', review_note = '(ผู้ยื่นยกเลิกเอง)',
         reviewed_by = v_profile, reviewed_at = now(), updated_by = v_profile
   where id = p_id;
end;
$$;

grant execute on function public.cancel_edit_request(uuid) to authenticated;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.edit_requests;
exception when duplicate_object then null; end $$;
