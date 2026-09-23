-- ============================================================
-- PD Monitor — Part F / 0091_notification_dismiss_purge.sql
--   (1) ลบแจ้งเตือนแบบ "เลือกหลายรายการ" — ซ่อนเฉพาะของคนที่กด
--   (2) ล้างแจ้งเตือนที่อายุครบ 7 วันโดยอัตโนมัติ (ตั้งตาราง cron ที่ 0094)
--
-- 🔑 ทำไมต้อง "ซ่อนรายคน" ไม่ใช่ลบแถวทิ้ง
--    แจ้งเตือน 1 ใบจ่าหน้าถึง target_role ⇒ คนทั้งฝ่ายเห็น "แถวเดียวกัน"
--    ถ้าลบแถวจริง คนคลังคนหนึ่งกดลบ = ลบของเพื่อนร่วมฝ่ายทุกคนด้วย
--    → ใช้ notification_reads (PK = notification_id + profile_id · 0026:31-36)
--      ที่เป็นตัวจำ "รายคน" อยู่แล้ว เพิ่มแค่คอลัมน์ dismissed_at
--    🎁 ผลพลอยได้: ลบ = อ่านแล้วไปในตัว ⇒ เลขกระดิ่งลดตามทันที
--
-- 🚨 ตรรกะ "ใครเห็นใบไหน" ตอนนี้ถูกเขียนซ้ำ 4 ที่ (0084 เขียนว่า 3 — เพิ่มมาอีกที่ตอน 0087)
--      ก. policy read_notifications        (0084:146-158)
--      ข. unread_notification_count()      (0084:160-192)
--      ค. mark_all_notifications_read()    (0084:200-224)
--      ง. get_inbox()                      (0087:40-68)
--    ไฟล์นี้เติมเงื่อนไข "ยังไม่ถูกซ่อน" ให้ครบทั้ง 4 ที่ในคราวเดียว
--
-- รัน "หลัง" 0090 · รันซ้ำได้
-- ============================================================


-- ------------------------------------------------------------
-- (1) คอลัมน์จำว่า "ผู้ใช้คนนี้กดลบใบนี้แล้ว"
-- ------------------------------------------------------------
alter table public.notification_reads
  add column if not exists dismissed_at timestamptz;

comment on column public.notification_reads.dismissed_at is
  'ผู้ใช้คนนี้กดลบแจ้งเตือนใบนี้เมื่อไหร่ — null = ยังไม่ลบ · ซ่อนเฉพาะของคนนี้ คนอื่นในฝ่ายยังเห็น (0091)';


