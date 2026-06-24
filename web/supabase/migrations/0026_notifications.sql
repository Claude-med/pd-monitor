-- ============================================================
-- PD Monitor — D12 / 0026_notifications.sql  (B4: Notification — in-app inbox)
--   notifications       = แจ้งเตือนที่เก็บถาวร (event-driven: งานถูกตีกลับ · เปิด deviation)
--   notification_reads  = สถานะ "อ่านแล้ว" ต่อผู้ใช้ (1 แถว = 1 คนอ่าน 1 ข้อความ)
-- ส่งตาม role: target_role (null = ทุกคน) · ผู้ใช้เห็นเฉพาะที่ has_role(target_role)
-- (overdue/stuck = คำนวณสดในแอป ไม่เก็บตาราง)
-- เขียนผ่าน RPC security definer · รัน "หลัง" 0001–0025
-- ============================================================

-- ------------------------------------------------------------
-- notifications
-- ------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                     -- reject / deviation
  title       text not null,
  body        text,
  job_id      uuid references public.jobs(id) on delete cascade,
  job_no      text,                              -- เก็บไว้ทำลิงก์ (กันงานถูกลบ)
  target_role app_role,                          -- null = ส่งทุกคน
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_created on public.notifications(created_at desc);
create index if not exists idx_notifications_role    on public.notifications(target_role);

-- ------------------------------------------------------------
-- notification_reads — ใครอ่านข้อความไหนแล้ว
-- ------------------------------------------------------------
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, profile_id)
);

-- ------------------------------------------------------------
-- RLS — เห็นเฉพาะที่ส่งถึง role ตน · reads = ของตัวเอง
-- ------------------------------------------------------------
alter table public.notifications enable row level security;
drop policy if exists read_notifications on public.notifications;
create policy read_notifications on public.notifications
  for select to authenticated
  using (target_role is null or public.has_role(target_role));

alter table public.notification_reads enable row level security;
drop policy if exists read_notification_reads on public.notification_reads;
create policy read_notification_reads on public.notification_reads
  for select to authenticated
  using (profile_id = public.current_profile_id());

-- ------------------------------------------------------------
-- helper: สร้างแจ้งเตือน (เรียกภายในจาก RPC อื่น · attribute = ผู้กระทำ)
-- ------------------------------------------------------------
create or replace function public.create_notification(
  p_kind        text,
  p_title       text,
  p_body        text,
  p_job_id      uuid,
  p_job_no      text,
  p_target_role app_role
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.notifications (kind, title, body, job_id, job_no, target_role, created_by)
  values (p_kind, p_title, nullif(btrim(coalesce(p_body, '')), ''),
          p_job_id, p_job_no, p_target_role, public.current_profile_id())
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- mark_notification_read / mark_all_notifications_read
-- ------------------------------------------------------------
create or replace function public.mark_notification_read(p_id uuid)
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
  insert into public.notification_reads (notification_id, profile_id)
  values (p_id, v_profile)
  on conflict (notification_id, profile_id) do nothing;
end;
$$;

grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read()
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
  insert into public.notification_reads (notification_id, profile_id)
  select n.id, v_profile
    from public.notifications n
   where (n.target_role is null or public.has_role(n.target_role))
  on conflict (notification_id, profile_id) do nothing;
end;
$$;

grant execute on function public.mark_all_notifications_read() to authenticated;

-- ------------------------------------------------------------
-- unread_notification_count — จำนวนที่ยังไม่อ่านของผู้ใช้ปัจจุบัน (สำหรับกระดิ่ง)
-- ------------------------------------------------------------
create or replace function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.notifications n
   where (n.target_role is null or public.has_role(n.target_role))
     and not exists (
       select 1 from public.notification_reads r
        where r.notification_id = n.id
          and r.profile_id = public.current_profile_id()
     );
$$;

grant execute on function public.unread_notification_count() to authenticated;

-- ============================================================
-- ยกเครื่อง advance_job_status: คง GATE เดิม (line clearance + deviation)
--   + เพิ่มแจ้งเตือนฝ่ายผลิตเมื่อ "ตีกลับ" (B4)
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
  v_job_no    text;
  v_is_reject boolean := false;
  v_allowed   boolean := false;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  select status, job_no into v_from, v_job_no from public.jobs where id = p_job_id for update;
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

  -- B4: แจ้งฝ่ายผลิตเมื่องานถูกตีกลับ
  if v_is_reject then
    perform public.create_notification(
      'reject',
      'งาน ' || v_job_no || ' ถูกตีกลับ',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ไม่ระบุเหตุผล'),
      p_job_id, v_job_no, 'production');
  end if;
end;
$$;

grant execute on function public.advance_job_status(uuid, job_status, text) to authenticated;

-- ============================================================
-- ยกเครื่อง open_deviation: เหมือน 0025 + แจ้งเตือน QA/ผู้จัดการ เมื่อ major/critical
-- ============================================================
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
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('production') or public.has_role('qc')
          or public.has_role('qa') or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณเปิด deviation ไม่ได้';
  end if;

  select job_no into v_job_no from public.jobs where id = p_job_id;
  if v_job_no is null then raise exception 'ไม่พบงานที่เลือก'; end if;
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

  -- B4: deviation ร้ายแรง → แจ้ง QA + ผู้จัดการ
  if coalesce(p_severity, 'minor') in ('major', 'critical') then
    perform public.create_notification(
      'deviation',
      'Deviation (' || p_severity::text || ') งาน ' || v_job_no,
      p_title, p_job_id, v_job_no, 'qa');
    perform public.create_notification(
      'deviation',
      'Deviation (' || p_severity::text || ') งาน ' || v_job_no,
      p_title, p_job_id, v_job_no, 'manager');
  end if;

  return v_id;
end;
$$;

grant execute on function public.open_deviation(
  uuid, text, text, text, deviation_severity, uuid, uuid, uuid, date
) to authenticated;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notification_reads;
exception when duplicate_object then null; end $$;
