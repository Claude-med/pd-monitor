-- ============================================================
-- PD Monitor — Part C.4 แก้ไขเพิ่มเติม / 0074_incident_reject.sql
-- Incident Case: บังคับ "การแก้ไขเบื้องต้น" + QA ตีกลับให้แผนกแก้ไขใหม่
--   (1) qa_reject_resolution — QA ตรวจแล้วไม่ผ่าน → ส่งกลับ + เคลียร์ตัวนับแผนก
--   (2) submit_deviation_resolution — บังคับกรอกผลแก้ไข + ต่อท้ายลง capa
--   (3) update_deviation — ถอยสถานะ qa_verify → in_progress ให้ delegate ไป (1)
-- รัน "หลัง" 0073
--
-- 🐞 บั๊กที่ปิดรอบนี้: ระบบไม่มีเส้นทาง "QA ไม่ผ่าน" เลย
--    qa_review_deviation รับแค่ assign/cancel · ทางเดียวที่ QA ถอยสถานะได้คือ
--    dropdown ใน UpdateForm ซึ่งเรียก update_deviation ที่ไม่แตะ deviation_departments
--    → responded_at ค้าง → ปุ่ม "รายงานผลแก้ไข" ไม่โผล่ และ RPC ก็ raise
--    → เคสวนกลับมาแก้ไม่ได้อีกเลย (ล็อกตาย)
--
-- ℹ️ signature ทั้ง 3 ตัวไม่เปลี่ยน → ไม่ต้อง drop function ก่อน (ไม่มี PGRST203)
-- ℹ️ ชื่อฝั่ง DB ยังเป็น "deviation" ทั้งหมดโดยตั้งใจ (เหตุผลอยู่ 0067:21-24)
-- ============================================================

-- ------------------------------------------------------------
-- (1) qa_reject_resolution — QA ตรวจผลแก้ไขแล้วไม่ผ่าน
--     สถานะ qa_verify → in_progress · ทุกแผนกกลับเป็น "รอการแก้ไข" (2/2 → 0/2)
--     เหตุผลที่ส่งกลับ = ไม่บังคับ (ตามที่ทีมขอ)
-- ------------------------------------------------------------
create or replace function public.qa_reject_resolution(
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
  v_dev     public.deviations%rowtype;
  v_job_no  text;
  v_note    text;
  v_label   text;
  v_total   integer;
  v_dept    app_role;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_review_incident() then
    raise exception 'ส่งกลับให้แผนกแก้ไขได้เฉพาะ QA/ผู้บริหาร';
  end if;

  select * into v_dev from public.deviations where id = p_id for update;
  if v_dev.id is null then raise exception 'ไม่พบ Incident Case'; end if;
  if v_dev.status <> 'qa_verify' then
    raise exception 'ส่งกลับให้แผนกแก้ไขได้เฉพาะเคสที่รอ QA อนุมัติ (สถานะตอนนี้: %)', v_dev.status;
  end if;

  select count(*) into v_total
    from public.deviation_departments where deviation_id = p_id;
  -- เคสเก่าก่อน 0068 ที่ถูกแปลงเป็น qa_verify อาจไม่มีแผนกเลย — ตีกลับไม่ได้
  -- (qa_review_deviation ก็รับเฉพาะ qa_review/in_progress จึงมอบหมายย้อนหลังไม่ได้ด้วย)
  if v_total = 0 then
    raise exception 'เคสนี้ไม่มีแผนกที่รับผิดชอบ (เคสเก่าก่อนระบบมอบหมายแผนก) — ส่งกลับไม่ได้ ใช้หมายเหตุแจ้งหรือปิดเคสแทน';
  end if;

  v_note  := nullif(btrim(coalesce(p_note, '')), '');
  -- เคสเก่าอาจไม่มี case_type/case_no (เพิ่มตอน 0068) → อย่าให้ concat กลายเป็น null ทั้งก้อน
  v_label := case
               when v_dev.case_type is not null
                    and coalesce(btrim(v_dev.case_no), '') <> ''
                 then upper(v_dev.case_type::text) || ' No. ' || v_dev.case_no
               else 'ไม่มีเลขที่'
             end;
  select job_no into v_job_no from public.jobs where id = v_dev.job_id;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'QA ตรวจแล้วไม่ผ่าน — ส่งกลับให้แผนกแก้ไข'
      || case when v_note is not null then ': ' || v_note else '' end, true);

  -- เคลียร์ "ตอบแล้ว" ของทุกแผนกกลับไปเป็นรอการแก้ไข — แก่นของ requirement รอบนี้
  -- ไม่ลบแถว จำนวนแผนกจึงเท่าเดิม (0/1 · 0/2 ตามที่มอบหมายไว้ตอนนั้น)
  -- ค่าเดิมถูกเก็บไว้ครบใน audit_log โดย trigger log_audit (0068:79-86)
  update public.deviation_departments
     set responded_by  = null,
         responded_at  = null,
         response_note = null,
         updated_by    = v_profile
   where deviation_id = p_id;

  -- ถอยสถานะ + ล้างร่องรอยของรอบที่แล้ว
  -- (ถ้าไม่ล้าง resolution_submitted_at แบนเนอร์ "แจ้งแก้ไขเรียบร้อยแล้ว" จะค้างบนการ์ด)
  -- 🚨 ไม่แตะ capa — เป็นประวัติการแก้ไขของรอบก่อน · QA แก้เองได้ในฟอร์ม
  update public.deviations
     set status                  = 'in_progress',
         resolution_note         = null,
         resolution_submitted_by = null,
         resolution_submitted_at = null,
         updated_by              = v_profile
   where id = p_id;

  insert into public.deviation_comments (deviation_id, role_group, body, created_by)
  values (p_id, public.current_role_badge(),
          '↩️ QA ตรวจแล้วไม่ผ่าน — ส่งกลับให้แผนกแก้ไข'
            || case when v_note is not null then ': ' || v_note else '' end,
          v_profile);

  -- แจ้งทุกแผนกที่รับผิดชอบ (ตอนนี้ทุกแถวถูกเคลียร์แล้ว = ยังไม่ตอบทั้งหมด)
  for v_dept in
    select role_group from public.deviation_departments where deviation_id = p_id
  loop
    perform public.create_notification(
      'deviation',
      'Incident Case ' || v_label || ' — งาน ' || coalesce(v_job_no, '')
        || ' QA ตีกลับ ให้ฝ่ายคุณแก้ไขอีกครั้ง',
      coalesce(v_note, v_dev.title), v_dev.job_id, v_job_no, v_dept, null::job_status);
  end loop;