-- ------------------------------------------------------------
-- (2) dismiss_notifications — ลบทีละหลายใบ
--     รูปแบบผลลัพธ์ {dismissed, skipped} ลอกจาก review_production_records (0080:170-209)
--     🔒 กรองด้วยเงื่อนไข "ใครเห็นใบไหน" ชุดเดียวกัน ⇒ ยัด id ที่ตัวเองไม่มีสิทธิ์เห็นมาไม่ได้
-- ------------------------------------------------------------
create or replace function public.dismiss_notifications(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_total   int;
  v_done    int;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  p_ids   := coalesce(p_ids, '{}'::uuid[]);
  v_total := coalesce(cardinality(p_ids), 0);
  if v_total = 0 then
    return jsonb_build_object('dismissed', 0, 'skipped', 0);
  end if;
  -- เพดานเดียวกับ get_inbox() (0087:68) — หน้าเว็บเลือกได้มากสุดเท่าที่แสดงอยู่
  if v_total > 200 then
    raise exception 'ลบได้ครั้งละไม่เกิน 200 รายการ';
  end if;

  with visible as (
    select n.id
      from public.notifications n
     where n.id = any (p_ids)
       and (
             (n.target_profile_id is not null and n.target_profile_id = v_profile)
             or (
               n.target_profile_id is null
               and (n.target_role is null or public.has_role(n.target_role) or public.has_role('manager'))
             )
           )
       and (not n.skip_creator or n.created_by is distinct from v_profile)
  )
  insert into public.notification_reads (notification_id, profile_id, read_at, dismissed_at)
  select v.id, v_profile, now(), now()
    from visible v
  on conflict (notification_id, profile_id)
    do update set dismissed_at = now();          -- read_at เดิมคงไว้ (เวลาที่อ่านจริง)
  get diagnostics v_done = row_count;

  return jsonb_build_object('dismissed', v_done, 'skipped', v_total - v_done);
end;
$fn$;

revoke execute on function public.dismiss_notifications(uuid[]) from public;
revoke execute on function public.dismiss_notifications(uuid[]) from anon;
grant  execute on function public.dismiss_notifications(uuid[]) to authenticated;

comment on function public.dismiss_notifications(uuid[]) is
  'ลบแจ้งเตือนหลายใบ — ซ่อนเฉพาะของผู้ใช้ปัจจุบัน (คนอื่นที่ได้ใบเดียวกันยังเห็น) · คืน {dismissed, skipped}';


-- ------------------------------------------------------------
-- (3) purge_old_notifications — ล้างใบที่อายุครบกำหนด (ลบจริง)
--
-- ✅ ปลอดภัยตาม GMP: ร่องรอยการทำงานจริงอยู่ที่ audit_log / approvals
--    notifications เป็นแค่ "กล่องแจ้ง" ไม่ใช่หลักฐาน
-- 🔒 ไม่ grant ให้ authenticated — มีแต่ cron (เจ้าของฟังก์ชัน) ที่เรียกได้
-- ------------------------------------------------------------
create or replace function public.purge_old_notifications(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_days int := greatest(coalesce(p_days, 7), 1);
  v_n    int;
begin
  -- notification_reads หลุดตาม on delete cascade (0026:32-33)
  delete from public.notifications
   where created_at < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke execute on function public.purge_old_notifications(integer) from public;
revoke execute on function public.purge_old_notifications(integer) from anon;
revoke execute on function public.purge_old_notifications(integer) from authenticated;

comment on function public.purge_old_notifications(integer) is
  'ลบแจ้งเตือนที่เก่ากว่า N วัน (ค่าเริ่มต้น 7) — เรียกโดย pg_cron เท่านั้น (0094) · คืนจำนวนแถวที่ลบ';


-- ------------------------------------------------------------
-- (4) เติมเงื่อนไข "ยังไม่ถูกซ่อน" ให้ครบทั้ง 4 ที่
--
--   not exists (select 1 from notification_reads r
--                where r.notification_id = <ใบนี้>
--                  and r.profile_id      = <ฉัน>
--                  and r.dismissed_at is not null)
--
-- 🚨 ทั้ง 4 ก้อนด้านล่างต้อง "เหมือนกันเป๊ะ" — แก้ที่ไหนต้องแก้ครบทุกที่เสมอ
--    ต่างกันแค่ (ข) กรองใบที่อ่านแล้วทิ้งด้วย และ (ง) คืนคอลัมน์ read มาให้ UI
-- ------------------------------------------------------------

-- (ก) policy read_notifications — ใช้ตอนอ่านตารางตรง (realtime / PostgREST)
drop policy if exists read_notifications on public.notifications;
create policy read_notifications on public.notifications
  for select to authenticated
  using (
    (
      (target_profile_id is not null and target_profile_id = public.current_profile_id())
      or (
        target_profile_id is null
        and (target_role is null or public.has_role(target_role) or public.has_role('manager'))
      )
    )
    and (not skip_creator or created_by is distinct from public.current_profile_id())
    and not exists (
      select 1 from public.notification_reads r
       where r.notification_id = notifications.id
         and r.profile_id = public.current_profile_id()
         and r.dismissed_at is not null
    )
  );

-- (ข) เลขบนกระดิ่ง
create or replace function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.notifications n
   where (
           (n.target_profile_id is not null and n.target_profile_id = public.current_profile_id())
           or (
             n.target_profile_id is null
             and (n.target_role is null or public.has_role(n.target_role) or public.has_role('manager'))
           )
         )
     and (not n.skip_creator or n.created_by is distinct from public.current_profile_id())
     and (
       n.relevant_status is null
       or (
         n.relevant_status = (select j.status from public.jobs j where j.id = n.job_id)
         and not (
           n.relevant_status = 'finished_goods'
           and exists (select 1 from public.fg_inventory f where f.job_id = n.job_id)
         )
       )
     )
     and not exists (
       select 1 from public.notification_reads r
        where r.notification_id = n.id
          and r.profile_id = public.current_profile_id()
          and r.dismissed_at is not null
     )
     and not exists (
       select 1 from public.notification_reads r
        where r.notification_id = n.id
          and r.profile_id = public.current_profile_id()
     );
$$;

revoke execute on function public.unread_notification_count() from public;
revoke execute on function public.unread_notification_count() from anon;
grant  execute on function public.unread_notification_count() to authenticated;

comment on function public.unread_notification_count() is
  'นับแจ้งเตือนที่ยังไม่อ่าน ยังไม่หมดหน้าที่ และยังไม่ถูกผู้ใช้กดลบ (0091) — ต้องตรงกับ get_inbox() เสมอ';

-- (ค) ปุ่ม "ทำเครื่องหมายอ่านทั้งหมด" — ต้องเห็นชุดเดียวกับกระดิ่ง
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
   where (
           (n.target_profile_id is not null and n.target_profile_id = v_profile)
           or (
             n.target_profile_id is null
             and (n.target_role is null or public.has_role(n.target_role) or public.has_role('manager'))
           )
         )
     and (not n.skip_creator or n.created_by is distinct from v_profile)
     and not exists (
       select 1 from public.notification_reads r
        where r.notification_id = n.id
          and r.profile_id = v_profile
          and r.dismissed_at is not null
     )
  on conflict (notification_id, profile_id) do nothing;
end;
$$;

revoke execute on function public.mark_all_notifications_read() from public;
revoke execute on function public.mark_all_notifications_read() from anon;
grant  execute on function public.mark_all_notifications_read() to authenticated;

-- (ง) get_inbox — รายการที่แสดงจริงบนหน้า 🔔
--     ยกบอดี้จาก 0087:22-69 · เพิ่มเงื่อนไข "ยังไม่ถูกซ่อน" อย่างเดียว
create or replace function public.get_inbox(
  p_limit  integer     default 30,
  p_before timestamptz default null
)
returns table (
  id         uuid,
  kind       text,
  title      text,
  body       text,
  job_no     text,
  created_at timestamptz,
  read       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.kind, n.title, n.body, n.job_no, n.created_at,
         exists (
           select 1 from public.notification_reads r
            where r.notification_id = n.id
              and r.profile_id = public.current_profile_id()
         ) as read
    from public.notifications n
   where (
           (n.target_profile_id is not null and n.target_profile_id = public.current_profile_id())
           or (
             n.target_profile_id is null
             and (n.target_role is null or public.has_role(n.target_role) or public.has_role('manager'))
           )
         )
     and (not n.skip_creator or n.created_by is distinct from public.current_profile_id())
     and (
       n.relevant_status is null
       or (
         n.relevant_status = (select j.status from public.jobs j where j.id = n.job_id)
         and not (
           n.relevant_status = 'finished_goods'
           and exists (select 1 from public.fg_inventory f where f.job_id = n.job_id)
         )
       )
     )
     and not exists (
       select 1 from public.notification_reads r
        where r.notification_id = n.id
          and r.profile_id = public.current_profile_id()
          and r.dismissed_at is not null
     )
     and (p_before is null or n.created_at < p_before)
   order by n.created_at desc
   -- เพดานแข็ง 200 กันหน้าเว็บดึงทั้งตารางเมื่อผู้บริหารเห็นทุกแถว
   limit least(greatest(coalesce(p_limit, 30), 1), 200);
$$;

revoke execute on function public.get_inbox(integer, timestamptz) from public;
revoke execute on function public.get_inbox(integer, timestamptz) from anon;
grant  execute on function public.get_inbox(integer, timestamptz) to authenticated;

comment on function public.get_inbox(integer, timestamptz) is
  'กล่องแจ้งเตือนของผู้ใช้ปัจจุบัน — กรอง "ใครเห็นใบไหน" + "ใบหมดหน้าที่" + "ใบที่กดลบไปแล้ว" ที่ SQL แล้วค่อย limit · เงื่อนไข where ต้องตรงกับ unread_notification_count() เสมอ';


-- ============================================================
-- ✅ ตรวจหลัง paste
--   select column_name from information_schema.columns
--    where table_name = 'notification_reads' and column_name = 'dismissed_at';   -- 1 แถว
--   select proname from pg_proc
--    where proname in ('dismiss_notifications','purge_old_notifications');       -- 2 แถว
--   select proname, prosrc like '%dismissed_at%' as ok from pg_proc
--    where proname in ('get_inbox','unread_notification_count','mark_all_notifications_read');
--        -- ok = true ทั้ง 3
--   select count(*) from get_inbox(200, null) where not read;
--        -- ต้องเท่ากับ select public.unread_notification_count();
--   -- ดูปริมาณของที่รอบล้างจะเก็บไปครั้งแรก (ยังไม่ลบจริง):
--   select count(*) from public.notifications where created_at < now() - interval '7 days';
-- ============================================================
