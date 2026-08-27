-- ============================================================
-- PD Monitor — Part C.3 ก้อน 6 / 0064_inprocess_approval.sql
-- ตรวจระหว่างผลิต (In-process QC): Valid date + ขั้นตอน "รออนุมัติ" จากหัวหน้า QC
--
--   (1) enum inprocess_status + คอลัมน์ใหม่ใน inprocess_checks
--   (2) can_record_inprocess() / can_approve_inprocess()
--   (3) add_inprocess_check — เพิ่ม p_valid_date · แถวใหม่เริ่มที่ pending เสมอ
--   (4) review_inprocess_check — หัวหน้า QC อนุมัติ/ไม่อนุมัติ (สองลายเซ็น)
--   (5) inprocess_route_complete — นับเฉพาะผลที่ "อนุมัติแล้วและผ่าน"
--
-- ที่มา (requirement Part C.3):
--   · "หน้าที่ลงผลและตรวจสอบ จะเป็น QC ที่เป็นพนักงาน · หน้าที่อนุมัติ จะเป็นหัวหน้า QC"
--   · "เพิ่มขั้นตอนในการรออนุมัติก่อนว่าให้ผ่านหรือไม่ให้ผ่าน"
--   · "เพิ่มช่องและคอลัม Valid date — เลือกได้ว่าจะกำหนดหรือไม่กำหนดก็ได้"
--
-- ⚠️ ผลกระทบต่อด่าน GMP: inprocess_route_complete() เข้มขึ้น
--    เดิมนับผลที่ result='pass' · ใหม่ต้อง status='approved' ด้วย
--    → ถ้ายังไม่ตั้ง role "หัวหน้า QC" ให้ใคร งานจะส่ง QC ไม่ได้ (ผู้บริหารอนุมัติแทนได้)
--
-- ℹ️ แถวเก่าที่มีอยู่ตอนรัน migration ตั้งเป็น 'approved' ให้เลย —
--    ของเดิมไม่มีขั้นตอนอนุมัติ ผลที่ลงไว้ถือว่ามีผลแล้ว ถ้าตั้งเป็น pending
--    จะกลายเป็นงานที่ "เคยผ่านแล้วกลับไปค้าง" ย้อนหลังโดยไม่มีใครสั่ง
-- รัน "หลัง" 0001–0063
-- ============================================================

-- ------------------------------------------------------------
-- (1) enum + คอลัมน์
-- ------------------------------------------------------------
do $$ begin
  create type inprocess_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

comment on type inprocess_status is
  'สถานะอนุมัติผลตรวจ in-process: pending = รอหัวหน้า QC · approved = อนุมัติแล้ว · rejected = ไม่อนุมัติ';

alter table public.inprocess_checks
  add column if not exists valid_date   date,
  add column if not exists status       inprocess_status not null default 'pending',
  add column if not exists approved_by  uuid references public.profiles(id),
  add column if not exists approved_at  timestamptz,
  add column if not exists approve_note text;

comment on column public.inprocess_checks.valid_date is
  'ผลตรวจนี้ใช้ได้ถึงวันที่ (Valid date) — เว้นว่างได้ แปลว่าไม่กำหนดอายุ';
comment on column public.inprocess_checks.status is
  'ต้องผ่านการอนุมัติจากหัวหน้า QC ก่อนจึงนับเป็นผลจริง (ด่าน inprocess_route_complete)';

-- แถวที่มีอยู่ก่อน migration = ผลที่ลงในระบบเดิมซึ่งไม่มีขั้นตอนอนุมัติ → ถือว่าอนุมัติแล้ว
update public.inprocess_checks
   set status = 'approved'
 where status = 'pending'
   and created_at < now();

create index if not exists idx_inprocess_checks_status
  on public.inprocess_checks (status)
  where status = 'pending';

-- ------------------------------------------------------------
-- (2) สิทธิ์ — แยก "คนลงผล" ออกจาก "คนอนุมัติ"
-- ------------------------------------------------------------
create or replace function public.can_record_inprocess()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('qc') or public.has_role('qc_lead') or public.has_role('manager');
$$;

revoke execute on function public.can_record_inprocess() from public;
revoke execute on function public.can_record_inprocess() from anon;
grant  execute on function public.can_record_inprocess() to authenticated;

