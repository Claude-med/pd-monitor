-- ============================================================
-- PD Monitor — Part C.3 ก้อน 4 / 0062_line_clearance_per_route.sql
-- Line Clearance แยก "ต่อขั้นตอน × ต่อเครื่องจักร" + ย้ายด่านไปอยู่ที่การบันทึกผลผลิต
--
--   (0) pre-flight
--   (1) ขยายตาราง line_clearances (job_route_id · machine_id · ห้อง · จำนวนคน · เวลา 2 ช่อง)
--       + เปลี่ยน unique จาก (job_id) เป็น (job_route_id, machine_id)
--   (2) can_perform_line_clearance() / can_check_line_clearance()
--   (3) line_clearance_passed(job_route_id, machine_id) — แทนตัวเดิมที่รับ job_id
--   (4) perform_line_clearance / check_line_clearance เวอร์ชันใหม่
--   (5) advance_job_status — ถอดด่าน LC ที่ planned → in_production
--   (6) add_production_record — เพิ่มด่าน LC ระดับสถานี/เครื่อง
--
-- ที่มา (requirement Part C.3 + feedback ฝ่ายผลิต B-p11/B-p12):
--   · "Line Clearance เข้าทุก stage" — ของเดิมทำครั้งเดียวต่องาน
--   · "ย้ายไปทำตอนกำลังผลิต" — เดิมเป็นด่านก่อนกด "เริ่มผลิต" ซึ่งเป็นงานธุรการ
--   · "อาจไม่ต้องติ๊กครบ 3 ข้อ" — ผ่อนเป็นอย่างน้อย 1 ข้อ
--   · "หัวหน้าห้องเป็นผู้ตรวจสอบ" — ผู้ยืนยันเปลี่ยนจาก ฝ่ายผลิต/QC/QA เป็น หัวหน้าฝ่ายผลิต
--
-- ℹ️ ตาราง line_clearances ว่างอยู่แล้ว (ล้างไปใน 0058) จึงตั้ง job_route_id/machine_id
--    เป็น NOT NULL ได้เลย ไม่ต้อง backfill
--
-- ⚠️ ด่าน LC ใหม่จะ "ไม่กั้น" ถ้าขั้นตอนนั้นยังไม่ได้ผูกเครื่องจักรไว้เลย —
--    เพราะ LC ผูกกับเครื่อง ถ้าไม่มีเครื่องก็ทำ LC ไม่ได้ จะกลายเป็นล็อกตายบันทึกผลผลิตไม่ได้
--    (หน้าจอขึ้นแถบเตือนแทน) · ถ้าทีมอยากให้กั้นเด็ดขาด ต้องบังคับผูกเครื่องก่อนเริ่มผลิต
-- รัน "หลัง" 0001–0061
-- ============================================================

-- ------------------------------------------------------------
-- (0) pre-flight — ถ้ามี LC เก่าค้างอยู่ ต้องรู้ก่อน (ปกติควรเป็น 0 แถว)
-- ------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from public.line_clearances;
  if v_n > 0 then
    raise exception 'มี Line Clearance เดิมค้างอยู่ % แถว — ต้องเคลียร์ก่อน เพราะคอลัมน์ใหม่เป็น NOT NULL', v_n;
  end if;
  raise notice 'pre-flight ผ่าน — line_clearances ว่าง พร้อมขยายตาราง';
end $$;

-- ------------------------------------------------------------
-- (1) ขยายตาราง
-- ------------------------------------------------------------
alter table public.line_clearances
  add column if not exists job_route_id    uuid references public.job_routes(id) on delete cascade,
  add column if not exists machine_id      uuid references public.machines(id),
  add column if not exists room            text,
  add column if not exists headcount       integer,
  add column if not exists cleared_old_time time,
  add column if not exists cleaned_time     time;

alter table public.line_clearances
  alter column job_route_id set not null,
  alter column machine_id   set not null;

