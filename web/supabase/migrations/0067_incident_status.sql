-- ============================================================
-- PD Monitor — Part C.4 / 0067_incident_status.sql  (ก้อน 4)
--   "Deviation" → "Incident Case" · เปลี่ยนสถานะเป็น flow ใหม่ 5 ขั้น
--
--   flow ที่ทีมกำหนด:  เปิด → QA ตรวจสอบ → ส่งแผนกที่เกี่ยวข้องแก้ไข → ส่งกลับ QA → QA อนุมัติ
--
--   (1) enum ใหม่ incident_status แทน deviation_status (แปลงข้อมูลเก่าให้ครบ)
--   (2) ทุกคนที่ล็อกอินเปิดเคสได้ (เดิม production/qc/qa/manager เท่านั้น —
--       ตกหล่น qc_lead / production_lead / engineering / planner / warehouse)
--   (3) ตัด "กำหนดปิด" กับ "ผู้รับผิดชอบรายคน" ออกจากตอนเปิด · เลิกบังคับ root cause ตอนปิด
--   (4) 🐞 แก้ current_role_group() ที่ tag ฝ่ายผิดคน + ไม่รู้จักครึ่งหนึ่งของ role ในระบบ
--
-- 🚨 ก้อนนี้เปลี่ยนชนิดคอลัมน์ → ต้อง "รัน SQL นี้ก่อน แล้วค่อย push โค้ดแอป"
--    ถ้า deploy แอปก่อน dropdown จะส่ง 'qa_review' เข้า RPC ที่ยังรับ deviation_status → error ทุกครั้ง
--
-- ℹ️ ทำไมใช้ "สร้าง type ใหม่ + alter column type" แทน "alter type add value":
--      Postgres ลบค่า enum ทิ้งไม่ได้ → ถ้า add value ค่า open/investigating จะติดอยู่ตลอดกาล
--      (เจ็บมาแล้วกับ material_requisition ใน edit_target_type)
--      และการ create type ใหม่ไม่ติดข้อห้าม "ต้องแยกรอบ paste" แบบ add value
--
-- ℹ️ ทำไม "ไม่" เปลี่ยนชื่อตาราง deviations → incident_cases:
--      audit_log.table_name เก็บค่า 'deviations' ของแถวประวัติเก่าไว้ — เปลี่ยนชื่อแล้วประวัติ
--      แตกเป็นสองชื่อและต้อง join ด้วย in (...) ตลอดไป (ผิดหลัก ALCOA เรื่องความต่อเนื่อง)
--      แลกกับความสวยของชื่อที่ผู้ใช้ไม่เห็นอยู่แล้ว → เปลี่ยนเฉพาะคำบนจอ
--
-- ℹ️ advance_job_status "ไม่ต้องแตะ" — มันเรียก has_open_deviation(uuid) ซึ่ง signature ไม่เปลี่ยน
--    (ฉบับล่าสุดของมันอยู่ 0062:341-458 ยาว ~120 บรรทัด มี GATE เลขล็อต/route/แจ้งเตือน 5 บล็อก
--     ยกมาไม่ครบ = ด่าน GMP หายเงียบ ไม่คุ้มความเสี่ยงเพื่อแก้แค่ข้อความ)
-- รัน "หลัง" 0001–0066
-- ============================================================