comment on function public.can_record_inprocess() is
  'สิทธิ์ลงผลตรวจ in-process = QC/หัวหน้า QC/ผู้บริหาร — ต้องตรงกับ canRecordInprocess() ใน web/lib/data/role-access.ts';

create or replace function public.can_approve_inprocess()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('qc_lead') or public.has_role('manager');
$$;

revoke execute on function public.can_approve_inprocess() from public;
revoke execute on function public.can_approve_inprocess() from anon;
grant  execute on function public.can_approve_inprocess() to authenticated;

comment on function public.can_approve_inprocess() is
  'สิทธิ์อนุมัติผลตรวจ in-process = หัวหน้า QC/ผู้บริหารเท่านั้น — ต้องตรงกับ canApproveInprocess() ใน web/lib/data/role-access.ts';

-- ------------------------------------------------------------
-- (3) add_inprocess_check — เพิ่ม p_valid_date (บอดี้ยกมาจาก 0063 ทั้งดุ้น)
--     ⚠️ signature เปลี่ยน → drop ตัวเดิมก่อน
-- ------------------------------------------------------------
drop function if exists public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid
);

create or replace function public.add_inprocess_check(
  p_job_id               uuid,
  p_job_route_id         uuid,
  p_param                text,
  p_value                text         default null,
  p_unit                 text         default null,
  p_result               check_result default 'pass',
  p_note                 text         default null,
  p_production_record_id uuid         default null,
  p_valid_date           date         default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile    uuid;
  v_id         uuid;
  v_status     job_status;
  v_station_id uuid;
  v_route_job  uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_record_inprocess() then
    raise exception 'เฉพาะ QC/หัวหน้า QC/ผู้บริหารบันทึกผลตรวจระหว่างผลิตได้';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานที่เลือก'; end if;
  if v_status not in ('in_production', 'qc', 'qa') then
    raise exception 'บันทึกตรวจระหว่างผลิตได้เฉพาะงานที่กำลังผลิต/QC/QA';
  end if;

  p_param := nullif(btrim(coalesce(p_param, '')), '');
  if p_param is null then raise exception 'กรุณาระบุหัวข้อที่ตรวจ'; end if;
  if p_job_route_id is null then raise exception 'กรุณาเลือกขั้นตอนการผลิต'; end if;

  select job_id, station_id into v_route_job, v_station_id
    from public.job_routes where id = p_job_route_id;
  if v_station_id is null then raise exception 'ไม่พบขั้นตอนการผลิตที่เลือก'; end if;
  if v_route_job <> p_job_id then
    raise exception 'ขั้นตอนการผลิตนี้ไม่ใช่ของงานที่เลือก';
  end if;

  if p_production_record_id is not null
     and not exists (
       select 1 from public.production_records
        where id = p_production_record_id
          and job_id = p_job_id
          and (job_route_id = p_job_route_id or station_id = v_station_id)
     ) then
    raise exception 'บันทึกผลผลิตที่เลือกไม่ได้อยู่ในขั้นตอนนี้';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกตรวจระหว่างผลิต ' || p_param, true);

  -- แถวใหม่เริ่มที่ pending เสมอ — ไม่ให้ส่ง status เข้ามาเองได้
  -- (แพทเทิร์นเดียวกับ upsert_job_material ที่ไม่มีพารามิเตอร์ status ให้ส่ง · 0056)
  insert into public.inprocess_checks
    (job_id, job_route_id, station_id, production_record_id,
     param, value, unit, result, valid_date, status, checked_by, note, created_by)
  values
    (p_job_id, p_job_route_id, v_station_id, p_production_record_id, p_param,
     nullif(btrim(coalesce(p_value, '')), ''),
     nullif(btrim(coalesce(p_unit, '')), ''),
     coalesce(p_result, 'pass'), p_valid_date, 'pending', v_profile,
     nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid, date
) from public;
revoke execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid, date
) from anon;
grant execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid, date
) to authenticated;

comment on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text, uuid, date
) is
  'บันทึกผลตรวจ in-process (QC) — Part C.3 ก้อน 6: เพิ่ม Valid date · แถวใหม่เป็น pending เสมอ รอหัวหน้า QC อนุมัติ';

