-- ============================================================
-- PD Monitor — 0083_prod_lead_edit_approval.sql
--   (1) request_edit        — แจ้งเตือน "หัวหน้าฝ่ายผลิต" เมื่อมีคำขอแก้ไขบันทึกผลผลิต
--   (2) review_edit_request — หัวหน้าฝ่ายผลิต (production_lead) อนุมัติคำขอชนิด production_record ได้
--   (3) reset_production_record_approval — แถวที่ "ไม่อนุมัติ" ก็ต้องเด้งกลับ "รออนุมัติ" ด้วย
-- รัน "หลัง" 0080 · ไม่มี enum ใหม่ / ไม่เปลี่ยน signature → paste รอบเดียวจบ รันซ้ำได้ปลอดภัย
--
-- 🐞 บั๊กที่ปิดในไฟล์นี้ (อาการเดียวกับที่ 0073 ปิดให้หัวหน้า QC ไปเป๊ะ ๆ):
--    0080 กำหนดให้ can_approve_production_record() = production_lead / manager
--    ⇒ หัวหน้าฝ่ายผลิตคือผู้อนุมัติบันทึกผลผลิตตัวจริง
--    แต่ review_edit_request (0073:151-155) ยังให้อนุมัติคำขอแก้ไขได้แค่ manager
--    ⇒ พนักงานยื่นคำขอแก้ยอดผลิต แล้วคนที่ดูแลงานนั้นกดอนุมัติไม่ได้ ต้องรอผู้บริหารอย่างเดียว
--    ซ้ำร้าย request_edit ส่งแจ้งเตือนหา manager อย่างเดียว หัวหน้าจึงไม่รู้ด้วยซ้ำว่ามีคำขอเข้ามา
--
-- 🚨 ทั้ง 2 ฟังก์ชันถูก create or replace ทับกันมาแล้ว 9 รอบ
--    (0033 → 0034 → 0036 → 0037 → 0057 → 0059 → 0063 → 0065 → 0073)
--    ไฟล์นี้ยกบอดี้ล่าสุดจาก 0073 มา "ทั้งก้อน" แล้วแก้เฉพาะจุดที่ระบุ — ห้ามเขียนใหม่จากศูนย์
-- ============================================================

-- ------------------------------------------------------------
-- (1) request_edit — บอดี้เดิม 0073:16-106 + แจ้งเตือน production_lead
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
    perform public.create_notification(
      'edit_request',
      'คำขอแก้ไขผลตรวจ QC — งาน ' || coalesce(v_job_no, ''),
      v_reason, v_job, v_job_no, 'qa'::app_role, null::job_status);
    -- Part D: หัวหน้า QC อนุมัติคำขอนี้ได้แล้ว → ต้องได้รับแจ้งเตือนด้วย
    -- (เดิมส่งแค่ manager + qa ทั้งที่คนยื่นคือ QC/หัวหน้า QC เอง)
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
  'ยื่นคำขอแก้ไขย้อนหลัง — 0083: แจ้งเตือนหัวหน้าฝ่ายผลิตสำหรับคำขอบันทึกผลผลิต · หัวหน้า QC สำหรับคำขอ in-process';

-- ------------------------------------------------------------
-- (2) review_edit_request — บอดี้เดิม 0073:118-234 + production_lead อนุมัติ production_record ได้
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
  --   0083 — เพิ่ม production_lead (หัวหน้าฝ่ายผลิต) สำหรับคำขอชนิด production_record
  --   ⚠️ ให้อนุมัติได้เฉพาะ production_record เท่านั้น — คำขอผลตรวจ QC ยังเป็นของ qa/qc_lead
  --   ℹ️ has_role('production_lead') เป็นจริงเฉพาะผู้ถือ role นั้นจริง + admin
  --      (สืบทอดทางเดียว lead → base เท่านั้น · 0078:50-68) ⇒ พนักงานฝ่ายผลิตยังอนุมัติไม่ได้
  if not (public.has_role('manager')
          or (v_req.target_type = 'inprocess_check'
              and (public.has_role('qa') or public.has_role('qc_lead')))
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
    perform public.create_notification(
      'edit_reviewed', 'คำขอแก้ไขถูกปฏิเสธ',
      coalesce(v_note, 'ไม่ระบุเหตุผล'), v_req.job_id, v_job_no, null::app_role, null::job_status);
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
    'ข้อมูลถูกแก้ไขตามคำขอแล้ว', v_req.job_id, v_job_no, null::app_role, null::job_status);
