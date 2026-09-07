-- ============================================================
-- PD Monitor — Part Notification / 0084_notification_targeting.sql
--   ก้อน 1 "แก้ของที่ผิด" — โครงสร้างการจ่าหน้าแจ้งเตือน + 4 บั๊กที่ตรวจเจอ
--
--   (1) notifications += target_profile_id (แจ้งรายบุคคล) + skip_creator (ไม่แจ้งผู้ก่อเหตุ)
--   (2) create_notification overload 9-arg · ปิดสิทธิ์เรียกจากภายนอก · ทิ้ง overload 6-arg ที่ไม่มีคนใช้
--   (3) read_notifications policy + unread_notification_count() — ผู้บริหารเห็นทุกแถว (แก้คู่กันเสมอ)
--   (4) request_edit        — เลิกส่งคำขอแก้ผลตรวจ QC ไปหา QA
--   (5) review_edit_request — ถอด QA ออกจากผู้อนุมัติ + ส่ง "ผลคำขอ" ถึงผู้ยื่นคนเดียว
--   (6) open_deviation_internal / submit_deviation_resolution — ตัดใบซ้ำของผู้บริหาร
-- รัน "หลัง" 0083 · ไม่มี enum ใหม่ · signature ของ RPC ที่แอปเรียกไม่เปลี่ยน → paste รอบเดียวจบ รันซ้ำได้
--
-- 🎯 ที่มา: หน้า Notion "Part Notification" (3d192ef2-c18f-8012-ad9f-cf8072f5acca)
--
-- 🐞 บั๊กที่ปิดในไฟล์นี้
--   B1  request_edit ส่งคำขอแก้ "ผลตรวจ QC" ไปหา QA ด้วย (0083:99-102)
--       — ทีมยืนยันว่า QA ไม่ควรได้รับ · และ QA ยังเป็น "ผู้อนุมัติตามสิทธิ์" อยู่ (0083:174-175)
--       ถ้าตัดแค่แจ้งเตือนจะเหลือสภาพ "อนุมัติได้แต่ไม่รู้ว่ามีคำขอ" จึงถอดทั้งสองอย่างพร้อมกัน
--   B2  review_edit_request ส่ง edit_reviewed ด้วย target_role = null (0083:194, 256)
--       — RLS (0026:45) แปล null ว่า "ทุกคน" ⇒ ทั้งโรงงานเห็นว่าคำขอของใครถูกตัดสินยังไง
--       ขัดกับเจตนาของ 0083:111-114 เองที่อุตส่าห์กันไม่ให้พนักงานเห็นคำขอของกันและกัน
--   B3  ผู้บริหาร (manager) ไม่เห็นแจ้งเตือนของฝ่ายอื่น
--       — has_role() (0078:50-68) ให้ admin ผ่านทุก role แต่ manager ไม่ผ่าน
--       ⇒ ผู้บริหารพลาดใบ arrival ทุกใบ · ใบ reject · Incident ระดับ minor
--   B4  create_notification ไม่เคยถูก revoke จาก public/anon (ต่างจาก RPC ตัวอื่นที่ revoke ครบ)
--       — SECURITY DEFINER ที่ PUBLIC เรียกได้ = ยิงแจ้งเตือนปลอมเข้าระบบได้
--
-- 🚨 request_edit / review_edit_request ถูก create or replace ทับกันมาแล้ว 10 รอบ
--    (0033 → 0034 → 0036 → 0037 → 0057 → 0059 → 0063 → 0065 → 0073 → 0083)
--    ไฟล์นี้ยกบอดี้ล่าสุดจาก 0083 มา "ทั้งก้อน" แล้ว diff เทียบ — ห้ามเขียนใหม่จากศูนย์
--    open_deviation_internal ยกจาก 0067:209-272 · submit_deviation_resolution ยกจาก 0074:128-240
-- ============================================================

-- ------------------------------------------------------------
-- (1) โครงสร้าง — จ่าหน้าถึง "คน" ได้ + ข้ามคนที่ก่อเหตุเองได้
--
--   target_profile_id : เดิมแจ้งได้แค่ "รายบทบาท" (target_role) เท่านั้น
--                       ⇒ เรื่องที่เป็นของคนคนเดียว (ผลคำขอแก้ไข · ผลอนุมัติงานที่ตัวเองบันทึก)
--                         ไม่มีทางส่งให้ถูกคน ต้องกระจายทั้งฝ่ายหรือทั้งโรงงาน
--   skip_creator      : requirement ของฝ่ายวางแผน "Job ใหม่เข้าระบบ ถ้าเป็นคนสร้างเองไม่ต้องแจ้ง"
--                       created_by มีอยู่แล้ว (0026:22) — ขาดแค่ธงว่าใบนี้ให้ข้ามผู้ก่อเหตุไหม
--                       เก็บเป็นธงต่อใบ (ไม่ผูกกับ kind) เพราะกฎนี้ใช้กับหลายเหตุการณ์ในก้อน 2-3
-- ------------------------------------------------------------
alter table public.notifications
  add column if not exists target_profile_id uuid references public.profiles(id) on delete cascade;