end;
$fn$;

revoke execute on function public.qa_reject_resolution(uuid, text) from public;
revoke execute on function public.qa_reject_resolution(uuid, text) from anon;
grant  execute on function public.qa_reject_resolution(uuid, text) to authenticated;

comment on function public.qa_reject_resolution(uuid, text) is
  'QA ตรวจผลแก้ไขแล้วไม่ผ่าน — ถอยเคสกลับ "ส่งแผนกแก้ไข" และล้าง responded_at ของทุกแผนก (Part C.4 เพิ่มเติม · 0074)';

-- ------------------------------------------------------------
-- (2) submit_deviation_resolution — บอดี้เดิม 0072:262-350
--     + บังคับ "การแก้ไขเบื้องต้น" + ต่อท้ายลง deviations.capa
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
  'แผนกที่รับผิดชอบบันทึกผลดำเนินการ — บังคับกรอกและต่อท้ายลง capa (Part C.4 เพิ่มเติม · 0074) · ครบทุกแผนกแล้วเคสเข้า "รอ QA อนุมัติ" เอง';

-- ------------------------------------------------------------
-- (3) update_deviation — บอดี้เดิม 0072:362-438
--     + delegate การถอยสถานะ qa_verify → in_progress ไปที่ (1)
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

  -- Part C.4 เพิ่มเติม — QA ถอย "รอ QA อนุมัติ" กลับ "ส่งแผนกแก้ไข" = การตีกลับ
  -- ของเดิมแตะแต่ตาราง deviations → responded_at ของทุกแผนกยังค้าง
  -- ทำให้แผนกส่งซ้ำไม่ได้ทั้งฝั่ง UI (canRespond) และฝั่ง DB (and responded_at is null)
  -- → เคสล็อกตาย · บังคับให้เดินผ่านตัวเดียวกับปุ่ม "ไม่ผ่าน" เสมอ
  if p_status = 'in_progress' and v_cur.status = 'qa_verify' then
    perform public.qa_reject_resolution(p_id, p_note);
    return;
  end if;

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
  'อัปเดต/ปิด/ยกเลิก Incident Case — Part C.4 เพิ่มเติม (0074): ถอยจาก "รอ QA อนุมัติ" กลับ "ส่งแผนกแก้ไข" จะเรียก qa_reject_resolution ให้เอง';

-- ============================================================
-- ✅ ตรวจหลังรัน (paste แยกใน SQL Editor)
--
--   -- 1) ต้องมีครบ 3 ฟังก์ชัน และห้ามมี overload ซ้อน (นับ 1 แถวต่อชื่อ)
--   select p.proname, count(*) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('qa_reject_resolution','submit_deviation_resolution','update_deviation')
--    group by p.proname;
--
--   -- 2) ตัวใหม่ต้องไม่ให้ anon เรียก
--   select proname, proacl from pg_proc where proname = 'qa_reject_resolution';
--
--   -- 3) เคสที่แผนกตอบครบแล้วแต่ยังค้าง in_progress — ควรได้ 0 แถวเสมอ
--   select d.id, d.case_no, d.status,
--          count(*) filter (where dd.responded_at is null) as pending_depts
--     from public.deviations d
--     join public.deviation_departments dd on dd.deviation_id = d.id
--    where d.status = 'in_progress'
--    group by d.id, d.case_no, d.status
--   having count(*) filter (where dd.responded_at is null) = 0;
-- ============================================================
