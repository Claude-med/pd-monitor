-- ============================================================
-- PD Monitor — Part D ก้อน 4 / 0073_edit_approver_qc_lead.sql
--   (1) review_edit_request — หัวหน้า QC (qc_lead) อนุมัติคำขอแก้ผลตรวจ in-process ได้
--   (2) request_edit        — แจ้งเตือน qc_lead ด้วย
--   (3) qa_samples          — ลบคอลัมน์ sample_point ("จุด/รอบ") ที่เลิกใช้แล้ว
-- รัน "หลัง" 0072 · ไม่มี drop function (ทั้ง 2 ตัว signature เดิม)
--
-- 🐞 บั๊กที่ปิดในไฟล์นี้: "กดขอแก้ไข → ขึ้น *รออนุมัติแก้ไข* แต่ไม่มีปุ่มให้กดอนุมัติ"
--    ยื่นได้ = qc / qc_lead / manager · อนุมัติได้ = manager / qa เท่านั้น
--    หัวหน้า QC ไม่เห็นแม้แต่เมนู "คำขอแก้ไข" → คำขอค้างไม่มีทางออก
-- ============================================================

-- ------------------------------------------------------------
-- (1) request_edit — บอดี้เดิม 0065:94-178 + แจ้งเตือน qc_lead
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

  return v_id;
end;
$fn$;

revoke execute on function public.request_edit(edit_target_type, uuid, jsonb, text) from public;
revoke execute on function public.request_edit(edit_target_type, uuid, jsonb, text) from anon;
grant  execute on function public.request_edit(edit_target_type, uuid, jsonb, text) to authenticated;

comment on function public.request_edit(edit_target_type, uuid, jsonb, text) is
  'ยื่นคำขอแก้ไขย้อนหลัง — Part D (0073) แจ้งเตือนหัวหน้า QC ด้วยสำหรับคำขอของ in-process';

-- ------------------------------------------------------------
-- (2) review_edit_request — บอดี้เดิม 0065:189-298 + qc_lead อนุมัติ in-process ได้
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
  if not (public.has_role('manager')
          or (v_req.target_type = 'inprocess_check'
              and (public.has_role('qa') or public.has_role('qc_lead')))) then
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
  'อนุมัติ/ปฏิเสธคำขอแก้ไข — Part D (0073): หัวหน้า QC อนุมัติได้เฉพาะคำขอของ inprocess_check';

-- ------------------------------------------------------------
-- (3) qa_samples.sample_point — ลบทิ้งตามที่ทีมสั่ง
--
--     ตรวจแล้วไม่มี index / constraint / view / RLS ใดอ้างถึงคอลัมน์นี้
--     (ข้อจำกัดเดียวคือ not null ซึ่งปลดไปแล้วที่ 0066:35 · RPC ปัจจุบันไม่แตะคอลัมน์นี้เลย)
--
--     ✅ ประวัติไม่หาย — trigger log_audit() เก็บทั้งแถวเป็น jsonb ลง audit_log
--        ตั้งแต่ตอน INSERT/UPDATE อยู่แล้ว (0002_audit_log.sql:52-58)
--        ค่าเดิมของแถวเก่าย้อนดูได้จาก:
--          select record_id, new_data->>'sample_point', changed_at
--            from public.audit_log
--           where table_name = 'qa_samples' and new_data ? 'sample_point';
-- ------------------------------------------------------------
alter table public.qa_samples drop column if exists sample_point;

-- ============================================================
-- ✅ ตรวจหลังรัน (paste แยกใน SQL Editor)
--
--   -- 1) คอลัมน์ต้องหายไปแล้ว (ควรได้ 0 แถว)
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'qa_samples'
--      and column_name = 'sample_point';
--
--   -- 2) ประวัติของแถวเก่ายังอยู่ครบ (ควรได้ > 0 ถ้าเคยบันทึกจุด/รอบไว้)
--   select count(*) from public.audit_log
--    where table_name = 'qa_samples' and new_data ? 'sample_point';
--
--   -- 3) หัวหน้า QC ต้องมีตัวตนจริงในระบบ ไม่งั้นแก้แล้วก็ยังไม่มีใครอนุมัติได้
--   select p.full_name, p.email from public.user_roles ur
--     join public.profiles p on p.id = ur.profile_id
--    where ur.role = 'qc_lead';
-- ============================================================