alter table public.notifications
  add column if not exists skip_creator boolean not null default false;

comment on column public.notifications.target_profile_id is
  'ส่งถึงคนคนเดียว (null = ใช้ target_role ตามเดิม) — ผู้บริหาร/แอดมินก็ไม่เห็นใบชนิดนี้ โดยตั้งใจ';
comment on column public.notifications.skip_creator is
  'true = ไม่ต้องแสดงให้คนที่ทำให้เกิดเหตุ (created_by) เห็น — เช่น คนสร้างงานเองไม่ต้องได้ใบ "งานใหม่"';

-- on delete cascade: ลบบัญชีแล้วใบที่จ่าหน้าถึงคนนั้นไม่มีความหมายอีก
-- (แนวเดียวกับ notification_reads ที่ cascade อยู่แล้ว — ช่วยให้ admin_delete_user (0082) ลบจริงได้ง่ายขึ้น)

create index if not exists idx_notifications_target_profile
  on public.notifications(target_profile_id) where target_profile_id is not null;

-- ------------------------------------------------------------
-- (2) create_notification — overload 9-arg
--
--   ประวัติ overload: 6-arg (0026:56) → 7-arg เพิ่ม relevant_status (0029:21) → 9-arg (ไฟล์นี้)
--   ตรวจแล้วว่าไม่มี call site ไหนเรียก 6-arg เหลืออยู่ จึง drop ทิ้งเพื่อลดโอกาสเรียกผิดตัว
--   (ถ้าเผลอเรียก 6-arg แจ้งเตือนจะไม่มี relevant_status = ไม่ auto-hide ตลอดกาล)
--
--   🚨 ห้ามใส่ DEFAULT ให้ 2 พารามิเตอร์ใหม่เด็ดขาด
--      overload 7-arg ยังอยู่ (ฟังก์ชันเก่าอีกหลายตัวเรียกอยู่) — ถ้า 2 ตัวท้ายมี default
--      การเรียกด้วย 7 อาร์กิวเมนต์จะเข้าเงื่อนไขของ "ทั้ง 2 overload" พร้อมกัน
--      ⇒ Postgres ตอบ "function is not unique" แล้วฟังก์ชันเก่าทุกตัวพังทันที
--      ผู้เรียก 9-arg ต้องส่งครบ 9 ตัวเสมอ (เขียนชัดดีกว่าอยู่แล้วว่าใบนี้ส่งถึงใคร/ข้ามใคร)
--
--   🔒 B4: revoke จาก public/anon/authenticated ให้ครบ — เป็น SECURITY DEFINER ที่เขียนตาราง
--      ถูกเรียกจาก RPC อื่นที่เป็น definer อยู่แล้วเท่านั้น จึงไม่ต้อง grant ให้ role ไหนเลย
-- ------------------------------------------------------------
drop function if exists public.create_notification(text, text, text, uuid, text, app_role);