-- ------------------------------------------------------------
-- (1) enum ใหม่
--     cancelled ใส่ตั้งแต่รอบแรกแม้ยังใช้น้อย — เพิ่มทีหลังต้อง alter column type ซ้ำอีกรอบ
--     และถ้าไม่มี เคสที่ "เปิดผิด" จะต้องถูกปิดปลอมๆ เพื่อปลดล็อก GATE = ประวัติ GMP เพี้ยน
-- ------------------------------------------------------------
do $$ begin
  create type incident_status as enum
    ('qa_review', 'in_progress', 'qa_verify', 'closed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- (2) ปลด dependency ก่อนเปลี่ยนชนิดคอลัมน์
--     update_deviation รับ deviation_status เป็นพารามิเตอร์ → drop ตัวเก่าทิ้งก่อน
--     open_deviation ก็ drop เพราะกำลังจะเปลี่ยน signature (ตัด p_assigned_to / p_due_date)
-- ------------------------------------------------------------
drop function if exists public.update_deviation(
  uuid, deviation_status, text, text, uuid, date, deviation_severity);
drop function if exists public.open_deviation(
  uuid, text, text, text, deviation_severity, uuid, uuid, uuid, date);

-- ------------------------------------------------------------
-- (3) สลับชนิดคอลัมน์ + แปลงข้อมูลเก่า
--
--   open           → qa_review   (เปิดแล้ว รอ QA ตรวจสอบ)
--   investigating  → qa_verify   ถ้าเคยกด "แจ้งแก้ไขเรียบร้อย" (resolution_submitted_at ไม่ null)
--                  → qa_review   ถ้ายังไม่เคยกด
--   closed         → closed
--
--   ⚠️ ที่ไม่เหมา investigating เป็น qa_review ทั้งหมด เพราะสถานะนั้นถูกตั้งโดย
--      submit_deviation_resolution (0030:133) = "แจ้งแก้แล้ว รอ QA" ซึ่งตรงกับ qa_verify พอดี
--      เหมารวมแล้วงานที่แจ้งแก้ไปแล้วจะถอยหลังกลับไปให้ทำใหม่โดยไม่มีใครสั่ง
-- ------------------------------------------------------------
alter table public.deviations alter column status drop default;

alter table public.deviations
  alter column status type incident_status
  using (
    case
      when status::text = 'closed' then 'closed'
      when status::text = 'investigating' and resolution_submitted_at is not null then 'qa_verify'
      else 'qa_review'
    end::incident_status
  );

alter table public.deviations alter column status set default 'qa_review'::incident_status;

-- ------------------------------------------------------------
-- (4) คอลัมน์
-- ------------------------------------------------------------
alter table public.deviations
  -- ผู้รับผิดชอบ "รายคน" เลิกใช้ — แทนที่ด้วยตาราง deviation_departments ในก้อน 5
  -- (คอลัมน์นี้เป็น null ทุกแถวอยู่แล้ว เพราะแอปฮาร์ดโค้ดส่ง null มาตลอด)
  drop column if exists assigned_to,
  add  column if not exists qa_reviewed_by uuid references public.profiles(id),
  add  column if not exists qa_reviewed_at timestamptz,
  -- ผูกกับตัวอย่าง Finished product ที่ "ไม่ผ่าน" — ใช้จริงตอน auto-open ในก้อน 6
  add  column if not exists qa_sample_id uuid references public.qa_samples(id) on delete set null;

comment on table public.deviations is
  'Incident Case (เหตุผิดปกติ) — ชื่อทางธุรกิจที่ทีมเรียกตั้งแต่ Part C.4 · คงชื่อตารางเดิมไว้เพื่อไม่ให้ audit_log.table_name ขาดตอน';
comment on column public.deviations.root_cause is
  'เลิกใช้ตั้งแต่ Part C.4 (0067) — ถอดออกจากฟอร์มและเลิกบังคับตอนปิด · คงไว้อ่านอย่างเดียวสำหรับเคสเก่า';
comment on column public.deviations.capa is
  'Part C.4 เปลี่ยนความหมายเป็น "การแก้ไขเบื้องต้น" ของแผนกที่รับผิดชอบ (ยังบังคับกรอกตอนปิด)';
comment on column public.deviations.due_date is
  'กำหนดปิด — Part C.4 ย้ายไปกรอกตอน QA ตรวจสอบ ไม่ใช่ตอนเปิดเคส';

-- ------------------------------------------------------------
-- (5) 🐞 has_exact_role — เหมือน has_role() แต่ "admin ไม่ผ่านอัตโนมัติ"
--
--     ต้นเหตุ: current_role_group() (0030:49-55) ใช้ has_role() ซึ่ง admin ผ่านทุกข้อ
--     → หมายเหตุทุกอันที่ admin เขียนถูก tag เป็น 'production' เสมอ (เช็ก production เป็นอันแรก)
--       = ประวัติ GMP บอกฝ่ายผิดคน
--
--     ⚠️ ห้ามเอา has_exact_role() ไปใช้แทน has_role() ที่อื่น — มันตั้งใจให้ admin ไม่ผ่าน
--        ใช้เฉพาะกรณี "ระบุตัวฝ่ายของผู้ใช้" เท่านั้น
-- ------------------------------------------------------------
create or replace function public.has_exact_role(_role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
     where p.auth_user_id = (select auth.uid())
       and ur.role = _role
  );
$$;

revoke execute on function public.has_exact_role(app_role) from public;
revoke execute on function public.has_exact_role(app_role) from anon;
grant  execute on function public.has_exact_role(app_role) to authenticated;

comment on function public.has_exact_role(app_role) is
  'ผู้ใช้มี role นี้ตรงๆ ไหม — ต่างจาก has_role() ตรงที่ admin ไม่ผ่านอัตโนมัติ · ใช้ระบุ "ฝ่าย" ของผู้ใช้เท่านั้น';

-- ------------------------------------------------------------
-- (6) current_role_group — รู้จักครบทุก role + ไม่คืน null อีกต่อไป
--     คืน 'other' แทน null เพื่อให้ add_deviation_comment (0030:79) เลิก raise
--     กับ role ที่มันไม่รู้จัก (planner/cost/engineering/warehouse เคยคอมเมนต์ไม่ได้เลย)
--     lead map ลงฝ่ายฐานของตัวเอง (production_lead→production · qc_lead→qc) และต้องเช็กก่อน
-- ------------------------------------------------------------
create or replace function public.current_role_group()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_profile_id() is null      then null
    when public.has_exact_role('qa')              then 'qa'
    when public.has_exact_role('qc_lead')         then 'qc'
    when public.has_exact_role('qc')              then 'qc'
    when public.has_exact_role('production_lead') then 'production'
    when public.has_exact_role('production')      then 'production'
    when public.has_exact_role('engineering')     then 'engineering'
    when public.has_exact_role('warehouse')       then 'warehouse'
    when public.has_exact_role('planner')         then 'planner'
    when public.has_exact_role('cost')            then 'cost'
    when public.has_exact_role('manager')         then 'manager'
    when public.has_exact_role('admin')           then 'manager'
    else 'other'
  end;
$$;

revoke execute on function public.current_role_group() from public;
revoke execute on function public.current_role_group() from anon;
grant  execute on function public.current_role_group() to authenticated;

-- ------------------------------------------------------------
-- (7) can_review_incident — QA เป็นเจ้าของขั้นตรวจสอบและการปิดเคส
--     (การ "เปิด" เคสไม่มี helper เพราะเงื่อนไขคือ "ล็อกอิน" เฉยๆ — เช็กในฟังก์ชันตรงๆ
--      แพทเทิร์นเดียวกับ canManageJobSubStatuses ใน 0053)
-- ------------------------------------------------------------
create or replace function public.can_review_incident()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('qa') or public.has_role('manager');
$$;

revoke execute on function public.can_review_incident() from public;
revoke execute on function public.can_review_incident() from anon;
grant  execute on function public.can_review_incident() to authenticated;

-- ------------------------------------------------------------
-- (8) has_open_deviation — signature เดิมเป๊ะ (advance_job_status เรียกตัวนี้)
--     เพิ่ม cancelled เข้ากลุ่ม "ไม่นับว่าเปิดค้าง"
-- ------------------------------------------------------------
create or replace function public.has_open_deviation(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.deviations
     where job_id = p_job_id
       and status not in ('closed', 'cancelled')
  );
$$;

-- ------------------------------------------------------------
-- (9) open_deviation_internal — ตัวเปิดเคสที่ "ไม่เช็กสิทธิ์"
--     ให้ RPC อื่นเรียกต่อได้ (ก้อน 6: ผลตรวจไม่อนุมัติ / ตัวอย่างไม่ผ่าน → เปิดเคสอัตโนมัติ)
--     โดยไม่ติดสิทธิ์ของผู้เรียกและไม่ล้มทั้งทรานแซกชันถ้าเคสถูกเปิดไปแล้ว
--     ⚠️ เจอเคสซ้ำให้ "คืน id เดิม" ไม่ใช่ raise — ไม่งั้นการกดอนุมัติจะพังทั้งคำสั่ง
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
  if coalesce(p_severity, 'minor') in ('major', 'critical') then
    perform public.create_notification(
      'deviation',
      'Incident Case (' || p_severity::text || ') งาน ' || v_job_no,
      v_title, p_job_id, v_job_no, 'manager'::app_role, null::job_status);
  end if;

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
-- (10) open_deviation — signature ใหม่ · ทุกคนที่ล็อกอินเปิดได้
--      ตัด p_assigned_to (คอลัมน์ถูก drop) และ p_due_date (ย้ายไปขั้น QA ตรวจสอบ)
-- ------------------------------------------------------------
create or replace function public.open_deviation(
  p_job_id             uuid,
  p_title              text,
  p_description        text   default null,
  p_dev_type           text   default 'other',
  p_severity           deviation_severity default 'minor',
  p_machine_id         uuid   default null,
  p_inprocess_check_id uuid   default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
begin
  v_profile := public.current_profile_id();
  -- ทีมยืนยัน: "ทุกคนสามารถเปิดใช้งาน Incident Case ได้" (ฝ่ายไหนพบปัญหาก็เปิดได้)
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'เปิด Incident Case: ' || coalesce(btrim(p_title), ''), true);

  return public.open_deviation_internal(
    p_job_id, p_title, p_description, p_dev_type, p_severity,
    p_machine_id, p_inprocess_check_id, null, v_profile);
end;
$fn$;

revoke execute on function public.open_deviation(
  uuid, text, text, text, deviation_severity, uuid, uuid) from public;
revoke execute on function public.open_deviation(
  uuid, text, text, text, deviation_severity, uuid, uuid) from anon;
grant  execute on function public.open_deviation(
  uuid, text, text, text, deviation_severity, uuid, uuid) to authenticated;

comment on function public.open_deviation(
  uuid, text, text, text, deviation_severity, uuid, uuid) is
  'เปิด Incident Case — ทุกคนที่ล็อกอิน · เข้าสถานะ "รอ QA ตรวจสอบ" และแจ้ง QA เสมอ';

-- ------------------------------------------------------------
-- (11) update_deviation — signature ใหม่
--      ตัด p_root_cause (เลิกใช้) + p_assigned_to (คอลัมน์ถูก drop)
--      ปิดเคสต้อง QA/ผู้บริหาร + ต้องมี "การแก้ไขเบื้องต้น" (capa) — เลิกบังคับ root cause
--
--      🐞 แก้บั๊กเดิม 0025:201-202 ที่ล้าง closed_by/closed_at เป็น null ทุกครั้งที่สถานะ ≠ closed
--         (เคสที่ปิดแล้วถูกแตะอีกครั้งจะลืมว่าใครปิด)
-- ------------------------------------------------------------
create or replace function public.update_deviation(
  p_id       uuid,
  p_status   incident_status,
  p_capa     text default null,
  p_severity deviation_severity default null,
  p_due_date date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_cur     public.deviations%rowtype;
  v_capa    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  select * into v_cur from public.deviations where id = p_id for update;
  if v_cur.id is null then raise exception 'ไม่พบ Incident Case'; end if;

  v_capa := coalesce(nullif(btrim(coalesce(p_capa, '')), ''), v_cur.capa);

  if p_status = 'closed' then
    if not public.can_review_incident() then
      raise exception 'ปิด Incident Case ได้เฉพาะ QA/ผู้บริหาร';
    end if;
    if v_capa is null then
      raise exception 'ต้องระบุ "การแก้ไขเบื้องต้น" ก่อนปิด Incident Case';
    end if;
  elsif p_status = 'cancelled' then
    if not public.can_review_incident() then
      raise exception 'ยกเลิก Incident Case ได้เฉพาะ QA/ผู้บริหาร';
    end if;
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'อัปเดต Incident Case → ' || p_status::text, true);

  update public.deviations
     set status     = coalesce(p_status, status),
         capa       = v_capa,
         due_date   = coalesce(p_due_date, due_date),
         severity   = coalesce(p_severity, severity),
         closed_by  = case when p_status = 'closed'      then v_profile
                           when v_cur.status = 'closed'  then null   -- เปิดใหม่หลังปิด
                           else closed_by end,
         closed_at  = case when p_status = 'closed'      then now()
                           when v_cur.status = 'closed'  then null
                           else closed_at end,
         updated_by = v_profile
   where id = p_id;
end;
$fn$;

revoke execute on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date) from public;
revoke execute on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date) from anon;
grant  execute on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date) to authenticated;