alter table public.line_clearances
  drop constraint if exists line_clearances_headcount_check;
alter table public.line_clearances
  add constraint line_clearances_headcount_check
  check (headcount is null or headcount >= 1);

-- unique เดิมคือ "1 งาน 1 ใบ" — ของใหม่คือ "1 ขั้นตอน 1 เครื่อง 1 ใบ"
alter table public.line_clearances drop constraint if exists line_clearances_job_id_key;
drop index if exists line_clearances_job_route_machine_key;
alter table public.line_clearances
  drop constraint if exists line_clearances_job_route_machine_key;
alter table public.line_clearances
  add constraint line_clearances_job_route_machine_key
  unique (job_route_id, machine_id);

create index if not exists idx_line_clearances_route
  on public.line_clearances (job_route_id);

comment on column public.line_clearances.job_route_id is
  'ขั้นตอนการผลิตที่ทำ LC นี้ (job_routes.id) — Part C.3 ก้อน 4 · เดิม LC ผูกกับ job อย่างเดียว ทำได้ครั้งเดียวต่องาน';
comment on column public.line_clearances.machine_id is
  'เครื่องจักรที่เคลียร์ — 1 ขั้นตอนเลือกกี่เครื่อง ก็ต้องทำ LC เท่านั้นใบ (ตามที่ฝ่ายผลิตขอ)';
comment on column public.line_clearances.room is
  'ห้องที่ทำ (B-p11) — พิมพ์เอง ไม่ผูกทะเบียนห้อง เพราะ machines.room ก็พิมพ์เองเหมือนกัน';
comment on column public.line_clearances.headcount is
  'จำนวนคนที่ทำ LC ครั้งนี้ (B-p11) — เว้นว่างได้';
comment on column public.line_clearances.cleared_old_time is
  'เวลาที่เคลียร์ของเก่า/รุ่นก่อนออกจากไลน์ (เวลาอย่างเดียว วันที่ดูจาก performed_at)';
comment on column public.line_clearances.cleaned_time is
  'เวลาที่ทำความสะอาดเสร็จ (เวลาอย่างเดียว วันที่ดูจาก performed_at)';

do $$
begin
  alter publication supabase_realtime add table public.line_clearances;
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- (2) สิทธิ์ — แยก "ผู้ทำ/ผู้ตรวจ" ออกจาก "ผู้ยืนยัน" ตามที่ฝ่ายผลิตขอ
-- ------------------------------------------------------------
create or replace function public.can_perform_line_clearance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('production')
      or public.has_role('production_lead')
      or public.has_role('manager');
$$;

revoke execute on function public.can_perform_line_clearance() from public;
revoke execute on function public.can_perform_line_clearance() from anon;
grant  execute on function public.can_perform_line_clearance() to authenticated;

comment on function public.can_perform_line_clearance() is
  'สิทธิ์บันทึก/ติ๊ก Line Clearance = ฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหาร — ต้องตรงกับ canPerformLineClearance() ใน web/lib/data/role-access.ts';

-- ⚠️ เปลี่ยนจากของเดิม (production/qc/qa/manager) — ทีมยืนยันว่าผู้ยืนยันคือ "หัวหน้าห้อง/หัวหน้าฝ่ายผลิต"
--    ไม่ใช่ QC · QC ไปทำหน้าที่ตรวจ in-process แทน
create or replace function public.can_check_line_clearance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('production_lead') or public.has_role('manager');
$$;

revoke execute on function public.can_check_line_clearance() from public;
revoke execute on function public.can_check_line_clearance() from anon;
grant  execute on function public.can_check_line_clearance() to authenticated;

comment on function public.can_check_line_clearance() is
  'สิทธิ์ยืนยัน Line Clearance = หัวหน้าฝ่ายผลิต/ผู้บริหารเท่านั้น (Part C.3) — ต้องตรงกับ canCheckLineClearance() ใน web/lib/data/role-access.ts';