end;
$fn$;

revoke execute on function public.review_edit_request(uuid, text, text) from public;
revoke execute on function public.review_edit_request(uuid, text, text) from anon;
grant  execute on function public.review_edit_request(uuid, text, text) to authenticated;

comment on function public.review_edit_request(uuid, text, text) is
  'อนุมัติ/ปฏิเสธคำขอแก้ไข — 0083: หัวหน้าฝ่ายผลิตอนุมัติได้เฉพาะ production_record · หัวหน้า QC เฉพาะ inprocess_check';

-- ------------------------------------------------------------
-- (3) reset_production_record_approval — บอดี้เดิม 0080:233-261 แก้ 2 จุด
--
--     🐞 ช่องที่ปิด: ของเดิมรีเซ็ตเฉพาะแถวที่สถานะเป็น 'approved'
--        เส้นทางจริงที่ผู้ใช้เจอคือ:
--          หัวหน้ากด "ไม่อนุมัติ" (rejected) → พนักงานยื่นคำขอแก้ตัวเลข → คำขอถูกอนุมัติ
--          → ตัวเลขเปลี่ยนแล้ว แต่สถานะยังค้าง 'rejected'
--        และ review_production_record (0080:122-124) บังคับว่าต้องเป็น 'pending' เท่านั้น
--        ⇒ แถวนั้นกดอนุมัติใหม่ไม่ได้อีกเลยตลอดกาล
--
--     แก้ 2 จุด:
--       1. old.status = 'approved'  →  old.status in ('approved', 'rejected')
--       2. เฝ้าหน่วยด้วย (input_unit / output_unit / loss_unit) — แก้ kg→g เปลี่ยนความหมายทั้งใบ
--          แต่ของเดิมไม่รีเซ็ตการอนุมัติ
--
--     คงเงื่อนไข new.status = old.status ไว้เหมือนเดิม ⇒ ตอน review_production_record
--     ตั้งสถานะเองอยู่แล้ว trigger นี้จะไม่เข้าไปยุ่ง
-- ------------------------------------------------------------
create or replace function public.reset_production_record_approval()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if old.status in ('approved', 'rejected')
     and new.status = old.status
     and (
          new.input_qty   is distinct from old.input_qty
       or new.output_qty  is distinct from old.output_qty
       or new.loss_qty    is distinct from old.loss_qty
       or new.minutes     is distinct from old.minutes
       or new.headcount   is distinct from old.headcount
       or new.record_date is distinct from old.record_date
       or new.shift       is distinct from old.shift
       or new.work_period is distinct from old.work_period
       or new.station_id  is distinct from old.station_id
       or new.machine_id  is distinct from old.machine_id
       or new.input_unit  is distinct from old.input_unit
       or new.output_unit is distinct from old.output_unit
       or new.loss_unit   is distinct from old.loss_unit
     )
  then
    new.status       := 'pending';
    new.approved_by  := null;
    new.approved_at  := null;
    new.approve_note := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_reset_prod_approval on public.production_records;
create trigger trg_reset_prod_approval
  before update on public.production_records
  for each row execute function public.reset_production_record_approval();

comment on function public.reset_production_record_approval() is
  'แก้ตัวเลข/หน่วยของบันทึกที่หัวหน้าตัดสินไปแล้ว (อนุมัติ หรือ ไม่อนุมัติ) → เด้งกลับ "รออนุมัติ" และล้างลายเซ็นเดิม';

-- ============================================================
-- ✅ ตรวจหลัง paste (รันแยกใน SQL Editor)
--
--   -- 1) หัวหน้าฝ่ายผลิตอยู่ในเงื่อนไขอนุมัติแล้ว (ต้องได้ true ทั้งคู่)
--   select position('production_lead' in prosrc) > 0 from pg_proc where proname = 'review_edit_request';
--   select position('production_lead' in prosrc) > 0 from pg_proc where proname = 'request_edit';
--
--   -- 2) trigger รีเซ็ตครอบ 'rejected' แล้ว (ต้องได้ true)
--   select position('rejected' in prosrc) > 0 from pg_proc where proname = 'reset_production_record_approval';
--
--   -- 3) ต้องมีหัวหน้าฝ่ายผลิตตัวจริงในระบบ ไม่งั้นแก้แล้วก็ยังไม่มีใครอนุมัติได้
--   select p.full_name, p.email from public.user_roles ur
--     join public.profiles p on p.id = ur.profile_id
--    where ur.role = 'production_lead';
-- ============================================================
