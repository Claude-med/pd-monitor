-- ============================================================
-- PD Monitor — เฟสหลัง / 0032_inprocess_gate.sql  (E2: gate in-process QC ครบทุกสถานี)
--   - inprocess_checks.station_id = สถานีย่อยจริง (FK stations) ควบ enum station เดิม
--   - add_inprocess_check         = รับ station_id → set ทั้ง station_id + station(enum group)
--   - inprocess_route_complete()  = ครบทุกสถานีใน job_routes ที่ result='pass' ไหม
--   - advance_job_status          = เพิ่ม GATE ที่ in_production → qc
-- ⚠️ คง column station (enum) ไว้เพื่อ dashboard/รายงานเดิม (ไม่แตะ enum)
-- รัน "หลัง" 0031
-- ============================================================

-- ------------------------------------------------------------
-- 1) inprocess_checks.station_id — สถานีย่อย (nullable: แถวเก่า = null)
-- ------------------------------------------------------------
alter table public.inprocess_checks
  add column if not exists station_id uuid references public.stations(id);

create index if not exists idx_inprocess_checks_station on public.inprocess_checks(station_id);

-- ------------------------------------------------------------
-- 2) ยกเครื่อง add_inprocess_check — รับ station_id (แทน enum ตรงๆ)
--    lookup stations → set station_id + station(enum group) เพื่อคง dashboard
--    (drop signature เดิมที่รับ production_station ทิ้ง กัน overload กำกวม)
-- ------------------------------------------------------------
drop function if exists public.add_inprocess_check(
  uuid, production_station, text, text, text, check_result, text
);

create or replace function public.add_inprocess_check(
  p_job_id     uuid,
  p_station_id uuid,
  p_param      text,
  p_value      text   default null,
  p_unit       text   default null,
  p_result     check_result default 'pass',
  p_note       text   default null
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
  v_group   production_station;
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
  if p_station_id is null then raise exception 'กรุณาเลือกสถานี'; end if;

  -- สถานีต้องมีจริง → ดึงกลุ่มหลัก (enum) มา set ควบ
  select station_group into v_group from public.stations where id = p_station_id;
  if v_group is null then raise exception 'ไม่พบสถานีที่เลือก'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกตรวจระหว่างผลิต ' || p_param, true);

  insert into public.inprocess_checks
    (job_id, station, station_id, param, value, unit, result, checked_by, note, created_by)
  values
    (p_job_id, v_group, p_station_id, p_param,
     nullif(btrim(coalesce(p_value, '')), ''),
     nullif(btrim(coalesce(p_unit, '')), ''),
     coalesce(p_result, 'pass'), v_profile,
     nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.add_inprocess_check(
  uuid, uuid, text, text, text, check_result, text
) to authenticated;

-- ------------------------------------------------------------
-- 3) inprocess_route_complete — ทุกสถานีใน route ของงานมีผล 'pass' แล้วไหม
--    งานที่ไม่มี route เลย (งานเก่า/ยาไม่มี route) → true (ไม่บล็อก — backward compat)
-- ------------------------------------------------------------
create or replace function public.inprocess_route_complete(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.job_routes jr
    where jr.job_id = p_job_id
      and not exists (
        select 1 from public.inprocess_checks ic
        where ic.job_id = p_job_id
          and ic.station_id = jr.station_id
          and ic.result = 'pass'
      )
  );
$$;

-- ------------------------------------------------------------
-- 4) ยกเครื่อง advance_job_status — เพิ่ม GATE in-process QC ที่ in_production → qc
--    (คง GATE Line Clearance (0018) + Deviation (0025) เดิมครบทุกประการ)
-- ------------------------------------------------------------
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
    -- GATE: ต้องตรวจ in-process QC (ผ่าน) ครบทุกสถานีในสูตร ก่อนส่ง QC (E2)
    if v_allowed and not public.inprocess_route_complete(p_job_id) then
      raise exception 'ส่ง QC ไม่ได้ — ยังตรวจ in-process QC (ผ่าน) ไม่ครบทุกสถานีในสูตร';
    end if;
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
