-- ============================================================
-- PD Monitor — Part C.3 ก้อน 3 / 0061_job_route_machines.sql
-- "เครื่องจักรที่ใช้ในแต่ละขั้นตอน (route) ของงาน"
--
--   (1) ตาราง job_route_machines + trigger meta/audit + RLS + realtime
--   (2) can_edit_job_route_machines() — ฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหาร
--   (3) add_job_route_machine     — ผูกเครื่องเข้าขั้นตอน
--   (4) remove_job_route_machine  — ถอดเครื่องออกจากขั้นตอน
--
-- ℹ️ ทำไมผูกกับ job_routes.id ไม่ใช่ (job_id + station_id):
--    route ของยาบางตัวเดินสถานีเดิมซ้ำได้ (เช่น ผสม → ตอก → ผสม) ถ้าใช้ station_id
--    เป็นคีย์ เครื่องของ 2 ขั้นตอนจะปนกัน · job_routes.id ชี้ "ขั้นตอนที่เท่าไร" ตรงตัว
--
-- ℹ️ ทำไมไม่ใส่ status/ลำดับในตารางนี้:
--    เป็นแค่ "ใบผูก" ระหว่างขั้นตอนกับเครื่อง — สถานะเครื่องอยู่ที่ machines.status
--    ที่เดียว (0052) ถ้าก๊อปมาเก็บซ้ำจะมี 2 แหล่งความจริงที่ไม่ตรงกัน
--
-- ⚠️ on delete cascade ที่ job_route_id: ลบงาน → job_routes หาย → ใบผูกหายตาม
--    machine_id ไม่ใส่ cascade โดยตั้งใจ — ลบเครื่องที่ถูกใช้ในงานไม่ได้ (ALCOA)
-- รัน "หลัง" 0060 (ต้องมี role production_lead ใน enum แล้ว)
-- ============================================================

-- ------------------------------------------------------------
-- (1) ตาราง job_route_machines
-- ------------------------------------------------------------
create table if not exists public.job_route_machines (
  id            uuid primary key default gen_random_uuid(),
  job_route_id  uuid not null references public.job_routes(id) on delete cascade,
  machine_id    uuid not null references public.machines(id),
  note          text,
  created_by    uuid references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  unique (job_route_id, machine_id)
);

comment on table public.job_route_machines is
  'เครื่องจักรที่ใช้ในแต่ละขั้นตอน (route) ของงาน (Part C.3) — 1 ขั้นตอนมีได้หลายเครื่อง · ใช้ต่อที่ Line Clearance และฟอร์มบันทึกผลผลิต';
comment on column public.job_route_machines.job_route_id is
  'ชี้ "ขั้นตอนที่เท่าไร" ของงาน (job_routes.id) ไม่ใช่ station_id — route ที่เดินสถานีเดิมซ้ำจะได้ไม่ปนกัน';
comment on column public.job_route_machines.machine_id is
  'ไม่มี on delete cascade โดยตั้งใจ — เครื่องที่เคยใช้ในงานลบไม่ได้ (ALCOA)';

-- query หลัก: ดึงเครื่องของทุกขั้นตอนในงานเดียว
create index if not exists idx_job_route_machines_route
  on public.job_route_machines (job_route_id, created_at);
create index if not exists idx_job_route_machines_machine
  on public.job_route_machines (machine_id);

drop trigger if exists trg_meta_job_route_machines on public.job_route_machines;
create trigger trg_meta_job_route_machines before insert or update on public.job_route_machines
  for each row execute function public.set_row_meta();

drop trigger if exists trg_audit_job_route_machines on public.job_route_machines;
create trigger trg_audit_job_route_machines after insert or update or delete on public.job_route_machines
  for each row execute function public.log_audit();

-- RLS: default-deny · ล็อกอินแล้วอ่านได้ · เขียนผ่าน RPC security definer เท่านั้น
alter table public.job_route_machines enable row level security;

drop policy if exists read_job_route_machines on public.job_route_machines;
create policy read_job_route_machines on public.job_route_machines
  for select to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.job_route_machines;
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- (2) can_edit_job_route_machines — ใครผูก/ถอดเครื่องกับขั้นตอนได้
--     ฝ่ายผลิตเป็นคนรู้ว่างานนี้เดินเครื่องไหนจริง · หัวหน้าฝ่ายผลิต/ผู้บริหารทำแทนได้
--     (admin ผ่านเองจาก has_role — 0013:33)
-- ------------------------------------------------------------
create or replace function public.can_edit_job_route_machines()
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

revoke execute on function public.can_edit_job_route_machines() from public;
revoke execute on function public.can_edit_job_route_machines() from anon;
grant  execute on function public.can_edit_job_route_machines() to authenticated;

comment on function public.can_edit_job_route_machines() is
  'สิทธิ์ผูก/ถอดเครื่องจักรกับขั้นตอนการผลิตของงาน = ฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหาร — ต้องตรงกับ canEditJobRouteMachines() ใน web/lib/data/role-access.ts';