-- ------------------------------------------------------------
-- (3) line_clearance_passed — เปลี่ยนคีย์จาก job_id เป็น (ขั้นตอน, เครื่อง)
--
--     🚨 ต้อง drop ตัวเดิมที่รับ job_id ทิ้ง — ของเดิมใช้ scalar subquery
--        `select ... where job_id = ?` ซึ่งตอนนี้มีได้หลายแถวต่องาน จะพังด้วย
--        "more than one row returned by a subquery" ตอน runtime แบบเงียบ ๆ
--     ผ่อนกฎ: ติ๊กอย่างน้อย 1 ข้อพอ (เดิมบังคับครบ 3) ตามที่ฝ่ายผลิตขอ
-- ------------------------------------------------------------
drop function if exists public.line_clearance_passed(uuid);

create or replace function public.line_clearance_passed(
  p_job_route_id uuid,
  p_machine_id   uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.line_clearances
     where job_route_id = p_job_route_id
       and machine_id   = p_machine_id
       and checked_by is not null
       and (cleared_old or cleaned or setup_done)
  );
$$;

revoke execute on function public.line_clearance_passed(uuid, uuid) from public;
revoke execute on function public.line_clearance_passed(uuid, uuid) from anon;
grant  execute on function public.line_clearance_passed(uuid, uuid) to authenticated;

comment on function public.line_clearance_passed(uuid, uuid) is
  'Line Clearance ของขั้นตอน+เครื่องนี้ผ่านแล้วหรือยัง = ติ๊กอย่างน้อย 1 ข้อ + หัวหน้าฝ่ายผลิตยืนยันแล้ว';

-- ------------------------------------------------------------
-- (4) perform_line_clearance — บันทึก/แก้ใบ LC ของขั้นตอน+เครื่องหนึ่ง
--     บันทึกใหม่ = ล้างลายเซ็นผู้ยืนยันเดิม (ต้องยืนยันใหม่) — คงกติกาเดิมของ 0018
-- ------------------------------------------------------------
drop function if exists public.perform_line_clearance(uuid, boolean, boolean, boolean, numeric, text);

