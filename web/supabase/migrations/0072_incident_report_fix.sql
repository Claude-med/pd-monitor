-- ============================================================
-- PD Monitor — Part D ก้อน 3 / 0072_incident_report_fix.sql
-- Incident Case — ซ่อมบั๊กถอดแผนก + ป้ายฝ่ายนับตาม role สูงสุด
--   (1) current_role_badge() — ฟังก์ชันใหม่ "ป้ายที่โชว์" แยกจาก "ฝ่ายที่ใช้จับคู่แผนก"
--   (2) add_deviation_comment      — ใช้ป้ายใหม่
--   (3) qa_review_deviation        — 🐞 นับแผนกที่ค้างใหม่หลังถอด แล้วเลื่อนเป็น qa_verify เอง
--   (4) submit_deviation_resolution— ใช้ป้ายใหม่ (การจับคู่แผนกยังใช้ current_role_group เหมือนเดิม)
--   (5) update_deviation           — ใช้ป้ายใหม่
-- รัน "หลัง" 0071 · ไม่มี drop function (ทุกตัว signature เดิม)
--
-- 🚨 ห้ามแตะ current_role_group()
--    ตัวนั้นคือ "ฝ่ายของผู้ใช้" ที่ submit_deviation_resolution ใช้ join กับ deviation_departments
--    ถ้าเปลี่ยนลำดับให้ manager มาก่อน คน QC ที่มี role admin ด้วยจะกลายเป็น 'manager'
--    แล้ว "ส่งผลแก้ไขแทนแผนก QC" ไม่ได้เลย
-- ============================================================

-- ------------------------------------------------------------
-- (1) current_role_badge — ป้ายฝ่ายที่แสดงบนหมายเหตุ/ประวัติของเคส
--     ต่างจาก current_role_group() ตรงที่ **ผู้บริหาร/admin มาก่อน**
--     ตามที่ทีมขอ: บัญชีที่มีทั้ง Admin และหัวหน้าฝ่าย QA ต้องขึ้นป้าย "ผู้บริหาร"
-- ------------------------------------------------------------
create or replace function public.current_role_badge()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_profile_id() is null      then null
    when public.has_exact_role('admin')           then 'manager'
    when public.has_exact_role('manager')         then 'manager'
    when public.has_exact_role('qa')              then 'qa'
    when public.has_exact_role('qc_lead')         then 'qc'
    when public.has_exact_role('qc')              then 'qc'
    when public.has_exact_role('production_lead') then 'production'
    when public.has_exact_role('production')      then 'production'
    when public.has_exact_role('engineering')     then 'engineering'
    when public.has_exact_role('warehouse')       then 'warehouse'
    when public.has_exact_role('planner')         then 'planner'
    when public.has_exact_role('cost')            then 'cost'
    else 'other'
  end;
$$;

revoke execute on function public.current_role_badge() from public;
revoke execute on function public.current_role_badge() from anon;
grant  execute on function public.current_role_badge() to authenticated;

comment on function public.current_role_badge() is
  'ป้ายฝ่ายที่โชว์บนหมายเหตุ Incident Case — นับ role สูงสุด (ผู้บริหาร/admin มาก่อน) · Part D (0072) · '
  'ห้ามใช้แทน current_role_group() ที่ใช้จับคู่ deviation_departments';

