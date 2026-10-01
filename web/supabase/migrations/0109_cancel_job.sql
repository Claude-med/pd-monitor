-- ============================================================
-- PD Monitor — 0109_cancel_job.sql  (ลบงาน → สถานะ "ยกเลิก" · ไฟล์ 2/2)
--
-- ทำไม: ตามหลัก GMP บันทึกการผลิตห้ามหายถาวร — เดิม delete_job ลบงาน + ตารางลูกทั้งหมด (cascade)
--   ตอนนี้เปลี่ยนเป็น "ยกเลิก" = งานยังอยู่ครบ เห็นได้ว่าใครยกเลิก เมื่อไร เพราะอะไร
--
--   (1) jobs: คอลัมน์ cancelled_at / cancelled_by / cancel_reason / cancelled_from
--   (2) ล็อกงานที่ยกเลิก (trigger) — แก้งาน/เพิ่ม/แก้/ลบ ข้อมูลลูกไม่ได้อีก
--       ยกเว้น Incident (deviations · ความเห็น · ฝ่าย) และแจ้งเตือน — QA ยังต้องปิด Incident ได้
--   (3) cancel_job(งาน, เหตุผล) — สิทธิ์เดียวกับ delete_job เดิม (0105) + ต้องมีเหตุผล
--       · หัวหน้าแผนก = ก่อนเริ่มผลิต · ผู้บริหาร/admin = ทุกสถานะ ยกเว้น FG (QA ปล่อยผ่านแล้ว)
--       · คำขอแก้ไขที่ค้างของงานนี้ → ปิดเป็น "ไม่อนุมัติ" ให้อัตโนมัติ
--   (4) restore_job(งาน, เหตุผล) — ผู้บริหาร/admin คืนงานที่ยกเลิกผิดกลับสถานะเดิม
--   (5) dashboard_job_counts ไม่นับงานที่ยกเลิก
--   (6) drop delete_job — ไม่มีทางลบงานจากแอปอีก (ล้างข้อมูลทดสอบทำผ่าน SQL Editor)
--
-- 🚨 paste 0108 ก่อน (แยกรอบ) แล้วค่อย paste ไฟล์นี้ · และ paste "ก่อน" push โค้ด
-- รัน "หลัง" 0108 · รันซ้ำได้
-- ============================================================


-- ------------------------------------------------------------
-- (1) คอลัมน์บนงาน
-- ------------------------------------------------------------
alter table public.jobs add column if not exists cancelled_at   timestamptz;
alter table public.jobs add column if not exists cancelled_by   uuid references public.profiles(id);
alter table public.jobs add column if not exists cancel_reason  text;
alter table public.jobs add column if not exists cancelled_from public.job_status;

comment on column public.jobs.cancelled_from is
  'สถานะก่อนถูกยกเลิก — restore_job() คืนงานกลับไปสถานะนี้';


-- ------------------------------------------------------------
-- (2) ล็อกงานที่ยกเลิก
--     ทางผ่านเดียว = ธง app.job_cancel_op ที่ cancel_job / restore_job ตั้ง (set_config แบบ local)
--     ผู้ใช้ตั้งธงเองไม่ได้ — PostgREST เรียกได้เฉพาะฟังก์ชันใน schema public (แพทเทิร์นเดียวกับ app.esign · 0105)
-- ------------------------------------------------------------
create or replace function public.guard_cancelled_job()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.job_cancel_op', true), '') = 'on' then
    return new;
  end if;

  -- เปลี่ยนเป็น "ยกเลิก" ได้ทางเดียว = cancel_job()
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    raise exception 'ยกเลิกงานได้ทางปุ่ม "ยกเลิกงาน" เท่านั้น';
  end if;

  -- งานที่ยกเลิกแล้ว: แก้อะไรไม่ได้ ยกเว้น sub_status
  --   (upsert_job_sub_status · 0053 เปลี่ยนชื่อสถานะให้ทุกงานที่ใช้ชื่อเดิมพร้อมกัน — ต้องไม่ติดงานที่ยกเลิก)
  if old.status = 'cancelled'
     and (to_jsonb(new) - array['sub_status', 'updated_at', 'updated_by', 'version'])
         is distinct from
         (to_jsonb(old) - array['sub_status', 'updated_at', 'updated_by', 'version']) then
    raise exception 'งาน % ถูกยกเลิกแล้ว — แก้ไขไม่ได้', old.job_no;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_cancelled_jobs on public.jobs;