-- ------------------------------------------------------------
-- (3) add_job_route_machine — ผูกเครื่องเข้าขั้นตอน
--
--     🚨 ด่านสำคัญ: เครื่องต้องประจำ "สถานีเดียวกัน" กับขั้นตอนนั้น
--        ถ้าไม่กั้น จะผูกเครื่องบรรจุเข้าขั้นตอนตอกเม็ดได้ แล้ว Line Clearance
--        กับบันทึกผลผลิตจะอ้างเครื่องผิดสถานีตลอดทั้งงานโดยไม่มีใครเห็น
-- ------------------------------------------------------------
create or replace function public.add_job_route_machine(
  p_job_route_id uuid,
  p_machine_id   uuid,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile    uuid;
  v_id         uuid;
  v_job_id     uuid;
  v_step_no    integer;
  v_station_id uuid;
  v_st_name    text;
  v_mc         record;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_edit_job_route_machines() then
    raise exception 'เฉพาะฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหารเลือกเครื่องจักรของขั้นตอนได้';
  end if;

  -- ขั้นตอนต้องมีจริง + ดึงสถานีของขั้นตอนนั้นมาเทียบ
  select jr.job_id, jr.step_no, jr.station_id, s.name
    into v_job_id, v_step_no, v_station_id, v_st_name
    from public.job_routes jr
    join public.stations s on s.id = jr.station_id
   where jr.id = p_job_route_id;
  if v_job_id is null then raise exception 'ไม่พบขั้นตอนการผลิตที่เลือก'; end if;

  -- เครื่องต้องมีจริง เปิดใช้งาน และอยู่สถานีเดียวกับขั้นตอน
  select id, code, name, station_id, is_active into v_mc
    from public.machines where id = p_machine_id;
  if v_mc.id is null then raise exception 'ไม่พบเครื่องจักรที่เลือก'; end if;
  if not v_mc.is_active then
    raise exception 'เครื่อง % ถูกปิดใช้งานแล้ว เลือกไม่ได้', v_mc.code;
  end if;
  if v_mc.station_id is distinct from v_station_id then
    raise exception 'เครื่อง % ไม่ได้ประจำสถานี "%" — เลือกได้เฉพาะเครื่องของสถานีนั้น',
      v_mc.code, v_st_name;
  end if;

  if exists (
    select 1 from public.job_route_machines
     where job_route_id = p_job_route_id and machine_id = p_machine_id
  ) then
    raise exception 'เครื่อง % ถูกเลือกไว้ในขั้นตอนนี้อยู่แล้ว', v_mc.code;
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'เลือกเครื่องจักร ' || v_mc.code || ' เข้าขั้นตอนที่ ' || v_step_no || ' (' || v_st_name || ')', true);

  insert into public.job_route_machines (job_route_id, machine_id, note, created_by)
  values (p_job_route_id, p_machine_id,
          nullif(btrim(coalesce(p_note, '')), ''), v_profile)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function public.add_job_route_machine(uuid, uuid, text) from public;
revoke execute on function public.add_job_route_machine(uuid, uuid, text) from anon;
grant  execute on function public.add_job_route_machine(uuid, uuid, text) to authenticated;

comment on function public.add_job_route_machine(uuid, uuid, text) is
  'ผูกเครื่องจักรเข้ากับขั้นตอนการผลิตของงาน (ฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหาร) — บังคับให้เครื่องอยู่สถานีเดียวกับขั้นตอน';

-- ------------------------------------------------------------
-- (4) remove_job_route_machine — ถอดเครื่องออกจากขั้นตอน
-- ------------------------------------------------------------
create or replace function public.remove_job_route_machine(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_code    text;
  v_step_no integer;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_edit_job_route_machines() then
    raise exception 'เฉพาะฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหารถอดเครื่องจักรออกจากขั้นตอนได้';
  end if;

  select m.code, jr.step_no into v_code, v_step_no
    from public.job_route_machines jrm
    join public.machines m    on m.id  = jrm.machine_id
    join public.job_routes jr on jr.id = jrm.job_route_id
   where jrm.id = p_id;
  if v_code is null then raise exception 'ไม่พบรายการเครื่องจักรที่เลือก'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'ถอดเครื่องจักร ' || v_code || ' ออกจากขั้นตอนที่ ' || v_step_no, true);

  delete from public.job_route_machines where id = p_id;
end;
$fn$;

revoke execute on function public.remove_job_route_machine(uuid) from public;
revoke execute on function public.remove_job_route_machine(uuid) from anon;
grant  execute on function public.remove_job_route_machine(uuid) to authenticated;

comment on function public.remove_job_route_machine(uuid) is
  'ถอดเครื่องจักรออกจากขั้นตอนการผลิตของงาน (ฝ่ายผลิต/หัวหน้าฝ่ายผลิต/ผู้บริหาร)';

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้)
-- ------------------------------------------------------------
-- select to_regclass('public.job_route_machines');            -- ต้องไม่เป็น null
-- select count(*) from pg_policies where tablename = 'job_route_machines';  -- ต้องได้ 1 (select อย่างเดียว)
-- select count(*) from pg_trigger where tgrelid = 'public.job_route_machines'::regclass and not tgisinternal;  -- ต้องได้ 2
-- select count(*) from pg_publication_tables
--  where pubname = 'supabase_realtime' and tablename = 'job_route_machines';  -- ต้องได้ 1
-- select unnest(enum_range(null::app_role));                  -- ต้องมี production_lead + qc_lead
-- ============================================================