create or replace function public.perform_line_clearance(
  p_job_route_id     uuid,
  p_machine_id       uuid,
  p_cleared_old      boolean,
  p_cleaned          boolean,
  p_setup_done       boolean,
  p_setup_minutes    numeric default null,
  p_cleared_old_time time    default null,
  p_cleaned_time     time    default null,
  p_room             text    default null,
  p_headcount        integer default null,
  p_note             text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_job_id  uuid;
  v_step    integer;
  v_st_name text;
  v_mc_code text;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_perform_line_clearance() then
    raise exception 'เฉพาะฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหารบันทึก Line Clearance ได้';
  end if;

  select jr.job_id, jr.step_no, s.name
    into v_job_id, v_step, v_st_name
    from public.job_routes jr
    join public.stations s on s.id = jr.station_id
   where jr.id = p_job_route_id;
  if v_job_id is null then raise exception 'ไม่พบขั้นตอนการผลิตที่เลือก'; end if;

  -- เครื่องต้องถูกผูกกับขั้นตอนนี้ไว้แล้ว (0061) — กันทำ LC ให้เครื่องที่ไม่ได้ใช้ในขั้นตอนนี้
  select m.code into v_mc_code
    from public.job_route_machines jrm
    join public.machines m on m.id = jrm.machine_id
   where jrm.job_route_id = p_job_route_id
     and jrm.machine_id   = p_machine_id;
  if v_mc_code is null then
    raise exception 'เครื่องจักรนี้ยังไม่ได้ถูกเลือกไว้ในขั้นตอนที่ % (%) — เลือกเครื่องก่อน', v_step, v_st_name;
  end if;

  if p_setup_minutes is not null and p_setup_minutes < 0 then
    raise exception 'เวลา set-up ห้ามติดลบ';
  end if;
  if p_headcount is not null and p_headcount < 1 then
    raise exception 'จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'บันทึก Line Clearance ขั้นตอนที่ ' || v_step || ' (' || v_st_name || ') เครื่อง ' || v_mc_code, true);

  insert into public.line_clearances
    (job_id, job_route_id, machine_id,
     cleared_old, cleaned, setup_done, setup_minutes,
     cleared_old_time, cleaned_time, room, headcount, note,
     performed_by, performed_at, created_by)
  values
    (v_job_id, p_job_route_id, p_machine_id,
     coalesce(p_cleared_old, false), coalesce(p_cleaned, false),
     coalesce(p_setup_done, false), p_setup_minutes,
     p_cleared_old_time, p_cleaned_time,
     nullif(btrim(coalesce(p_room, '')), ''), p_headcount,
     nullif(btrim(coalesce(p_note, '')), ''),
     v_profile, now(), v_profile)
  on conflict (job_route_id, machine_id) do update
    set cleared_old      = excluded.cleared_old,
        cleaned          = excluded.cleaned,
        setup_done       = excluded.setup_done,
        setup_minutes    = excluded.setup_minutes,
        cleared_old_time = excluded.cleared_old_time,
        cleaned_time     = excluded.cleaned_time,
        room             = excluded.room,
        headcount        = excluded.headcount,
        note             = excluded.note,
        performed_by     = v_profile,
        performed_at     = now(),
        checked_by       = null,   -- บันทึกใหม่ = ต้องยืนยันใหม่
        checked_at       = null,
        updated_by       = v_profile
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function public.perform_line_clearance(
  uuid, uuid, boolean, boolean, boolean, numeric, time, time, text, integer, text
) from public;
revoke execute on function public.perform_line_clearance(
  uuid, uuid, boolean, boolean, boolean, numeric, time, time, text, integer, text
) from anon;
grant execute on function public.perform_line_clearance(
  uuid, uuid, boolean, boolean, boolean, numeric, time, time, text, integer, text
) to authenticated;

comment on function public.perform_line_clearance(
  uuid, uuid, boolean, boolean, boolean, numeric, time, time, text, integer, text
) is
  'บันทึก Line Clearance ของ 1 ขั้นตอน × 1 เครื่องจักร (ฝ่ายผลิต) — บันทึกใหม่ล้างลายเซ็นผู้ยืนยันเดิมเสมอ';

-- ------------------------------------------------------------
-- (5) check_line_clearance — หัวหน้าฝ่ายผลิตยืนยัน (รับ id ของใบ ไม่ใช่ job_id แล้ว)
--     คงกฎ "ผู้ยืนยันต้องคนละคนกับผู้ทำ" (สองลายเซ็นตาม GMP)
--     ผ่อนกฎ "ต้องครบ 3 ข้อ" → ติ๊กอย่างน้อย 1 ข้อ
-- ------------------------------------------------------------
drop function if exists public.check_line_clearance(uuid);

create or replace function public.check_line_clearance(p_lc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_lc      record;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_check_line_clearance() then
    raise exception 'เฉพาะหัวหน้าฝ่ายผลิต/ผู้บริหารยืนยัน Line Clearance ได้';
  end if;

  select * into v_lc from public.line_clearances where id = p_lc_id for update;
  if v_lc.id is null or v_lc.performed_by is null then
    raise exception 'ยังไม่มีการบันทึกเคลียร์ไลน์ใบนี้ ให้ฝ่ายผลิตบันทึกก่อน';
  end if;
  if not (v_lc.cleared_old or v_lc.cleaned or v_lc.setup_done) then
    raise exception 'ต้องติ๊กอย่างน้อย 1 ข้อก่อนยืนยัน';
  end if;
  if v_lc.performed_by = v_profile then
    raise exception 'ผู้ยืนยันต้องเป็นคนละคนกับผู้ทำเคลียร์ไลน์ (สองลายเซ็นตามแนว GMP)';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ยืนยัน Line Clearance', true);

  update public.line_clearances
     set checked_by = v_profile, checked_at = now(), updated_by = v_profile
   where id = p_lc_id;
end;
$fn$;

revoke execute on function public.check_line_clearance(uuid) from public;
revoke execute on function public.check_line_clearance(uuid) from anon;
grant  execute on function public.check_line_clearance(uuid) to authenticated;

comment on function public.check_line_clearance(uuid) is
  'ยืนยัน Line Clearance 1 ใบ (หัวหน้าฝ่ายผลิต/ผู้บริหาร) — ต้องคนละคนกับผู้ทำ · ติ๊กอย่างน้อย 1 ข้อ';

-- ------------------------------------------------------------
-- (6) advance_job_status — ถอดด่าน Line Clearance ที่ planned → in_production
--     บอดี้ยกมาจาก 0049 ทั้งดุ้น แก้เฉพาะบล็อกนั้น (ด่านเลขล็อต/QC/deviation คงเดิมครบ)
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
as $fn$
declare
  v_profile   uuid;
  v_from      job_status;
  v_job_no    text;
  v_batch     uuid;
  v_is_reject boolean := false;
  v_allowed   boolean := false;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  select status, job_no, batch_id into v_from, v_job_no, v_batch
    from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from = p_to then
    raise exception 'สถานะไม่เปลี่ยนแปลง';
  end if;

  if    v_from = 'pending_announce' and p_to = 'planned' then
    v_allowed := public.can_plan_jobs();          -- Part A: ฝ่ายวางแผน + ผู้บริหาร
  elsif v_from = 'planned'          and p_to = 'in_production' then
    v_allowed := public.has_role('production')
              or public.has_role('production_lead')
              or public.has_role('manager');
    -- GATE (0049): ต้องกรอกเลขล็อตก่อน — เริ่มผลิตแล้วช่องเลขล็อตจะล็อกทันที
    if v_allowed and v_batch is null then
      raise exception 'เริ่มผลิตไม่ได้ — ต้องกรอก LOT No. (Batch NO.) ของงานนี้ก่อน';
    end if;
    -- Part C.3 ก้อน 4: ถอดด่าน Line Clearance ออกจากตรงนี้
    --   ทีมยืนยันว่าคนกด "เริ่มผลิต" เป็นธุรการ ส่วนคนทำ LC คือพนักงานหน้างานในขั้นกำลังผลิต
    --   ด่าน LC ย้ายไปอยู่ที่ add_production_record (กั้นรายสถานี/เครื่อง) แทน
  elsif v_from = 'in_production'     and p_to = 'qc' then
    v_allowed := public.has_role('production') or public.has_role('production_lead');
    -- GATE: ต้องตรวจ in-process QC (ผ่าน) ตามสูตรก่อนส่ง QC (E2 · ผ่อนเป็น ≥1 สถานีใน 0034)
    if v_allowed and not public.inprocess_route_complete(p_job_id) then
      raise exception 'ส่ง QC ไม่ได้ — ต้องมีผลตรวจ in-process QC (ผ่าน) อย่างน้อย 1 สถานีในสูตรก่อน';
    end if;
  elsif v_from = 'qc'               and p_to = 'qa' then
    v_allowed := public.has_role('qc') or public.has_role('qc_lead');
  elsif v_from = 'qc'               and p_to = 'in_production' then
    v_allowed := public.has_role('qc') or public.has_role('qc_lead'); v_is_reject := true;
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

  -- ---------- แจ้งเตือน ----------
  if v_is_reject then
    perform public.create_notification(
      'reject',
      'งาน ' || v_job_no || ' ถูกตีกลับ',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ไม่ระบุเหตุผล'),
      p_job_id, v_job_no, 'production', 'in_production');
  else
    if    p_to = 'planned' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ยืนยันแผนแล้ว — พร้อมเริ่มผลิต',
        null, p_job_id, v_job_no, 'production', 'planned');
    elsif p_to = 'qc' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ส่งถึง QC แล้ว',
        'รอตรวจสอบคุณภาพ (QC)', p_job_id, v_job_no, 'qc', 'qc');
    elsif p_to = 'qa' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ส่งถึง QA แล้ว',
        'รอ QA ปล่อยผ่าน', p_job_id, v_job_no, 'qa', 'qa');
    elsif p_to = 'finished_goods' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' พร้อมรับเข้าคลัง FG',
        'QA ปล่อยผ่านแล้ว — รอฝ่ายคลังรับเข้า', p_job_id, v_job_no, 'warehouse', 'finished_goods');
    end if;
  end if;