create or replace function public.create_notification(
  p_kind              text,
  p_title             text,
  p_body              text,
  p_job_id            uuid,
  p_job_no            text,
  p_target_role       app_role,
  p_relevant_status   job_status,
  p_target_profile_id uuid,
  p_skip_creator      boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  insert into public.notifications
    (kind, title, body, job_id, job_no, target_role, relevant_status,
     target_profile_id, skip_creator, created_by)
  values
    (p_kind, p_title, nullif(btrim(coalesce(p_body, '')), ''),
     p_job_id, p_job_no, p_target_role, p_relevant_status,
     p_target_profile_id, coalesce(p_skip_creator, false), public.current_profile_id())
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke execute on function public.create_notification(
  text, text, text, uuid, text, app_role, job_status, uuid, boolean) from public;
revoke execute on function public.create_notification(
  text, text, text, uuid, text, app_role, job_status, uuid, boolean) from anon;
revoke execute on function public.create_notification(
  text, text, text, uuid, text, app_role, job_status, uuid, boolean) from authenticated;

-- overload 7-arg (0029) ยังถูกเรียกจากฟังก์ชันเก่าที่ไฟล์นี้ไม่ได้แตะ → ต้องคงไว้ แต่ปิดสิทธิ์ให้เหมือนกัน
revoke execute on function public.create_notification(
  text, text, text, uuid, text, app_role, job_status) from public;
revoke execute on function public.create_notification(
  text, text, text, uuid, text, app_role, job_status) from anon;
revoke execute on function public.create_notification(
  text, text, text, uuid, text, app_role, job_status) from authenticated;

comment on function public.create_notification(
  text, text, text, uuid, text, app_role, job_status, uuid, boolean) is
  'สร้างแจ้งเตือน (เรียกจาก RPC security definer เท่านั้น) — 0084 เพิ่ม target_profile_id + skip_creator';

-- ------------------------------------------------------------
-- (3) ใครเห็นแจ้งเตือนใบไหน — B3
--
-- 🚨 ตรรกะก้อนนี้ถูกเขียนซ้ำ "3 ที่" และต้องตรงกันเป๊ะเสมอ:
--      ก. policy read_notifications        → ใช้ตอน getInbox() อ่านผ่าน PostgREST
--      ข. unread_notification_count()      → เลขบนกระดิ่ง (security definer ⇒ RLS ไม่มีผล)
--      ค. mark_all_notifications_read()    → ปุ่ม "อ่านทั้งหมด" (definer เหมือนกัน)
--    แก้ที่ไหนต้องแก้อีก 2 ที่ในไฟล์เดียวกันเสมอ
--    (คำเตือนคู่กันอยู่ที่ web/lib/data/notifications.ts)
--
-- กติกาใหม่ 3 ข้อ:
--   1. ใบที่จ่าหน้าถึงคน (target_profile_id) → เห็นคนเดียว · ผู้บริหาร/แอดมินก็ไม่เห็น
--      (ตั้งใจ — ผลคำขอแก้ไขเป็นเรื่องส่วนตัวของผู้ยื่น · ผู้บริหารดูภาพรวมได้ที่หน้า "คำขอแก้ไข" อยู่แล้ว)
--   2. ใบที่จ่าหน้าถึงบทบาท → เจ้าของบทบาท (has_role สืบทอด lead→base) + ผู้บริหาร + แอดมิน
--      has_role('manager') ครอบ admin ให้เองแล้ว (0078:64) ไม่ต้องเขียน admin ซ้ำ
--   3. ใบที่ตั้ง skip_creator → ไม่แสดงให้คนที่ก่อเหตุเอง
-- ------------------------------------------------------------
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
  );

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
     );
$$;

grant execute on function public.unread_notification_count() to authenticated;

comment on function public.unread_notification_count() is
  'นับแจ้งเตือนที่ยังไม่อ่านและยังไม่หมดหน้าที่ — 0084: ผู้บริหารเห็นทุกแถว · รองรับ target_profile_id + skip_creator · ต้องตรงกับ policy read_notifications เสมอ';

-- "อ่านทั้งหมด" ต้องเห็นชุดเดียวกับกระดิ่ง ไม่งั้นจะเหลือใบค้างที่กดปิดไม่ได้
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
  on conflict (notification_id, profile_id) do nothing;
end;
$$;

grant execute on function public.mark_all_notifications_read() to authenticated;

