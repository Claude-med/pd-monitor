-- ============================================================
-- PD Monitor — Part C.4 / 0068_incident_qa_review.sql  (ก้อน 5)
-- ขั้น "QA ตรวจสอบ" ของ Incident Case + แผนกที่รับผิดชอบ (เลือกได้หลายแผนก)
--
--   (1) ประเภทเอกสาร DEV / OOS / NC + ช่องเลขที่ (QA พิมพ์เอง ระบบไม่ออกเลขให้)
--   (2) ตาราง deviation_departments — 1 เคสมอบหมายได้หลายแผนก
--   (3) qa_review_deviation  — QA คัดแยก + มอบหมาย + แจ้งเตือนทุกแผนกที่ติ๊ก (หรือยกเลิกเคส)
--   (4) submit_deviation_resolution — บันทึกผลรายแผนก · ครบทุกแผนกถึงจะเข้า "รอ QA อนุมัติ"
--   (5) update_deviation — ปิดเคสได้จาก qa_verify เป็นหลัก · QA ข้ามขั้นได้แต่ต้องมีเหตุผล
--
-- ℹ️ ทำไมใช้ "ตารางลูก" ไม่ใช่คอลัมน์ app_role[]:
--    ทีมต้องรู้ว่า "แผนกไหนตอบแล้ว / แผนกไหนยังค้าง" — array เก็บได้แค่รายชื่อผู้ถูกมอบหมาย
--    ต้องมี array ที่ 2 คู่ขนานเก็บผู้ตอบ ซึ่งไม่มี FK ผู้ตอบ ไม่มีเวลา ไม่มีหมายเหตุรายแผนก
--    และ log_audit() จับ diff ของ array ได้แต่อ่านไม่รู้เรื่อง
--
-- ℹ️ role_group เป็น app_role (ไม่ใช่ text) → ส่งเข้า create_notification(..., app_role, ...)
--    ได้ตรงๆ ไม่ต้อง map string · check constraint จำกัดไว้ 4 แผนกตามเอกสารโรงงาน
--
-- ⚠️ "ครบทุกแผนกถึงจะส่งกลับ QA" ตามที่ทีมยืนยัน — แต่ต้องมีวาล์วกันเคสค้างถาวร
--    (เคสที่ค้างจะบล็อก qa → finished_goods ตลอดไป) จึงเปิดทางไว้ 2 ทาง:
--      ก. QA เรียก qa_review_deviation ซ้ำเพื่อ "ถอดแผนกที่ยังไม่ตอบ" ออก
--      ข. QA/ผู้บริหารปิดเคสข้ามขั้นได้ โดยบังคับกรอกเหตุผล (ลง audit_log)
-- รัน "หลัง" 0067
-- ============================================================

-- ------------------------------------------------------------
-- (1) ประเภทเอกสาร + เลขที่
-- ------------------------------------------------------------
do $$ begin
  create type incident_case_type as enum ('dev', 'oos', 'nc');
exception when duplicate_object then null; end $$;

alter table public.deviations
  add column if not exists case_type incident_case_type,
  add column if not exists case_no   text;

comment on column public.deviations.case_type is
  'ประเภทเอกสารที่ QA คัดแยก: dev=Deviation · oos=Out of Specification · nc=Nonconformity';
comment on column public.deviations.case_no is
  'เลขที่เอกสาร (DEV No./OOS No./NC No.) — QA พิมพ์เอง เพราะเลขจริงออกจากระบบเอกสารคุณภาพนอกแอปนี้';

-- ระบบไม่ออกเลขให้ แต่กัน QA พิมพ์เลขซ้ำในประเภทเดียวกัน
create unique index if not exists uq_deviations_case_no
  on public.deviations (case_type, case_no) where case_no is not null;

-- ------------------------------------------------------------
-- (2) ตาราง deviation_departments
-- ------------------------------------------------------------
create table if not exists public.deviation_departments (
  id            uuid primary key default gen_random_uuid(),
  deviation_id  uuid not null references public.deviations(id) on delete cascade,
  role_group    app_role not null,
  assigned_by   uuid references public.profiles(id),
  assigned_at   timestamptz not null default now(),
  responded_by  uuid references public.profiles(id),
  responded_at  timestamptz,
  response_note text,
  created_by    uuid references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  unique (deviation_id, role_group),
  constraint chk_deviation_departments_role
    check (role_group in ('warehouse', 'qc', 'production', 'engineering'))
);

comment on table public.deviation_departments is
  'แผนกที่ QA มอบหมายให้แก้ไข Incident Case (Part C.4) — 1 เคสมีได้หลายแผนก · responded_at บอกว่าแผนกนั้นส่งกลับแล้วหรือยัง';