create trigger trg_guard_cancelled_jobs
  before update on public.jobs
  for each row execute function public.guard_cancelled_job();


-- ตารางลูก: เพิ่ม/แก้/ลบ ไม่ได้ถ้างานถูกยกเลิก
--   ถ้าหางานไม่เจอ (เช่นลบงานทั้งใบผ่าน SQL Editor ตอนล้างข้อมูล → cascade) = ปล่อยผ่าน
create or replace function public.guard_cancelled_job_child()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_row    jsonb;
  v_job_id uuid;
  v_job_no text;
begin
  if coalesce(current_setting('app.job_cancel_op', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  -- ตรวจทั้งแถวใหม่ (เพิ่ม/แก้) และแถวเดิม (แก้/ลบ)
  foreach v_row in array array[
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    case when tg_op <> 'INSERT' then to_jsonb(old) end
  ] loop
    continue when v_row is null;

    if tg_table_name = 'job_route_machines' then
      select jr.job_id into v_job_id
        from public.job_routes jr where jr.id = (v_row ->> 'job_route_id')::uuid;
    else
      v_job_id := (v_row ->> 'job_id')::uuid;
    end if;
    continue when v_job_id is null;

    select j.job_no into v_job_no
      from public.jobs j where j.id = v_job_id and j.status = 'cancelled';
    if v_job_no is not null then
      raise exception 'งาน % ถูกยกเลิกแล้ว — เพิ่มหรือแก้ข้อมูลของงานนี้ไม่ได้', v_job_no;
    end if;
  end loop;

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'production_records', 'approvals', 'line_clearances', 'inprocess_checks', 'qa_samples',
    'job_routes', 'job_route_machines', 'job_materials', 'fg_inventory', 'fg_dispatches',
    'edit_requests'
  ] loop
    execute format('drop trigger if exists trg_guard_cancelled_job on public.%I', t);
    execute format(
      'create trigger trg_guard_cancelled_job before insert or update or delete on public.%I
         for each row execute function public.guard_cancelled_job_child()', t);
  end loop;
end $$;


-- ------------------------------------------------------------
-- (3) cancel_job
-- ------------------------------------------------------------
create or replace function public.cancel_job(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_job_no  text;
  v_status  job_status;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_boss    boolean;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  v_boss := public.has_role('manager') or public.has_role('admin');
  if not (v_boss or public.is_any_lead()) then
    raise exception 'เฉพาะหัวหน้าแผนก/ผู้บริหาร/ผู้ดูแลระบบยกเลิกงานได้';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'กรุณาระบุเหตุผลที่ยกเลิก (อย่างน้อย 5 ตัวอักษร)';
  end if;

  select job_no, status into v_job_no, v_status
    from public.jobs where id = p_job_id for update;
  if v_job_no is null then raise exception 'ไม่พบงานที่จะยกเลิก'; end if;
  if v_status = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกไปแล้ว'; end if;
  if v_status = 'finished_goods' then
    raise exception 'งานที่ QA ปล่อยผ่านแล้ว ยกเลิกไม่ได้';
  end if;
  -- กติกาเดียวกับ delete_job (0105): หัวหน้าแผนกยกเลิกได้เฉพาะก่อนเริ่มผลิต
  if v_status not in ('pending_announce', 'planned') and not v_boss then
    raise exception 'งานที่เริ่มผลิตแล้ว ยกเลิกได้เฉพาะผู้บริหาร';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ยกเลิกงาน ' || v_job_no || ': ' || v_reason, true);
  perform set_config('app.job_cancel_op', 'on', true);

  -- คำขอแก้ไขที่ค้างของงานนี้ — ไม่มีทางอนุมัติได้แล้ว ปิดให้เลย
  update public.edit_requests
     set status = 'rejected',
         reviewed_by = v_profile,
         reviewed_at = now(),
         review_note = 'ปิดอัตโนมัติ — งานถูกยกเลิก'
   where job_id = p_job_id and status = 'pending';

  update public.jobs
     set status         = 'cancelled',
         cancelled_from = v_status,
         cancelled_at   = now(),
         cancelled_by   = v_profile,
         cancel_reason  = v_reason
   where id = p_job_id;

  perform set_config('app.job_cancel_op', '', true);

  -- แจ้งฝ่ายวางแผน (งานยังอยู่ → ผูก job_id ได้ ต่างจาก delete_job เดิม)
  perform public.create_notification(
    'job_plan',
    'งาน ' || v_job_no || ' ถูกยกเลิก',
    'เหตุผล: ' || v_reason,
    p_job_id, v_job_no, 'planner'::app_role, null::job_status, null::uuid, true);
end;
$$;

revoke execute on function public.cancel_job(uuid, text) from public, anon;
grant  execute on function public.cancel_job(uuid, text) to authenticated;

comment on function public.cancel_job(uuid, text) is
  'ยกเลิกงาน (แทนการลบ · 0109) — ข้อมูลอยู่ครบ ล็อกแก้ไม่ได้ · หัวหน้าแผนก=ก่อนเริ่มผลิต · ผู้บริหาร/admin=ทุกสถานะยกเว้น FG';


-- ------------------------------------------------------------
-- (4) restore_job — คืนงานที่ยกเลิกผิด (ผู้บริหาร/admin)
-- ------------------------------------------------------------
create or replace function public.restore_job(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_job_no  text;
  v_status  job_status;
  v_from    job_status;
  v_reason  text := btrim(coalesce(p_reason, ''));
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('manager') or public.has_role('admin')) then
    raise exception 'เฉพาะผู้บริหาร/ผู้ดูแลระบบคืนงานที่ยกเลิกได้';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'กรุณาระบุเหตุผลที่คืนงาน (อย่างน้อย 5 ตัวอักษร)';
  end if;

  select job_no, status, cancelled_from into v_job_no, v_status, v_from
    from public.jobs where id = p_job_id for update;
  if v_job_no is null then raise exception 'ไม่พบงาน'; end if;
  if v_status <> 'cancelled' then raise exception 'งานนี้ไม่ได้ถูกยกเลิก'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'คืนงานที่ยกเลิก ' || v_job_no || ': ' || v_reason, true);
  perform set_config('app.job_cancel_op', 'on', true);

  -- ผู้ยกเลิก/เหตุผลเดิมยังอยู่ใน audit_log (trigger audit ของ jobs)
  update public.jobs
     set status         = coalesce(v_from, 'pending_announce'),
         cancelled_from = null,
         cancelled_at   = null,
         cancelled_by   = null,
         cancel_reason  = null
   where id = p_job_id;

  perform set_config('app.job_cancel_op', '', true);

  perform public.create_notification(
    'job_plan',
    'งาน ' || v_job_no || ' ถูกคืนจากการยกเลิก',
    'เหตุผล: ' || v_reason,
    p_job_id, v_job_no, 'planner'::app_role, null::job_status, null::uuid, true);
end;
$$;

revoke execute on function public.restore_job(uuid, text) from public, anon;
grant  execute on function public.restore_job(uuid, text) to authenticated;


-- ------------------------------------------------------------
-- (5) dashboard_job_counts — ยกบอดี้ 0104 · เพิ่มแค่ "ไม่นับงานที่ยกเลิก" ในบรรทัด where
-- ------------------------------------------------------------
create or replace function public.dashboard_job_counts(p_company_id uuid default null)
returns table (
  unplan           bigint,
  pending_announce bigint,
  planned          bigint,
  producing        bigint,
  packing          bigint,
  qc               bigint,
  qa               bigint,
  awaiting_fg      bigint,
  in_stock         bigint,
  problem          bigint,
  total            bigint,
  incident_open    bigint
)
language sql
stable
set search_path = public
as $fn$
  with latest as (
    select distinct on (pr.job_id) pr.job_id, pr.station_id
      from public.production_records pr
     where pr.status <> 'rejected'
     order by pr.job_id, pr.record_date desc, pr.created_at desc
  ),
  open_inc as (
    select distinct d.job_id
      from public.deviations d
     where d.status not in ('closed', 'cancelled')
  )
  select
    count(*) filter (where j.status = 'pending_announce'
                       and j.plan_month is null
                       and coalesce(btrim(j.sub_status), '') in ('', 'ไม่มีแผน')),
    count(*) filter (where j.status = 'pending_announce'
                       and not (j.plan_month is null
                                and coalesce(btrim(j.sub_status), '') in ('', 'ไม่มีแผน'))),
    count(*) filter (where j.status = 'planned'),
    count(*) filter (where j.status = 'in_production' and not coalesce(s.is_packing, false)),
    count(*) filter (where j.status = 'in_production' and coalesce(s.is_packing, false)),
    count(*) filter (where j.status = 'qc'),
    count(*) filter (where j.status = 'qa'),
    count(*) filter (where j.status = 'finished_goods' and fg.job_id is null),
    count(*) filter (where j.status = 'finished_goods' and fg.job_id is not null),
    count(*) filter (where (j.problem is not null or oi.job_id is not null)
                       and not (j.status = 'finished_goods' and fg.job_id is not null)),
    count(*),
    count(*) filter (where oi.job_id is not null
                       and not (j.status = 'finished_goods' and fg.job_id is not null))
  from public.jobs j
  left join latest              l  on l.job_id  = j.id
  left join public.stations     s  on s.id      = l.station_id
  left join public.fg_inventory fg on fg.job_id = j.id
  left join open_inc            oi on oi.job_id = j.id
  where j.status <> 'cancelled'
    and (p_company_id is null or j.company_id = p_company_id);
$fn$;


-- ------------------------------------------------------------
-- (6) เลิกใช้ delete_job
-- ------------------------------------------------------------
drop function if exists public.delete_job(uuid);


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ)
--
-- ข้อ 1 · ฟังก์ชันใหม่มีครบ และ delete_job หายไปแล้ว
--   select proname from pg_proc
--    where proname in ('cancel_job', 'restore_job', 'delete_job', 'guard_cancelled_job', 'guard_cancelled_job_child')
--    order by proname;
--   ✅ 4 แถว: cancel_job · guard_cancelled_job · guard_cancelled_job_child · restore_job  (ไม่มี delete_job)
--
-- ข้อ 2 · trigger ล็อกติดครบ 12 ตาราง
--   select count(*) from pg_trigger
--    where tgname in ('trg_guard_cancelled_job', 'trg_guard_cancelled_jobs') and not tgisinternal;
--   ✅ 12
--
-- ข้อ 3 · คอลัมน์ใหม่ในตาราง jobs
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'jobs' and column_name like 'cancel%'
--    order by column_name;
--   ✅ 4 แถว: cancel_reason · cancelled_at · cancelled_by · cancelled_from
--
-- ข้อ 4 · แดชบอร์ดยังทำงาน
--   select total from public.dashboard_job_counts();
--   ✅ ได้ตัวเลข 1 แถว (ไม่ error)
-- ============================================================