-- ------------------------------------------------------------
-- (4) request_edit — บอดี้ 0083:23-131 · เปลี่ยนจุดเดียว: ตัดใบที่ยิงหา 'qa' (B1)
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
as $fn$
declare
  v_profile    uuid;
  v_job        uuid;
  v_job_no     text;
  v_reason     text;
  v_id         uuid;
  v_allowed    text[];
  v_key        text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'กรุณาระบุเหตุผลการขอแก้ไข'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'ไม่มีรายการที่จะแก้ไข';
  end if;

  if p_target_type = 'production_record' then
    v_allowed := array['input_qty','output_qty','loss_qty','minutes','headcount','note',
                       'record_date','station_id','machine_id',
                       'input_unit','output_unit','loss_unit','shift','work_period'];
    select job_id into v_job from public.production_records where id = p_target_id;
  elsif p_target_type = 'material_requisition' then
    raise exception 'ระบบเบิกวัตถุดิบแบบเดิมถูกยกเลิกแล้ว — แก้รายการเบิกได้ที่หน้างานโดยตรง';
  else -- inprocess_check
    -- Part C.4: การขอแก้ผลตรวจระหว่างผลิตเป็นหน้าที่ QC เท่านั้น
    -- (ฝ่ายผลิตเคยกดได้เพราะ canAmend ฝั่งแอปเป็น "ทุกคนที่ล็อกอิน" — ซ่อนปุ่มอย่างเดียวไม่พอ)
    if not public.can_record_inprocess() then
      raise exception 'เฉพาะ QC/หัวหน้า QC/ผู้บริหารขอแก้ไขผลตรวจระหว่างผลิตได้';
    end if;
    v_allowed := array['param','value','unit','result','note','station_id','valid_date'];
    select job_id into v_job from public.inprocess_checks where id = p_target_id;
  end if;
  if v_job is null then raise exception 'ไม่พบรายการที่จะขอแก้ไข'; end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'ฟิลด์ "%" แก้ไขไม่ได้', v_key;
    end if;
  end loop;

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

  perform public.create_notification(
    'edit_request',
    'คำขอแก้ไขย้อนหลัง — งาน ' || coalesce(v_job_no, ''),
    v_reason, v_job, v_job_no, 'manager'::app_role, null::job_status);
  if p_target_type = 'inprocess_check' then
    -- Part Notification (0084): ตัดใบที่เคยยิงหา 'qa' ออก
    --   QA ไม่ได้เป็นผู้อนุมัติคำขอชนิดนี้อีกแล้ว (ดู review_edit_request ในไฟล์เดียวกัน)
    --   ⇒ ส่งให้ 'qc_lead' อย่างเดียว · ผู้บริหารเห็นผ่าน RLS ตัวใหม่อยู่แล้ว
    perform public.create_notification(
      'edit_request',
      'คำขอแก้ไขผลตรวจ QC — งาน ' || coalesce(v_job_no, ''),
      v_reason, v_job, v_job_no, 'qc_lead'::app_role, null::job_status);
  end if;

  -- 0083: หัวหน้าฝ่ายผลิตอนุมัติคำขอชนิดนี้ได้แล้ว → ต้องได้รับแจ้งเตือนด้วย
  --   แจ้งที่ role 'production_lead' ตรง ๆ ไม่ใช่ 'production' —
  --   RLS ของ notifications ใช้ has_role(target_role) ซึ่งสืบทอดทางเดียว lead → base (0078)
  --   ถ้าใส่ 'production' พนักงานทั้งฝ่ายจะเห็นคำขอของกันและกันไปด้วย
  if p_target_type = 'production_record' then
    perform public.create_notification(
      'edit_request',
      'คำขอแก้ไขบันทึกผลผลิต — งาน ' || coalesce(v_job_no, ''),
      v_reason, v_job, v_job_no, 'production_lead'::app_role, null::job_status);
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.request_edit(edit_target_type, uuid, jsonb, text) from public;
revoke execute on function public.request_edit(edit_target_type, uuid, jsonb, text) from anon;
grant  execute on function public.request_edit(edit_target_type, uuid, jsonb, text) to authenticated;

comment on function public.request_edit(edit_target_type, uuid, jsonb, text) is
  'ยื่นคำขอแก้ไขย้อนหลัง — 0084: แจ้งหัวหน้าฝ่ายผลิต (บันทึกผลผลิต) · หัวหน้า QC (in-process) · เลิกแจ้ง QA';