comment on column public.deviation_departments.role_group is
  'ตรงกับ app_role เพื่อส่งเข้า create_notification ได้ตรงๆ · จำกัด 4 แผนกตามเอกสารโรงงาน (WHS/QC/PRD/ENG)';

create index if not exists idx_deviation_departments_dev
  on public.deviation_departments (deviation_id);
-- หน้ารวมของแต่ละแผนก (ถ้าทำในอนาคต) จะกรองด้วย role_group + ยังไม่ตอบ
create index if not exists idx_deviation_departments_pending
  on public.deviation_departments (role_group) where responded_at is null;

drop trigger if exists trg_meta_deviation_departments on public.deviation_departments;
create trigger trg_meta_deviation_departments before insert or update on public.deviation_departments
  for each row execute function public.set_row_meta();

-- ตารางนี้มี UPDATE (responded_*) จึงต้องมี audit ต่างจาก deviation_comments ที่ append-only
drop trigger if exists trg_audit_deviation_departments on public.deviation_departments;
create trigger trg_audit_deviation_departments after insert or update or delete on public.deviation_departments
  for each row execute function public.log_audit();

alter table public.deviation_departments enable row level security;

drop policy if exists read_deviation_departments on public.deviation_departments;
create policy read_deviation_departments on public.deviation_departments
  for select to authenticated using (true);

do $$ begin
  alter publication supabase_realtime add table public.deviation_departments;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- (3) qa_review_deviation — ขั้น "QA ตรวจสอบ"