-- ------------------------------------------------------------
-- (12) submit_deviation_resolution — 'investigating' → 'qa_verify'
--      บอดี้ยกมาจาก 0030:101-159 · ก้อน 5 จะยกเครื่องอีกรอบเป็นแบบ "รายแผนก"
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
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  v_role := public.current_role_group();

  select * into v_dev from public.deviations where id = p_id for update;
  if v_dev.id is null then raise exception 'ไม่พบ Incident Case'; end if;
  if v_dev.status in ('closed', 'cancelled') then
    raise exception 'Incident Case นี้ปิด/ยกเลิกไปแล้ว';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  select job_no into v_job_no from public.jobs where id = v_dev.job_id;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ส่ง Incident Case กลับให้ QA ตรวจสอบ', true);

  update public.deviations
     set status                  = 'qa_verify',
         resolution_note         = coalesce(v_note, resolution_note),
         resolution_submitted_by = v_profile,
         resolution_submitted_at = now(),
         updated_by              = v_profile
   where id = p_id;

  insert into public.deviation_comments (deviation_id, role_group, body, created_by)
  values (p_id, v_role,
          '✅ แจ้งแก้ไขเรียบร้อย — ส่งกลับให้ QA อนุมัติ'
            || case when v_note is not null then ': ' || v_note else '' end,
          v_profile);

  perform public.create_notification(
    'deviation',
    'Incident Case งาน ' || coalesce(v_job_no, '') || ' แก้ไขแล้ว — รอ QA อนุมัติ',
    coalesce(v_note, v_dev.title), v_dev.job_id, v_job_no, 'qa'::app_role, null::job_status);
  perform public.create_notification(
    'deviation',
    'Incident Case งาน ' || coalesce(v_job_no, '') || ' แก้ไขแล้ว — รอ QA อนุมัติ',
    coalesce(v_note, v_dev.title), v_dev.job_id, v_job_no, 'manager'::app_role, null::job_status);