-- ------------------------------------------------------------
-- (4) review_inprocess_check — หัวหน้า QC อนุมัติ / ไม่อนุมัติ
--
--     คงกฎสองลายเซ็นแบบเดียวกับ Line Clearance: ผู้อนุมัติต้องคนละคนกับผู้ลงผล
--     (แพทเทิร์น review_edit_request 0033 สำหรับตัวคำสั่ง · check_line_clearance 0062 สำหรับกฎคนละคน)
-- ------------------------------------------------------------
create or replace function public.review_inprocess_check(
  p_id       uuid,
  p_decision text,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_chk     public.inprocess_checks%rowtype;
  v_note    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_approve_inprocess() then
    raise exception 'เฉพาะหัวหน้า QC/ผู้บริหารอนุมัติผลตรวจได้';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'คำสั่งไม่ถูกต้อง';
  end if;

  select * into v_chk from public.inprocess_checks where id = p_id for update;
  if v_chk.id is null then raise exception 'ไม่พบผลตรวจที่เลือก'; end if;
  if v_chk.status <> 'pending' then
    raise exception 'ผลตรวจนี้ถูกพิจารณาไปแล้ว (สถานะ: %)', v_chk.status;
  end if;
  if v_chk.checked_by = v_profile then
    raise exception 'ผู้อนุมัติต้องเป็นคนละคนกับผู้ลงผลตรวจ (สองลายเซ็นตามแนว GMP)';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_decision = 'reject' and v_note is null then
    raise exception 'การไม่อนุมัติต้องระบุเหตุผล';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    case when p_decision = 'approve' then 'อนุมัติผลตรวจ in-process ' else 'ไม่อนุมัติผลตรวจ in-process ' end
    || coalesce(v_chk.param, ''), true);

  update public.inprocess_checks
     set status       = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         approved_by  = v_profile,
         approved_at  = now(),
         approve_note = v_note,
         updated_by   = v_profile
   where id = p_id;
end;
$fn$;

revoke execute on function public.review_inprocess_check(uuid, text, text) from public;
revoke execute on function public.review_inprocess_check(uuid, text, text) from anon;
grant  execute on function public.review_inprocess_check(uuid, text, text) to authenticated;

comment on function public.review_inprocess_check(uuid, text, text) is
  'อนุมัติ/ไม่อนุมัติผลตรวจ in-process 1 รายการ (หัวหน้า QC/ผู้บริหาร) — ต้องคนละคนกับผู้ลงผล · ไม่อนุมัติต้องมีเหตุผล';

-- ------------------------------------------------------------
-- (5) inprocess_route_complete — นับเฉพาะผลที่อนุมัติแล้วและผ่าน
--     บอดี้ยกมาจาก 0034 (ฉบับผ่อนเป็น "อย่างน้อย 1 สถานีใน route") เพิ่มเงื่อนไข status
-- ------------------------------------------------------------
create or replace function public.inprocess_route_complete(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- งานที่ไม่มี route เลย (งานเก่า) → true ไม่บล็อก (backward compat)
    not exists (select 1 from public.job_routes where job_id = p_job_id)
    or exists (
      select 1
        from public.job_routes jr
        join public.inprocess_checks ic
          on ic.job_id = p_job_id
         and ic.station_id = jr.station_id
       where jr.job_id = p_job_id
         and ic.result = 'pass'
         and ic.status = 'approved'
    );
$$;

comment on function public.inprocess_route_complete(uuid) is
  'ผ่านด่าน in_production → qc หรือยัง = มีผลตรวจที่ "อนุมัติแล้วและผ่าน" อย่างน้อย 1 สถานีใน route (Part C.3 ก้อน 6 เพิ่มเงื่อนไขอนุมัติ)';

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้)
-- ------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_name = 'inprocess_checks'
--    and column_name in ('valid_date','status','approved_by','approved_at','approve_note');
--                                                     -- ต้องได้ครบ 5 แถว
-- select unnest(enum_range(null::inprocess_status));  -- pending, approved, rejected
-- select status, count(*) from public.inprocess_checks group by status;  -- แถวเก่าต้องเป็น approved
-- select to_regprocedure('public.review_inprocess_check(uuid,text,text)');  -- ต้องไม่ null
-- select proname, count(*) from pg_proc
--  where proname in ('add_inprocess_check','review_inprocess_check','inprocess_route_complete')
--  group by proname;                                  -- ทุกตัวต้องได้ 1
-- ============================================================