end;
$fn$;

grant execute on function public.advance_job_status(uuid, job_status, text) to authenticated;

-- ------------------------------------------------------------
-- (7) add_production_record — ด่าน Line Clearance ระดับสถานี/เครื่อง
--     บอดี้ยกมาจาก 0059 ทั้งดุ้น เพิ่มเฉพาะบล็อกด่าน LC
-- ------------------------------------------------------------
create or replace function public.add_production_record(
  p_job_id      uuid,
  p_station_id  uuid,
  p_input       numeric,
  p_output      numeric,
  p_loss        numeric default 0,
  p_hours       numeric default null,
  p_record_date date    default current_date,
  p_note        text    default null,
  p_client_id   uuid    default null,
  p_machine_id  uuid    default null,
  p_headcount   integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile  uuid;
  v_status   job_status;
  v_loss     numeric := coalesce(p_loss, 0);
  v_id       uuid;
  v_mc       record;
  v_st_name  text;
  v_route_id uuid;
  v_mc_count int;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  if not (public.has_role('production')
          or public.has_role('production_lead')
          or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณบันทึกผลผลิตไม่ได้ (เฉพาะฝ่ายผลิต/ผู้บริหาร)';
  end if;

  -- idempotency
  if p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  select status into v_status from public.jobs where id = p_job_id for update;
  if v_status is null then raise exception 'ไม่พบงานนี้'; end if;
  if v_status <> 'in_production' then
    raise exception 'บันทึกผลผลิตได้เฉพาะงานที่กำลังผลิตอยู่ (สถานะปัจจุบัน: %)', v_status;
  end if;

  if p_station_id is null then raise exception 'กรุณาเลือกสถานี'; end if;
  select name into v_st_name from public.stations where id = p_station_id;
  if v_st_name is null then raise exception 'ไม่พบสถานีที่เลือก'; end if;

  -- เครื่องจักร (ถ้าระบุ)
  if p_machine_id is not null then
    select id, code, status, is_active into v_mc
      from public.machines where id = p_machine_id;
    if v_mc.id is null then raise exception 'ไม่พบเครื่องจักรที่เลือก'; end if;
    if not v_mc.is_active then raise exception 'เครื่อง % ถูกปิดใช้งานแล้ว เลือกไม่ได้', v_mc.code; end if;
    if v_mc.status in ('maintenance', 'calibration_due') then
      raise exception 'เครื่อง % อยู่สถานะซ่อม/ถึงกำหนดสอบเทียบ — เริ่มงานบนเครื่องนี้ไม่ได้', v_mc.code;
    end if;
  end if;

  -- ---------- GATE Line Clearance (Part C.3 ก้อน 4) ----------
  -- ย้ายมาจาก advance_job_status ที่เดิมกั้นครั้งเดียวตอนกด "เริ่มผลิต"
  -- กั้นรายสถานี: บันทึกของสถานีไหน ต้องมี LC ของขั้นตอนนั้นผ่านก่อน
  select id into v_route_id
    from public.job_routes
   where job_id = p_job_id and station_id = p_station_id
   order by step_no
   limit 1;

  if v_route_id is not null then
    select count(*) into v_mc_count
      from public.job_route_machines where job_route_id = v_route_id;

    -- ไม่มีเครื่องผูกไว้เลย = ทำ LC ไม่ได้ → ไม่กั้น (กันล็อกตายจนบันทึกอะไรไม่ได้)
    if v_mc_count > 0 then
      if p_machine_id is not null then
        if not public.line_clearance_passed(v_route_id, p_machine_id) then
          raise exception
            'บันทึกผลผลิตไม่ได้ — เครื่อง % ที่สถานี "%" ยังไม่ผ่าน Line Clearance (ต้องมีหัวหน้าฝ่ายผลิตยืนยัน)',
            v_mc.code, v_st_name;
        end if;
      elsif not exists (
        select 1
          from public.job_route_machines jrm
         where jrm.job_route_id = v_route_id
           and public.line_clearance_passed(v_route_id, jrm.machine_id)
      ) then
        raise exception
          'บันทึกผลผลิตไม่ได้ — สถานี "%" ยังไม่มีเครื่องไหนผ่าน Line Clearance เลย', v_st_name;
      end if;
    end if;
  end if;

  -- validation
  if p_input is null or p_input < 0 then
    raise exception 'ยอดตั้งต้น (input) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if p_output is null or p_output < 0 then
    raise exception 'ยอดผลิตได้ (output) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if v_loss < 0 then raise exception 'ของเสีย (loss) ห้ามติดลบ'; end if;
  if p_hours is not null and (p_hours < 0 or p_hours > 24) then
    raise exception 'ชั่วโมงทำงานต้องอยู่ระหว่าง 0–24';
  end if;
  if p_headcount is not null and p_headcount < 1 then
    raise exception 'จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
  end if;
  if p_output > p_input then
    raise exception 'ยอดผลิตได้ (%) มากกว่ายอดตั้งต้น (%) ไม่ได้', p_output, p_input;
  end if;
  if (p_output + v_loss) > p_input then
    raise exception 'ผลิตได้ + ของเสีย (%) มากกว่ายอดตั้งต้น (%) ไม่ได้', (p_output + v_loss), p_input;
  end if;
  if p_record_date > current_date then
    raise exception 'วันที่บันทึกเป็นวันในอนาคตไม่ได้';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกผลผลิต ' || v_st_name, true);

  insert into public.production_records
    (job_id, station_id, record_date, input_qty, output_qty, loss_qty, hours,
     operator_id, note, created_by, client_id, machine_id, headcount)
  values
    (p_job_id, p_station_id, p_record_date, p_input, p_output, v_loss, p_hours,
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile, p_client_id,
     p_machine_id, p_headcount)
  on conflict (client_id) do nothing
  returning id into v_id;

  if v_id is null and p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
  end if;

  return v_id;
end;
$fn$;

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้)
-- ------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_name = 'line_clearances'
--    and column_name in ('job_route_id','machine_id','room','headcount','cleared_old_time','cleaned_time');
--                                                    -- ต้องได้ครบ 6 แถว
-- select conname from pg_constraint where conrelid = 'public.line_clearances'::regclass and contype = 'u';
--                                                    -- ต้องเหลือแค่ line_clearances_job_route_machine_key
-- select to_regprocedure('public.line_clearance_passed(uuid)');        -- ต้องได้ null (ตัวเก่าถูกลบ)
-- select to_regprocedure('public.line_clearance_passed(uuid,uuid)');   -- ต้องไม่ null
-- select to_regprocedure('public.check_line_clearance(uuid)');         -- ต้องไม่ null (signature เดิมพอดี)
-- select proname, count(*) from pg_proc
--  where proname in ('perform_line_clearance','check_line_clearance','line_clearance_passed')
--  group by proname;                                 -- ทุกตัวต้องได้ 1
-- ============================================================