-- ------------------------------------------------------------
-- (2) add_deviation_comment — เปลี่ยนป้ายเป็น current_role_badge()
--     บอดี้เดิม 0030:61-92 · signature เดิม ไม่ต้อง drop
-- ------------------------------------------------------------
create or replace function public.add_deviation_comment(
  p_deviation_id uuid,
  p_body         text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_badge   text;
  v_body    text;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  v_badge := public.current_role_badge();
  if v_badge is null then raise exception 'สิทธิ์ของคุณเพิ่มหมายเหตุ Incident Case ไม่ได้'; end if;

  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is null then raise exception 'กรุณาพิมพ์หมายเหตุ'; end if;
  if not exists (select 1 from public.deviations where id = p_deviation_id) then
    raise exception 'ไม่พบ Incident Case';
  end if;

  insert into public.deviation_comments (deviation_id, role_group, body, created_by)
  values (p_deviation_id, v_badge, v_body, v_profile)
  returning id into v_id;
  return v_id;
end;
$fn$;

grant execute on function public.add_deviation_comment(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- (3) qa_review_deviation — บอดี้เดิม 0068:103-227 + ซ่อมบั๊กถอดแผนก + ป้ายใหม่
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
  v_left    integer;
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
    values (p_id, public.current_role_badge(), '🚫 QA ยกเลิกเคส: ' || v_note, v_profile);
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

  -- 🐞 Part D — เดิมบรรทัดนี้ตั้ง status = 'in_progress' ตรงๆ ทุกครั้ง
  --    ถ้า QA เพิ่งถอดแผนกที่ยังไม่ตอบออก แล้วแผนกที่เหลือตอบครบไปแล้ว
  --    เคสจะถูกดันกลับมาค้างที่ "ส่งแผนกแก้ไข" ตลอดกาล → กดปิดทีไรก็โดนด่าน
  --    "ปิดข้ามขั้นต้องระบุเหตุผล" ทั้งที่ไม่มีแผนกไหนค้างจริง
  --    ต้องนับใหม่หลังถอด/เพิ่มแผนกเสร็จ แล้วเลื่อนขั้นเองถ้าครบ
  select count(*) filter (where responded_at is null)
    into v_left
    from public.deviation_departments where deviation_id = p_id;

  update public.deviations
     -- 🚨 cast ผลของ CASE ทั้งก้อน — ทุกแขนเป็น literal จะได้ text แล้วชน enum (บทเรียน 0055/0064)
     set status         = (case when v_left = 0 then 'qa_verify'
                                else 'in_progress' end)::incident_status,
         case_type      = p_case_type,
         case_no        = v_no,
         due_date       = coalesce(p_due_date, due_date),
         qa_reviewed_by = v_profile,
         qa_reviewed_at = now(),
         updated_by     = v_profile
   where id = p_id;

  insert into public.deviation_comments (deviation_id, role_group, body, created_by)
  values (p_id, public.current_role_badge(),
          '🔎 QA ตรวจสอบแล้ว — ' || v_label
            || case when v_left = 0
                    then ' · ทุกแผนกที่เหลือตอบครบแล้ว → รอ QA อนุมัติ'
                    else ' · ส่งให้แผนกที่เกี่ยวข้องดำเนินการ' end
            || case when v_note is not null then ': ' || v_note else '' end,
          v_profile);

  -- ถอดแผนกที่ค้างออกจนครบพอดี → ไม่มีใครให้แจ้ง แต่ QA ต้องรู้ว่าถึงคิวอนุมัติแล้ว
  if v_left = 0 then
    perform public.create_notification(
      'deviation',
      'Incident Case ' || v_label || ' — งาน ' || coalesce(v_job_no, '')
        || ' ทุกแผนกตอบครบแล้ว รอ QA อนุมัติ',
      v_dev.title, v_dev.job_id, v_job_no, 'qa'::app_role, null::job_status);
    return;
  end if;

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
  'ขั้น QA ตรวจสอบ Incident Case — Part D (0072): ถอดแผนกแล้วนับใหม่ ถ้าไม่เหลือแผนกค้างจะเลื่อนเป็น qa_verify เอง';

-- ------------------------------------------------------------
-- (4) submit_deviation_resolution — บอดี้เดิม 0068:245-332 + ป้ายใหม่
--     ⚠️ การ join หาแผนกยังใช้ current_role_group() เหมือนเดิม (ห้ามเปลี่ยน)
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
  'แผนกที่รับผิดชอบบันทึกผลดำเนินการ — ครบทุกแผนกแล้วเคสเข้าสถานะ "รอ QA อนุมัติ" เอง · Part D (0072) ป้ายใช้ role สูงสุด';

-- ------------------------------------------------------------
-- (5) update_deviation — บอดี้เดิม 0068:346-422 + ป้ายใหม่
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
    values (p_id, coalesce(public.current_role_badge(), 'qa'),
            case when p_status = 'closed' then '🔒 QA ปิดเคส: ' else '🚫 QA ยกเลิกเคส: ' end || v_note,
            v_profile);
  end if;
end;
$fn$;

revoke execute on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date, text) from public;
revoke execute on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date, text) from anon;
grant  execute on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date, text) to authenticated;

comment on function public.update_deviation(
  uuid, incident_status, text, deviation_severity, date, text) is
  'อัปเดต/ปิด/ยกเลิก Incident Case — Part D (0072) ป้ายหมายเหตุใช้ role สูงสุด';

-- ============================================================
-- ✅ ตรวจหลังรัน (paste แยกใน SQL Editor)
--
--   -- 1) ต้องมีทั้ง 2 ฟังก์ชัน และ current_role_group ต้องยังอยู่ (ห้ามหาย)
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('current_role_badge','current_role_group');
--
--   -- 2) ลำดับใน badge ต้องมี admin/manager มาก่อน qa
--   select pg_get_functiondef('public.current_role_badge()'::regprocedure);
--
--   -- 3) เคสที่แผนกตอบครบแล้วแต่ยังค้าง in_progress (บั๊กเดิม) — ควรได้ 0 แถวหลังผู้ใช้กดแก้ไขการมอบหมายอีกรอบ
--   select d.id, d.case_no, d.status,
--          count(*) filter (where dd.responded_at is null) as pending_depts
--     from public.deviations d
--     join public.deviation_departments dd on dd.deviation_id = d.id
--    where d.status = 'in_progress'
--    group by d.id, d.case_no, d.status
--   having count(*) filter (where dd.responded_at is null) = 0;
-- ============================================================