--     assign: ระบุประเภท+เลขที่ + มอบหมายแผนก → in_progress + แจ้งทุกแผนก
--     cancel: ปิดเคสที่ไม่ใช่เหตุผิดปกติจริง (ต้องมีเหตุผล)
-- ------------------------------------------------------------
create or replace function public.qa_review_deviation(
  p_id          uuid,
  p_decision    text,
  p_case_type   incident_case_type default null,
  p_case_no     text               default null,
  p_departments app_role[]         default null,
  p_due_date    date               default null,
  p_note        text               default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_dev     public.deviations%rowtype;
  v_job_no  text;
  v_no      text;
  v_note    text;
  v_dept    app_role;
  v_label   text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_review_incident() then
    raise exception 'ตรวจสอบ Incident Case ได้เฉพาะ QA/ผู้บริหาร';
  end if;
  if p_decision not in ('assign', 'cancel') then raise exception 'คำสั่งไม่ถูกต้อง'; end if;

  select * into v_dev from public.deviations where id = p_id for update;
  if v_dev.id is null then raise exception 'ไม่พบ Incident Case'; end if;
  if v_dev.status in ('closed', 'cancelled') then
    raise exception 'Incident Case นี้ปิด/ยกเลิกไปแล้ว';
  end if;

  v_note   := nullif(btrim(coalesce(p_note, '')), '');
  select job_no into v_job_no from public.jobs where id = v_dev.job_id;

  perform set_config('app.current_profile_id', v_profile::text, true);

  -- ── ยกเลิกเคส ────────────────────────────────────────────
  if p_decision = 'cancel' then
    if v_dev.status <> 'qa_review' then
      raise exception 'ยกเลิกได้เฉพาะเคสที่ยังไม่ถูกส่งให้แผนกใด';
    end if;
    if v_note is null then raise exception 'การยกเลิกต้องระบุเหตุผล'; end if;

    perform set_config('app.audit_reason', 'ยกเลิก Incident Case: ' || v_note, true);
    update public.deviations
       set status         = 'cancelled',
           qa_reviewed_by = v_profile,
           qa_reviewed_at = now(),
           updated_by     = v_profile
     where id = p_id;

    insert into public.deviation_comments (deviation_id, role_group, body, created_by)
    values (p_id, 'qa', '🚫 QA ยกเลิกเคส: ' || v_note, v_profile);
    return;
  end if;

  -- ── มอบหมายให้แผนกที่เกี่ยวข้อง ──────────────────────────
  if v_dev.status not in ('qa_review', 'in_progress') then
    raise exception 'เคสนี้ผ่านขั้นตรวจสอบไปแล้ว (สถานะ: %)', v_dev.status;
  end if;

  v_no := nullif(btrim(coalesce(p_case_no, '')), '');
  if p_case_type is null then raise exception 'กรุณาเลือกประเภทเคส (DEV / OOS / NC)'; end if;
  if v_no is null then raise exception 'กรุณาระบุเลขที่เอกสาร'; end if;
  if p_departments is null or array_length(p_departments, 1) is null then
    raise exception 'กรุณาเลือกแผนกที่รับผิดชอบอย่างน้อย 1 แผนก';
  end if;

  foreach v_dept in array p_departments loop
    if v_dept not in ('warehouse', 'qc', 'production', 'engineering') then
      raise exception 'แผนก "%" ไม่อยู่ในรายชื่อที่รับผิดชอบ Incident Case ได้', v_dept;
    end if;
  end loop;

  v_label := upper(p_case_type::text) || ' No. ' || v_no;
  perform set_config('app.audit_reason',
    'QA ตรวจสอบ Incident Case → ' || v_label, true);

  -- ถอดแผนกที่ "ยังไม่ตอบ" และไม่อยู่ในรายชื่อรอบนี้ออก
  -- (วาล์วกันเคสค้างถาวร — แผนกที่ตอบไปแล้วถอดไม่ได้ เพราะเป็นหลักฐานที่บันทึกไว้แล้ว)
  delete from public.deviation_departments
   where deviation_id = p_id
     and responded_at is null
     and role_group <> all(p_departments);

  foreach v_dept in array p_departments loop
    insert into public.deviation_departments
      (deviation_id, role_group, assigned_by, created_by)
    values (p_id, v_dept, v_profile, v_profile)
    on conflict (deviation_id, role_group) do nothing;
  end loop;

  update public.deviations
     set status         = 'in_progress',
         case_type      = p_case_type,
         case_no        = v_no,
         due_date       = coalesce(p_due_date, due_date),
         qa_reviewed_by = v_profile,
         qa_reviewed_at = now(),
         updated_by     = v_profile
   where id = p_id;

  insert into public.deviation_comments (deviation_id, role_group, body, created_by)
  values (p_id, 'qa',
          '🔎 QA ตรวจสอบแล้ว — ' || v_label || ' · ส่งให้แผนกที่เกี่ยวข้องดำเนินการ'
            || case when v_note is not null then ': ' || v_note else '' end,
          v_profile);

  -- แจ้งเตือนทุกแผนกที่ถูกมอบหมาย (เฉพาะแผนกที่ยังไม่ตอบ — ที่ตอบแล้วไม่ต้องกวน)
  for v_dept in
    select role_group from public.deviation_departments
     where deviation_id = p_id and responded_at is null
  loop
    perform public.create_notification(
      'deviation',
      'Incident Case ' || v_label || ' — งาน ' || coalesce(v_job_no, '') || ' มอบหมายให้ฝ่ายคุณ',
      v_dev.title, v_dev.job_id, v_job_no, v_dept, null::job_status);
  end loop;
end;
$fn$;

revoke execute on function public.qa_review_deviation(
  uuid, text, incident_case_type, text, app_role[], date, text) from public;
revoke execute on function public.qa_review_deviation(
  uuid, text, incident_case_type, text, app_role[], date, text) from anon;
grant  execute on function public.qa_review_deviation(
  uuid, text, incident_case_type, text, app_role[], date, text) to authenticated;

comment on function public.qa_review_deviation(
  uuid, text, incident_case_type, text, app_role[], date, text) is
  'ขั้น QA ตรวจสอบ Incident Case — assign: ระบุประเภท/เลขที่/แผนก แล้วส่งต่อ · cancel: ยกเลิกเคส (ต้องมีเหตุผล)';

-- ------------------------------------------------------------
-- (4) submit_deviation_resolution — บันทึกผลของ "แผนกผู้กด"
--     ยกบอดี้จาก 0067 แล้วเปลี่ยนเป็นแบบรายแผนก
--     ครบทุกแผนกเมื่อไหร่ → qa_verify (รอ QA อนุมัติ)
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

  insert into public.deviation_comments (deviation_id, role_group, body, created_by)
  values (p_id, v_role,
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
    perform public.create_notification(
      'deviation',
      'Incident Case งาน ' || coalesce(v_job_no, '') || ' — ทุกแผนกแก้ไขครบแล้ว รอ QA อนุมัติ',
      coalesce(v_note, v_dev.title), v_dev.job_id, v_job_no, 'manager'::app_role, null::job_status);
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
  'แผนกที่รับผิดชอบบันทึกผลดำเนินการ — ครบทุกแผนกแล้วเคสจะเข้าสถานะ "รอ QA อนุมัติ" เอง';

-- ------------------------------------------------------------
-- (5) update_deviation — ยกบอดี้จาก 0067 + เพิ่มด่านของ flow ใหม่
--     ปิดเคสตามปกติ = มาจาก qa_verify (แผนกส่งกลับครบแล้ว)
--     ปิดข้ามขั้น (qa_review / in_progress) ทำได้ แต่ต้องกรอกเหตุผล → ลง audit_log
-- ------------------------------------------------------------
create or replace function public.update_deviation(
  p_id       uuid,
  p_status   incident_status,
  p_capa     text default null,
  p_severity deviation_severity default null,
  p_due_date date default null,
  p_note     text default null
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
  v_note    text;
  v_reason  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  select * into v_cur from public.deviations where id = p_id for update;
  if v_cur.id is null then raise exception 'ไม่พบ Incident Case'; end if;

  v_capa   := coalesce(nullif(btrim(coalesce(p_capa, '')), ''), v_cur.capa);
  v_note   := nullif(btrim(coalesce(p_note, '')), '');
  v_reason := 'อัปเดต Incident Case → ' || p_status::text;

  if p_status = 'closed' then
    if not public.can_review_incident() then
      raise exception 'ปิด Incident Case ได้เฉพาะ QA/ผู้บริหาร';
    end if;
    if v_capa is null then
      raise exception 'ต้องระบุ "การแก้ไขเบื้องต้น" ก่อนปิด Incident Case';
    end if;
    -- ปิดก่อนที่แผนกจะส่งกลับครบ = ข้ามขั้น ต้องมีเหตุผลกำกับไว้ในประวัติ
    if v_cur.status in ('qa_review', 'in_progress') then
      if v_note is null then
        raise exception 'เคสนี้ยังไม่ผ่านขั้น "แผนกส่งกลับ" — ปิดข้ามขั้นต้องระบุเหตุผล';
      end if;
      v_reason := v_reason || ' (ปิดข้ามขั้น: ' || v_note || ')';
    end if;
  elsif p_status = 'cancelled' then
    if not public.can_review_incident() then
      raise exception 'ยกเลิก Incident Case ได้เฉพาะ QA/ผู้บริหาร';
    end if;
    if v_note is null then raise exception 'การยกเลิกต้องระบุเหตุผล'; end if;
    v_reason := v_reason || ' (' || v_note || ')';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', v_reason, true);

  update public.deviations
     set status     = coalesce(p_status, status),
         capa       = v_capa,
         due_date   = coalesce(p_due_date, due_date),
         severity   = coalesce(p_severity, severity),
         closed_by  = case when p_status = 'closed'     then v_profile
                           when v_cur.status = 'closed' then null   -- เปิดใหม่หลังปิด
                           else closed_by end,
         closed_at  = case when p_status = 'closed'     then now()
                           when v_cur.status = 'closed' then null
                           else closed_at end,
         updated_by = v_profile
   where id = p_id;

  if v_note is not null and p_status in ('closed', 'cancelled') then
    insert into public.deviation_comments (deviation_id, role_group, body, created_by)
    values (p_id, coalesce(public.current_role_group(), 'qa'),
            case when p_status = 'closed' then '🔒 QA ปิดเคส: ' else '🚫 QA ยกเลิกเคส: ' end || v_note,
            v_profile);
  end if;
end;
$fn$;

-- signature เดิม (5 พารามิเตอร์) จาก 0067 ต้องทิ้ง ไม่งั้น PostgREST เจอ 2 ตัวแล้วเลือกไม่ถูก
drop function if exists public.update_deviation(
  uuid, incident_status, text, deviation_severity, date);

revoke execute on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date, text) from public;
revoke execute on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date, text) from anon;
grant  execute on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date, text) to authenticated;

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้)
-- ------------------------------------------------------------
-- select unnest(enum_range(null::incident_case_type));            -- dev, oos, nc
-- select to_regclass('public.deviation_departments');             -- ต้องไม่ใช่ null
--
-- -- ไม่มี overload ซ้อน (ต้องได้ตัวละ 1 แถว — โดยเฉพาะ update_deviation)
-- select proname, count(*) from pg_proc
--  where proname in ('qa_review_deviation','submit_deviation_resolution','update_deviation')
--  group by proname;
--
-- -- trigger ครบ 2 ตัว
-- select tgname from pg_trigger
--  where tgrelid = 'public.deviation_departments'::regclass and not tgisinternal;
--
-- -- อยู่ใน realtime publication แล้ว (ต้องได้ 1 แถว)
-- select tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' and tablename = 'deviation_departments';
--
-- -- anon เรียกไม่ได้ (ต้องได้ false ทุกแถว)
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('qa_review_deviation','submit_deviation_resolution','update_deviation');
-- ============================================================