-- ------------------------------------------------------------
-- (5) review_edit_request — บอดี้ 0083:136-265 · เปลี่ยน 2 จุด: ถอด QA ออกจากผู้อนุมัติ (B1)
--     + ส่ง edit_reviewed ถึงผู้ยื่นคนเดียวผ่าน target_profile_id (B2)
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
as $fn$
declare
  v_profile uuid;
  v_req     public.edit_requests%rowtype;
  v_note    text;
  v_job_no  text;
  v_in      numeric;
  v_out     numeric;
  v_reset   boolean;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  select * into v_req from public.edit_requests where id = p_id for update;
  if not found then raise exception 'ไม่พบคำขอแก้ไข'; end if;
  if v_req.status <> 'pending' then raise exception 'คำขอนี้ถูกดำเนินการไปแล้ว'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'คำสั่งไม่ถูกต้อง'; end if;

  -- Part D — เพิ่ม qc_lead (หัวหน้า QC)
  --   ต้นเหตุบั๊ก "ขอแก้ไขแล้วไม่มีปุ่มอนุมัติ": คนที่กดขอแก้ผลตรวจ in-process ได้คือ
  --   qc / qc_lead / manager (0065:133) แต่คนที่อนุมัติได้มีแค่ manager + qa
  --   → หัวหน้า QC ยื่นเองแล้วไม่มีใครในสายงานกดอนุมัติได้เลย
  --   กติกานี้เขียนไว้ตั้งแต่ 0033 ตอนที่ยังไม่มี role qc_lead (เพิ่งเกิดที่ 0060)
  --   ⚠️ ให้ qc_lead อนุมัติได้เฉพาะ inprocess_check เท่านั้น — คำขอชนิดอื่นยังเป็นของ manager
  --   Part Notification (0084) — ถอด qa ออกจากผู้อนุมัติ inprocess_check
  --     ทีมยืนยันว่า "QA ไม่ควรได้รับคำขอแก้ไขของฝ่าย QC" ⇒ ถอดทั้งสิทธิ์และแจ้งเตือน
  --     ไม่งั้นจะเหลือสภาพ "อนุมัติได้แต่ไม่รู้ว่ามีคำขอ" ซึ่งแย่กว่าเดิม
  --     ⚠️ ต้องตรงกับ EDIT_REVIEWER_ROLES / EDIT_REVIEWER_TARGETS ฝั่งแอปเสมอ
  --   0083 — เพิ่ม production_lead (หัวหน้าฝ่ายผลิต) สำหรับคำขอชนิด production_record
  --   ⚠️ ให้อนุมัติได้เฉพาะ production_record เท่านั้น — คำขอผลตรวจ QC เป็นของ qc_lead (0084 ถอด qa ออก)
  --   ℹ️ has_role('production_lead') เป็นจริงเฉพาะผู้ถือ role นั้นจริง + admin
  --      (สืบทอดทางเดียว lead → base เท่านั้น · 0078:50-68) ⇒ พนักงานฝ่ายผลิตยังอนุมัติไม่ได้
  if not (public.has_role('manager')
          or (v_req.target_type = 'inprocess_check'
              and public.has_role('qc_lead'))
          or (v_req.target_type = 'production_record'
              and public.has_role('production_lead'))) then
    raise exception 'สิทธิ์ของคุณอนุมัติคำขอนี้ไม่ได้';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  select job_no into v_job_no from public.jobs where id = v_req.job_id;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_decision = 'reject' then
    perform set_config('app.audit_reason', 'ปฏิเสธคำขอแก้ไข', true);
    update public.edit_requests
       set status = 'rejected', reviewed_by = v_profile, reviewed_at = now(),
           review_note = v_note, updated_by = v_profile
     where id = p_id;
    -- 🐞 0084 ปิดบั๊ก: เดิมส่ง target_role = null ซึ่ง RLS (0026:45) แปลว่า "ทุกคน"
    --    ⇒ ทั้งโรงงานเห็นว่าคำขอของใครถูกตัดสินยังไง · ที่ถูกคือส่งถึงผู้ยื่นคนเดียว
    perform public.create_notification(
      'edit_reviewed', 'คำขอแก้ไขถูกปฏิเสธ',
      coalesce(v_note, 'ไม่ระบุเหตุผล'), v_req.job_id, v_job_no,
      null::app_role, null::job_status, v_req.requested_by, false);
    return;
  end if;

  perform set_config('app.audit_reason', 'แก้ไขย้อนหลังตามคำขอที่อนุมัติ', true);

  if v_req.target_type = 'production_record' then
    update public.production_records set
      input_qty   = case when v_req.changes ? 'input_qty'   then (v_req.changes->>'input_qty')::numeric   else input_qty   end,
      output_qty  = case when v_req.changes ? 'output_qty'  then (v_req.changes->>'output_qty')::numeric  else output_qty  end,
      loss_qty    = case when v_req.changes ? 'loss_qty'    then (v_req.changes->>'loss_qty')::numeric    else loss_qty    end,
      minutes     = case when v_req.changes ? 'minutes'     then (v_req.changes->>'minutes')::numeric     else minutes     end,
      headcount   = case when v_req.changes ? 'headcount'   then (v_req.changes->>'headcount')::integer   else headcount   end,
      note        = case when v_req.changes ? 'note'        then nullif(btrim(v_req.changes->>'note'), '') else note        end,
      record_date = case when v_req.changes ? 'record_date' then (v_req.changes->>'record_date')::date    else record_date end,
      station_id  = case when v_req.changes ? 'station_id'  then (v_req.changes->>'station_id')::uuid      else station_id end,
      machine_id  = case when v_req.changes ? 'machine_id'  then nullif(v_req.changes->>'machine_id', '')::uuid  else machine_id  end,
      input_unit  = case when v_req.changes ? 'input_unit'  then nullif(btrim(v_req.changes->>'input_unit'), '')  else input_unit  end,
      output_unit = case when v_req.changes ? 'output_unit' then nullif(btrim(v_req.changes->>'output_unit'), '') else output_unit end,
      loss_unit   = case when v_req.changes ? 'loss_unit'   then nullif(btrim(v_req.changes->>'loss_unit'), '')   else loss_unit   end,
      shift       = case when v_req.changes ? 'shift'       then nullif(v_req.changes->>'shift', '')::work_shift  else shift       end,
      work_period = case when v_req.changes ? 'work_period' then nullif(v_req.changes->>'work_period', '')::work_period else work_period end,
      updated_by  = v_profile
    where id = v_req.target_id;
    select input_qty, output_qty into v_in, v_out
    from public.production_records where id = v_req.target_id;
    if v_in is not null and v_out is not null and v_out > v_in then
      raise exception 'แก้ไม่ได้ — ผลิตได้ต้องไม่เกินยอดที่ต้องการ';
    end if;

  elsif v_req.target_type = 'inprocess_check' then
    -- Part C.4: แก้ "ผล" หรือ "ค่าที่วัดได้" ของผลที่หัวหน้า QC อนุมัติไปแล้ว
    -- = คำตัดสินเดิมใช้กับข้อมูลชุดใหม่ไม่ได้ → เด้งกลับไปรออนุมัติใหม่
    -- (ไม่งั้นมีช่องแก้ผลที่ผ่านด่านไปแล้วโดยผู้อนุมัติไม่รู้เรื่อง)
    v_reset := (v_req.changes ? 'result' or v_req.changes ? 'value');
    update public.inprocess_checks set
      param      = case when v_req.changes ? 'param'  then nullif(btrim(v_req.changes->>'param'), '') else param  end,
      value      = case when v_req.changes ? 'value'  then nullif(btrim(v_req.changes->>'value'), '') else value  end,
      unit       = case when v_req.changes ? 'unit'   then nullif(btrim(v_req.changes->>'unit'), '')  else unit   end,
      result     = case when v_req.changes ? 'result' then (v_req.changes->>'result')::check_result   else result end,
      note       = case when v_req.changes ? 'note'   then nullif(btrim(v_req.changes->>'note'), '')  else note   end,
      station_id = case when v_req.changes ? 'station_id' then (v_req.changes->>'station_id')::uuid    else station_id end,
      valid_date = case when v_req.changes ? 'valid_date' then nullif(v_req.changes->>'valid_date', '')::date else valid_date end,
      -- ทุก case ด้านล่างอ่านค่า status ของ "แถวเดิม" (ก่อน update) จึงเทียบ 'approved' ได้ตรง
      status       = case when v_reset and status = 'approved' then 'pending'::inprocess_status else status end,
      approved_by  = case when v_reset and status = 'approved' then null else approved_by  end,
      approved_at  = case when v_reset and status = 'approved' then null else approved_at  end,
      approve_note = case when v_reset and status = 'approved' then null else approve_note end,
      updated_by = v_profile
    where id = v_req.target_id;

  else
    raise exception 'คำขอชนิดนี้เลิกใช้แล้ว อนุมัติไม่ได้ — กดปฏิเสธเพื่อปิดคำขอแทน';
  end if;

  update public.edit_requests
     set status = 'applied', reviewed_by = v_profile, reviewed_at = now(),
         review_note = v_note, updated_by = v_profile
   where id = p_id;

  perform public.create_notification(
    'edit_reviewed', 'คำขอแก้ไขได้รับอนุมัติ',
    'ข้อมูลถูกแก้ไขตามคำขอแล้ว', v_req.job_id, v_job_no,
    null::app_role, null::job_status, v_req.requested_by, false);