end;
$fn$;

revoke execute on function public.submit_deviation_resolution(uuid, text) from public;
revoke execute on function public.submit_deviation_resolution(uuid, text) from anon;
grant  execute on function public.submit_deviation_resolution(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- (13) ทิ้ง enum เก่า — ถ้ายังมีอะไรอ้างอยู่ให้ข้ามไปเงียบๆ แล้วค่อยไล่เก็บทีหลัง
--      (ดีกว่าปล่อยให้ทั้งไฟล์ล้มตรงบรรทัดสุดท้าย)
-- ------------------------------------------------------------
do $$ begin
  drop type deviation_status;
exception when dependent_objects_still_exist or undefined_object then null; end $$;

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้ — ควรรันก่อนไปก้อน 5)
-- ------------------------------------------------------------
-- select unnest(enum_range(null::incident_status));   -- 5 ค่า: qa_review/in_progress/qa_verify/closed/cancelled
-- select to_regtype('deviation_status');              -- ต้องเป็น null
-- select status, count(*) from public.deviations group by status;   -- ต้องไม่มี open / investigating
--
-- -- เคสที่เคยกด "แจ้งแก้ไขเรียบร้อย" ต้องอยู่ qa_verify ไม่ใช่ qa_review (ต้องได้ 0 แถว)
-- select id from public.deviations
--  where resolution_submitted_at is not null and status = 'qa_review';
--
-- -- ไม่มี overload ซ้อน (ต้องได้ตัวละ 1 แถว)
-- select proname, count(*) from pg_proc
--  where proname in ('open_deviation','update_deviation','has_open_deviation',
--                    'submit_deviation_resolution','current_role_group',
--                    'has_exact_role','can_review_incident','open_deviation_internal')
--  group by proname;
--
-- -- คอลัมน์ assigned_to ต้องหายไปแล้ว (ต้องได้ 0 แถว)
-- select column_name from information_schema.columns
--  where table_name = 'deviations' and column_name = 'assigned_to';
-- ============================================================