end;
$fn$;

revoke execute on function public.review_edit_request(uuid, text, text) from public;
revoke execute on function public.review_edit_request(uuid, text, text) from anon;
grant  execute on function public.review_edit_request(uuid, text, text) to authenticated;

comment on function public.review_edit_request(uuid, text, text) is
  'อนุมัติ/ปฏิเสธคำขอแก้ไข — 0084: หัวหน้าฝ่ายผลิต = production_record · หัวหน้า QC = inprocess_check (ถอด QA ออกแล้ว) · ผลส่งถึงผู้ยื่นคนเดียว';

-- ------------------------------------------------------------
-- (6) ตัดใบซ้ำของผู้บริหาร — ทำได้เพราะข้อ (3) ให้ manager เห็นทุกแถวแล้ว
--     ทั้ง 2 จุดเคยยิงข้อความ "เหมือนกันเป๊ะ" กับใบของ QA ⇒ ผู้บริหารเห็นเรื่องเดียวกัน 2 ใบ
--     open_deviation_internal ยกบอดี้จาก 0067:209-272 · ไม่มี grant (definer ภายในล้วน)
-- ------------------------------------------------------------
create or replace function public.open_deviation_internal(
  p_job_id             uuid,
  p_title              text,
  p_description        text,
  p_dev_type           text,
  p_severity           deviation_severity,
  p_machine_id         uuid,
  p_inprocess_check_id uuid,
  p_qa_sample_id       uuid,
  p_actor              uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id     uuid;
  v_job_no text;
  v_title  text;
begin
  select job_no into v_job_no from public.jobs where id = p_job_id;
  if v_job_no is null then raise exception 'ไม่พบงานที่เลือก'; end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null then raise exception 'กรุณาระบุหัวข้อ Incident Case'; end if;

  -- กันเปิดซ้ำจากต้นทางเดียวกัน (ชั้นที่ 2 = partial unique index ในก้อน 6)
  if p_inprocess_check_id is not null then
    select id into v_id from public.deviations
     where inprocess_check_id = p_inprocess_check_id limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  if p_qa_sample_id is not null then
    select id into v_id from public.deviations
     where qa_sample_id = p_qa_sample_id limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.deviations
    (job_id, machine_id, inprocess_check_id, qa_sample_id, title, description,
     dev_type, severity, status, reported_by, created_by)
  values
    (p_job_id, p_machine_id, p_inprocess_check_id, p_qa_sample_id, v_title,
     nullif(btrim(coalesce(p_description, '')), ''),
     coalesce(nullif(btrim(coalesce(p_dev_type, '')), ''), 'other'),
     coalesce(p_severity, 'minor'), 'qa_review', p_actor, p_actor)
  returning id into v_id;

  -- flow ใหม่: QA ต้องตรวจสอบ "ทุกใบ" → แจ้ง QA เสมอ (เดิมแจ้งเฉพาะ major/critical)
  perform public.create_notification(
    'deviation',
    'Incident Case ใหม่ — งาน ' || v_job_no,
    v_title, p_job_id, v_job_no, 'qa'::app_role, null::job_status);
  -- 0084: ตัดใบซ้ำของผู้บริหารออก — RLS ตัวใหม่ให้ manager เห็น "ทุกแถว" อยู่แล้ว
  --   ใบเดิมมีข้อความเดียวกับใบของ QA ⇒ ผู้บริหารจะเห็นเรื่องเดียวกัน 2 ใบ
  --   (ระดับความรุนแรงยังอ่านได้จากหน้า Incident Case ตามเดิม)

  return v_id;
end;
$fn$;


revoke execute on function public.open_deviation_internal(
  uuid, text, text, text, deviation_severity, uuid, uuid, uuid, uuid) from public;
revoke execute on function public.open_deviation_internal(
  uuid, text, text, text, deviation_severity, uuid, uuid, uuid, uuid) from anon;
revoke execute on function public.open_deviation_internal(
  uuid, text, text, text, deviation_severity, uuid, uuid, uuid, uuid) from authenticated;

comment on function public.open_deviation_internal(
  uuid, text, text, text, deviation_severity, uuid, uuid, uuid, uuid) is
  'เปิด Incident Case โดยไม่เช็กสิทธิ์ — สำหรับให้ RPC อื่นเรียกต่อเท่านั้น (ไม่ grant ให้ใคร)';

-- ------------------------------------------------------------
-- submit_deviation_resolution — ยกบอดี้จาก 0074:128-240
-- ------------------------------------------------------------
create or replace function public.submit_deviation_resolution(
  p_id   uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_role    text;
  v_dev     public.deviations%rowtype;
  v_job_no  text;
  v_note    text;
  v_left    integer;
  v_total   integer;
  v_line    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  v_role := public.current_role_group();

  select * into v_dev from public.deviations where id = p_id for update;
  if v_dev.id is null then raise exception 'ไม่พบ Incident Case'; end if;
  if v_dev.status in ('closed', 'cancelled') then
    raise exception 'Incident Case นี้ปิด/ยกเลิกไปแล้ว';
  end if;
  if v_dev.status = 'qa_review' then
    raise exception 'เคสนี้ยังรอ QA ตรวจสอบอยู่ — ยังไม่ถูกส่งให้แผนกใด';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  -- Part C.4 เพิ่มเติม — บังคับกรอก "การแก้ไขเบื้องต้น" ก่อนส่งผลให้ QA
  -- (เดิมส่งช่องว่างได้ → เคสขึ้น "ตอบแล้ว 1/1" ทั้งที่ไม่มีเนื้อหาอะไรเลย)
  if v_note is null then
    raise exception 'ต้องระบุ "การแก้ไขเบื้องต้น" ก่อนส่งผลให้ QA';
  end if;

  select job_no into v_job_no from public.jobs where id = v_dev.job_id;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'แผนกบันทึกผลดำเนินการ Incident Case', true);

  update public.deviation_departments
     set responded_by  = v_profile,
         responded_at  = now(),
         response_note = v_note,
         updated_by    = v_profile
   where deviation_id = p_id
     and role_group   = v_role::app_role
     and responded_at is null;

  if not found then
    raise exception 'ฝ่ายของคุณไม่ได้ถูกมอบหมายให้แก้ไขเคสนี้ (หรือบันทึกผลไปแล้ว)';
  end if;

  -- Part C.4 เพิ่มเติม — ผลของแผนกไปลง "การแก้ไขเบื้องต้น" (capa) ของเคสด้วย
  -- ต่อท้ายไม่ทับ เพราะหลายแผนกเขียนคนละบรรทัด · QA ยังแก้เองได้ในฟอร์ม
  -- (update_deviation บังคับ capa ก่อนปิดเคส — ถ้าไม่ส่งต่อ QA ต้องพิมพ์ซ้ำเองทุกครั้ง)
  v_line := '[' || case v_role
                     when 'warehouse'   then 'คลัง'
                     when 'qc'          then 'QC'
                     when 'production'  then 'ผลิต'
                     when 'engineering' then 'วิศวกรรม'
                     else v_role
                   end || '] ' || v_note;

  update public.deviations
     set capa = case when coalesce(btrim(capa), '') = '' then v_line
                     else capa || E'\n' || v_line end
   where id = p_id;

  -- ป้ายใช้ role สูงสุด (Part D) — ห้ามใช้ v_role ที่เป็น "ฝ่ายสำหรับจับคู่แผนก"
  insert into public.deviation_comments (deviation_id, role_group, body, created_by)
  values (p_id, public.current_role_badge(),
          '✅ บันทึกผลดำเนินการแล้ว'
            || case when v_note is not null then ': ' || v_note else '' end,
          v_profile);

  select count(*) filter (where responded_at is null), count(*)
    into v_left, v_total
    from public.deviation_departments where deviation_id = p_id;

  if v_left = 0 then
    -- ครบทุกแผนกแล้ว → ส่งกลับให้ QA อนุมัติ
    update public.deviations
       set status                  = 'qa_verify',
           resolution_note         = coalesce(v_note, resolution_note),
           resolution_submitted_by = v_profile,
           resolution_submitted_at = now(),
           updated_by              = v_profile
     where id = p_id;

    perform public.create_notification(
      'deviation',
      'Incident Case งาน ' || coalesce(v_job_no, '') || ' — ทุกแผนกแก้ไขครบแล้ว รอ QA อนุมัติ',
      coalesce(v_note, v_dev.title), v_dev.job_id, v_job_no, 'qa'::app_role, null::job_status);
    -- 0084: ตัดใบซ้ำของผู้บริหารออก (ข้อความเดียวกับใบของ QA เป๊ะ · manager เห็นทุกแถวแล้ว)
  else
    -- ยังไม่ครบ → คงสถานะเดิม แต่บอก QA ว่าคืบไปเท่าไร
    perform public.create_notification(
      'deviation',
      'Incident Case งาน ' || coalesce(v_job_no, '') || ' — แผนกตอบแล้ว '
        || (v_total - v_left)::text || '/' || v_total::text,
      coalesce(v_note, v_dev.title), v_dev.job_id, v_job_no, 'qa'::app_role, null::job_status);
  end if;
end;
$fn$;

revoke execute on function public.submit_deviation_resolution(uuid, text) from public;
revoke execute on function public.submit_deviation_resolution(uuid, text) from anon;
grant  execute on function public.submit_deviation_resolution(uuid, text) to authenticated;

comment on function public.submit_deviation_resolution(uuid, text) is
  'แผนกที่รับผิดชอบบันทึกผลดำเนินการ — 0084 ตัดใบซ้ำของผู้บริหารออก (manager เห็นทุกแถวผ่าน RLS แล้ว)';

-- ============================================================
-- ตรวจผลหลัง paste (รันทีละบรรทัด — PostgREST อ่านเนื้อในฟังก์ชันจากนอกไม่ได้)
--   select count(*) from pg_proc where proname='create_notification';            -- ควรได้ 2 (7-arg + 9-arg)
--   select position('''qa''::app_role' in prosrc) = 0  as qa_removed
--     from pg_proc where proname='request_edit';                                 -- ควรได้ true
--   select position('v_req.requested_by' in prosrc) > 0 as reviewed_personal
--     from pg_proc where proname='review_edit_request';                          -- ควรได้ true
--   select position('has_role(''manager'')' in prosrc) > 0 as mgr_sees_all
--     from pg_proc where proname='unread_notification_count';                    -- ควรได้ true
--   select column_name from information_schema.columns
--    where table_name='notifications'
--      and column_name in ('target_profile_id','skip_creator');                  -- ควรได้ 2 แถว
-- ============================================================
