-- ============================================================
-- PD Monitor — Part H / 0099_qa_sample_amendment.sql  (ก้อน 1 · ไฟล์ที่ 2/2)
--   จุดเก็บตัวอย่าง (ตรวจ Finished product) ใช้ระบบคำขอแก้ไข (Amendment) ตัวเดียวกับ in-process QC
--
-- 🐞 ปัญหาจากทีม (25 ก.ย. 69)
--   · ลูกน้อง QA กด "แก้ไข" แล้ว update_qa_sample (0096:242) เขียนทับค่าในแถวทันที
--     → หัวหน้ายังไม่อนุมัติแต่ค่าเปลี่ยนแล้ว (ขอแก้ 20 → 25 · ไม่อนุมัติ ค่าก็ยังเป็น 25)
--   · ไม่ลงตาราง edit_requests → ไม่ขึ้นแท็บ "คำขอแก้ไข (Amendment)" และไม่ขึ้นประวัติในหน้างาน
--
-- 🔑 กติกาใหม่ (ผู้ใช้เลือก)
--   · แถวที่ "ยังไม่เคยอนุมัติ" (review_status = pending) = ร่างของลูกน้อง → แก้ตรงได้เหมือนเดิม
--   · แถวที่ "อนุมัติแล้ว" → ลูกน้องต้องยื่นคำขอ (request_edit 'qa_sample') · ค่าเดิมคงอยู่จนหัวหน้า QA อนุมัติ
--   · หัวหน้า QA (has_role('qa_lead') = หัวหน้า QA ตัวจริง + admin) แก้ตรงได้ และเป็นผู้อนุมัติคำขอชนิดนี้คนเดียว
--     ผู้บริหารไม่ผ่าน — ตรงกับ review_qa_sample (0096:292)
--   · ปฏิเสธคำขอ = ไม่แตะแถวเลย · อนุมัติ = แก้ตามคำขอ + sync Incident ถ้าผลเปลี่ยน
--   · ปล่อยผ่าน FG ไม่ได้ถ้ายังมีคำขอแก้จุดเก็บตัวอย่างค้างอยู่
--
-- 🚨 ยกบอดี้ล่าสุดมา "ทั้งก้อน" (ธรรมเนียมโปรเจค)
--    request_edit ← 0084 · review_edit_request ← 0084 · update_qa_sample ← 0096 · advance_job_status ← 0096
--
-- รัน "หลัง" 0098 (ต้อง Run 0098 ให้จบก่อน) · ไม่เปลี่ยน signature ของ RPC เดิม · รันซ้ำได้
-- ============================================================


-- ------------------------------------------------------------
-- (1) request_edit — ยกบอดี้ 0084 · เพิ่มสาขา qa_sample
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
  v_sample     public.qa_samples%rowtype;
  v_status     job_status;
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
  elsif p_target_type = 'qa_sample' then
    -- Part H (0099): ขอแก้จุดเก็บตัวอย่างที่หัวหน้า QA อนุมัติแล้ว
    if not public.can_record_qa_sample() then
      raise exception 'เฉพาะ QA/ผู้บริหารขอแก้ไขจุดเก็บตัวอย่างได้';
    end if;
    v_allowed := array['qty','unit','result','collected_at','note'];
    select * into v_sample from public.qa_samples where id = p_target_id;
    if v_sample.id is null then raise exception 'ไม่พบรายการที่จะขอแก้ไข'; end if;
    if v_sample.deleted_at is not null then raise exception 'รายการนี้ถูกลบไปแล้ว'; end if;
    if v_sample.review_status <> 'approved' then
      raise exception 'รายการนี้ยังไม่ได้รับอนุมัติ — แก้ไขได้โดยตรง ไม่ต้องยื่นคำขอ';
    end if;
    select status into v_status from public.jobs where id = v_sample.job_id;
    if v_status <> 'qa' then
      raise exception 'ขอแก้ไขจุดเก็บตัวอย่างได้เฉพาะงานที่ยังอยู่สถานะ QA';
    end if;
    -- ตรวจค่าที่ขอให้ถูกรูปแบบตั้งแต่ตอนยื่น (หัวหน้าจะได้ไม่เจอ error ตอนกดอนุมัติ)
    if p_changes ? 'result' and coalesce(p_changes->>'result', '') not in ('pass', 'fail') then
      raise exception 'ผลตรวจต้องเป็น ผ่าน หรือ ไม่ผ่าน';
    end if;
    if p_changes ? 'qty' and nullif(p_changes->>'qty', '') is not null
       and (p_changes->>'qty')::numeric < 0 then
      raise exception 'จำนวนตัวอย่างห้ามติดลบ';
    end if;
    if p_changes ? 'collected_at' then
      if nullif(p_changes->>'collected_at', '') is null then
        raise exception 'กรุณาระบุวันเวลาที่เก็บตัวอย่าง';
      end if;
      if ((p_changes->>'collected_at')::timestamp at time zone 'Asia/Bangkok') > now() + interval '1 day' then
        raise exception 'วันเวลาที่เก็บตัวอย่างล่วงหน้าเกินไป';
      end if;
    end if;
    v_job := v_sample.job_id;
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

  -- Part H: คำขอชนิด qa_sample ผู้บริหารอนุมัติไม่ได้ → ไม่ต้องแจ้งผู้บริหาร (บทเรียน 0084: แจ้งเฉพาะคนที่กดได้)
  if p_target_type <> 'qa_sample' then
    perform public.create_notification(
      'edit_request',
      'คำขอแก้ไขย้อนหลัง — งาน ' || coalesce(v_job_no, ''),
      v_reason, v_job, v_job_no, 'manager'::app_role, null::job_status);
  end if;
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

  -- Part H: คำขอแก้จุดเก็บตัวอย่าง → หัวหน้า QA (ส่งที่ qa_lead ไม่ใช่ qa — ลูกน้องจะไม่เห็นคำขอของกันและกัน)
  if p_target_type = 'qa_sample' then
    perform public.create_notification(
      'edit_request',
      'คำขอแก้ไขจุดเก็บตัวอย่าง — งาน ' || coalesce(v_job_no, ''),
      v_reason, v_job, v_job_no, 'qa_lead'::app_role, null::job_status);
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.request_edit(edit_target_type, uuid, jsonb, text) from public;
revoke execute on function public.request_edit(edit_target_type, uuid, jsonb, text) from anon;
grant  execute on function public.request_edit(edit_target_type, uuid, jsonb, text) to authenticated;

comment on function public.request_edit(edit_target_type, uuid, jsonb, text) is
  'ยื่นคำขอแก้ไขย้อนหลัง — แจ้งหัวหน้าฝ่ายผลิต (บันทึกผลผลิต) · หัวหน้า QC (in-process) · หัวหน้า QA (จุดเก็บตัวอย่าง · 0099)';


-- ------------------------------------------------------------
-- (2) review_edit_request — ยกบอดี้ 0084 · เพิ่มสิทธิ์ + สาขา apply ของ qa_sample
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
  v_sample  public.qa_samples%rowtype;
  v_status  job_status;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  select * into v_req from public.edit_requests where id = p_id for update;
  if not found then raise exception 'ไม่พบคำขอแก้ไข'; end if;
  if v_req.status <> 'pending' then raise exception 'คำขอนี้ถูกดำเนินการไปแล้ว'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'คำสั่งไม่ถูกต้อง'; end if;

  -- สิทธิ์ (ประวัติ: 0073 เพิ่ม qc_lead · 0083 เพิ่ม production_lead · 0084 ถอด qa)
  --   Part H (0099): qa_sample = หัวหน้า QA เท่านั้น (ผู้บริหารไม่ผ่าน — ตรงกับ review_qa_sample 0096)
  --   ⚠️ ต้องตรงกับ EDIT_REVIEWER_ROLES / EDIT_REVIEWER_TARGETS / canReviewEdit ฝั่งแอปเสมอ
  if v_req.target_type = 'qa_sample' then
    if not public.has_role('qa_lead') then
      raise exception 'เฉพาะหัวหน้า QA อนุมัติคำขอแก้ไขจุดเก็บตัวอย่างได้';
    end if;
  elsif not (public.has_role('manager')
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
    -- ปฏิเสธ = ไม่แตะแถวเป้าหมายเลย (ค่าเดิมคงอยู่)
    perform set_config('app.audit_reason', 'ปฏิเสธคำขอแก้ไข', true);
    update public.edit_requests
       set status = 'rejected', reviewed_by = v_profile, reviewed_at = now(),
           review_note = v_note, updated_by = v_profile
     where id = p_id;
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
    v_reset := (v_req.changes ? 'result' or v_req.changes ? 'value');
    update public.inprocess_checks set
      param      = case when v_req.changes ? 'param'  then nullif(btrim(v_req.changes->>'param'), '') else param  end,
      value      = case when v_req.changes ? 'value'  then nullif(btrim(v_req.changes->>'value'), '') else value  end,
      unit       = case when v_req.changes ? 'unit'   then nullif(btrim(v_req.changes->>'unit'), '')  else unit   end,
      result     = case when v_req.changes ? 'result' then (v_req.changes->>'result')::check_result   else result end,
      note       = case when v_req.changes ? 'note'   then nullif(btrim(v_req.changes->>'note'), '')  else note   end,
      station_id = case when v_req.changes ? 'station_id' then (v_req.changes->>'station_id')::uuid    else station_id end,
      valid_date = case when v_req.changes ? 'valid_date' then nullif(v_req.changes->>'valid_date', '')::date else valid_date end,
      status       = case when v_reset and status = 'approved' then 'pending'::inprocess_status else status end,
      approved_by  = case when v_reset and status = 'approved' then null else approved_by  end,
      approved_at  = case when v_reset and status = 'approved' then null else approved_at  end,
      approve_note = case when v_reset and status = 'approved' then null else approve_note end,
      updated_by = v_profile
    where id = v_req.target_id;

  elsif v_req.target_type = 'qa_sample' then
    -- Part H (0099): ผู้อนุมัติคำขอ = หัวหน้า QA = ผู้ตัดสินผลอยู่แล้ว
    --   ⇒ แถวยังเป็น approved (ไม่เด้งกลับ pending แบบ in-process) · ผลเปลี่ยน → sync Incident
    select * into v_sample from public.qa_samples where id = v_req.target_id for update;
    if v_sample.id is null or v_sample.deleted_at is not null then
      raise exception 'รายการนี้ถูกลบไปแล้ว — กดปฏิเสธเพื่อปิดคำขอแทน';
    end if;
    select status into v_status from public.jobs where id = v_sample.job_id;
    if v_status <> 'qa' then
      raise exception 'งานนี้ไม่ได้อยู่สถานะ QA แล้ว — กดปฏิเสธเพื่อปิดคำขอแทน';
    end if;
    update public.qa_samples set
      qty          = case when v_req.changes ? 'qty'    then nullif(v_req.changes->>'qty', '')::numeric      else qty    end,
      unit         = case when v_req.changes ? 'unit'   then nullif(btrim(v_req.changes->>'unit'), '')        else unit   end,
      result       = case when v_req.changes ? 'result' then (v_req.changes->>'result')::check_result         else result end,
      collected_at = case when v_req.changes ? 'collected_at'
                          then (v_req.changes->>'collected_at')::timestamp at time zone 'Asia/Bangkok'
                          else collected_at end,
      note         = case when v_req.changes ? 'note'   then nullif(btrim(v_req.changes->>'note'), '')        else note   end,
      reviewed_by  = v_profile,
      reviewed_at  = now(),
      updated_by   = v_profile
    where id = v_req.target_id;
    if v_req.changes ? 'result' then
      perform public.qa_sample_sync_incident(v_req.target_id, v_profile, 'แก้ผลตามคำขอแก้ไข: ' || v_req.reason);
    end if;

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


-- ------------------------------------------------------------
-- (3) update_qa_sample — ยกบอดี้ 0096 · ลูกน้องแก้ตรงได้เฉพาะแถวที่ยังไม่อนุมัติ
--     + ห้ามแก้ตรง (ทุกคน) ระหว่างมีคำขอแก้ไขค้าง — ไม่งั้นพออนุมัติคำขอจะทับค่าที่เพิ่งแก้
-- ------------------------------------------------------------
create or replace function public.update_qa_sample(
  p_id           uuid,
  p_qty          numeric      default null,
  p_unit         text         default null,
  p_result       check_result default null,
  p_collected_at timestamptz  default null,
  p_note         text         default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_row     public.qa_samples%rowtype;
  v_status  job_status;
  v_at      timestamptz;
  v_lead    boolean;
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_record_qa_sample() then
    raise exception 'เฉพาะ QA/ผู้บริหารแก้ไขจุดเก็บตัวอย่างได้';
  end if;

  select * into v_row from public.qa_samples where id = p_id for update;
  if v_row.id is null then raise exception 'ไม่พบรายการที่เลือก'; end if;
  if v_row.deleted_at is not null then raise exception 'รายการนี้ถูกลบไปแล้ว'; end if;

  select status, job_no into v_status, v_job_no from public.jobs where id = v_row.job_id;
  if v_status <> 'qa' then
    raise exception 'แก้ไขจุดเก็บตัวอย่างได้เฉพาะงานที่ยังอยู่สถานะ QA';
  end if;

  v_lead := public.has_role('qa_lead');

  -- Part H (0099)
  if not v_lead and v_row.review_status = 'approved' then
    raise exception 'รายการนี้หัวหน้า QA อนุมัติแล้ว — กรุณากด "ขอแก้ไข" เพื่อยื่นคำขอแก้ไขแทน';
  end if;
  if exists (
    select 1 from public.edit_requests
     where target_type = 'qa_sample' and target_id = p_id and status = 'pending'
  ) then
    raise exception 'รายการนี้มีคำขอแก้ไขรออนุมัติอยู่ — อนุมัติหรือปฏิเสธคำขอในแท็บ "คำขอแก้ไข (Amendment)" ก่อน';
  end if;

  if p_qty is not null and p_qty < 0 then raise exception 'จำนวนตัวอย่างห้ามติดลบ'; end if;

  v_at := coalesce(p_collected_at, v_row.collected_at);
  if v_at > now() + interval '1 day' then
    raise exception 'วันเวลาที่เก็บตัวอย่างล่วงหน้าเกินไป';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'แก้ไขจุดเก็บตัวอย่าง (ตรวจ Finished product)', true);

  update public.qa_samples
     set qty           = p_qty,
         unit          = nullif(btrim(coalesce(p_unit, '')), ''),
         result        = p_result,
         collected_at  = v_at,
         note          = nullif(btrim(coalesce(p_note, '')), ''),
         updated_by    = v_profile,
         review_status = case when v_lead then 'approved' else 'pending' end,
         reviewed_by   = case when v_lead then v_profile end,
         reviewed_at   = case when v_lead then now() end
   where id = p_id;

  if v_lead then
    perform public.qa_sample_sync_incident(p_id, v_profile, 'แก้ผลโดยหัวหน้า QA');
  else
    perform public.create_notification(
      'approval_request',
      'จุดเก็บตัวอย่าง งาน ' || coalesce(v_job_no, '') || ' ถูกแก้ไข — รอหัวหน้า QA อนุมัติ',
      'ผลที่เสนอ: ' || case p_result when 'pass' then 'ผ่าน' when 'fail' then 'ไม่ผ่าน' else 'ยังไม่ลงผล' end,
      v_row.job_id, v_job_no, 'qa_lead'::app_role, null::job_status, null::uuid, true);
  end if;
end;
$fn$;

revoke execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from public;
revoke execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) from anon;
grant  execute on function public.update_qa_sample(uuid, numeric, text, check_result, timestamptz, text) to authenticated;


-- ------------------------------------------------------------
-- (4) advance_job_status — ยกบอดี้ 0096 · เพิ่มด่านเดียวที่สาขา qa → finished_goods:
--     ยังมีคำขอแก้ไขจุดเก็บตัวอย่างรอหัวหน้า QA = ปล่อยผ่าน FG ไม่ได้
-- ------------------------------------------------------------
create or replace function public.advance_job_status(
  p_job_id uuid,
  p_to     job_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile   uuid;
  v_from      job_status;
  v_job_no    text;
  v_batch     uuid;
  v_is_reject boolean := false;
  v_allowed   boolean := false;
  v_issues    text[];          -- Part F (0093)
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  select status, job_no, batch_id into v_from, v_job_no, v_batch
    from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from = p_to then
    raise exception 'สถานะไม่เปลี่ยนแปลง';
  end if;

  if    v_from = 'pending_announce' and p_to = 'planned' then
    v_allowed := public.can_plan_jobs();          -- Part A: ฝ่ายวางแผน + ผู้บริหาร
  elsif v_from = 'planned'          and p_to = 'in_production' then
    v_allowed := public.has_role('production')
              or public.has_role('production_lead')
              or public.has_role('manager');
    -- GATE (0049): ต้องกรอกเลขล็อตก่อน — เริ่มผลิตแล้วช่องเลขล็อตจะล็อกทันที
    if v_allowed and v_batch is null then
      raise exception 'เริ่มผลิตไม่ได้ — ต้องกรอก LOT No. (Batch NO.) ของงานนี้ก่อน';
    end if;
    -- Part C.3 ก้อน 4: ถอดด่าน Line Clearance ออกจากตรงนี้
    --   ทีมยืนยันว่าคนกด "เริ่มผลิต" เป็นธุรการ ส่วนคนทำ LC คือพนักงานหน้างานในขั้นกำลังผลิต
    --   ด่าน LC ย้ายไปอยู่ที่ add_production_record (กั้นรายสถานี/เครื่อง) แทน
  elsif v_from = 'in_production'     and p_to = 'qc' then
    -- Part G (0095): หัวหน้าฝ่ายผลิตเท่านั้น (เดิม production/production_lead) · admin ผ่านตาม has_role
    v_allowed := public.has_role('production_lead');
    -- GATE (Part F · 0093) — เข้มขึ้นจากเดิมที่ขอแค่ "in-process ผ่าน ≥1 สถานี" (0034 · 0064:264-284)
    --   ตอนนี้ต้องครบทั้ง 4 ข้อ (R0–R3) · รายละเอียด + ข้อความไทยอยู่ที่ qc_gate_issues()
    --   หน้างานเรียกฟังก์ชันเดียวกันไปโชว์เป็นเช็กลิสต์ ⇒ ข้อความตรงกันเสมอ
    if v_allowed then
      v_issues := public.qc_gate_issues(p_job_id);
      if coalesce(cardinality(v_issues), 0) > 0 then
        raise exception 'ส่ง QC ไม่ได้ — %', array_to_string(v_issues, ' · ');
      end if;
    end if;
  elsif v_from = 'qc'               and p_to = 'qa' then
    -- Part G (0095): ทั้ง "QC ผ่าน" และ "QC ตีกลับ" เป็นของหัวหน้า QC เท่านั้น
    v_allowed := public.has_role('qc_lead');
  elsif v_from = 'qc'               and p_to = 'in_production' then
    v_allowed := public.has_role('qc_lead'); v_is_reject := true;
  elsif v_from = 'qa'               and p_to = 'finished_goods' then
    v_allowed := public.has_role('qa');
    -- GATE: ปล่อยผ่าน FG ไม่ได้ถ้ายังมี deviation เปิดค้าง (B3)
    if v_allowed and public.has_open_deviation(p_job_id) then
      raise exception 'ปล่อยผ่าน FG ไม่ได้ — ยังมี deviation เปิดค้าง ต้องปิด (closed) ก่อน';
    end if;
    -- GATE (Part G · 0096): จุดเก็บตัวอย่างที่ยังรอหัวหน้า QA อนุมัติ = ยังไม่มีคำตัดสิน
    if v_allowed and exists (
      select 1 from public.qa_samples
       where job_id = p_job_id and deleted_at is null and review_status = 'pending'
    ) then
      raise exception 'ปล่อยผ่าน FG ไม่ได้ — ยังมีจุดเก็บตัวอย่างรอหัวหน้า QA อนุมัติ';
    end if;
    -- GATE (Part H · 0099): คำขอแก้ไขจุดเก็บตัวอย่างที่ยังค้าง = ข้อมูลตัวอย่างยังไม่นิ่ง
    if v_allowed and exists (
      select 1 from public.edit_requests
       where job_id = p_job_id and target_type = 'qa_sample' and status = 'pending'
    ) then
      raise exception 'ปล่อยผ่าน FG ไม่ได้ — ยังมีคำขอแก้ไขจุดเก็บตัวอย่างรอหัวหน้า QA อนุมัติ';
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

  -- ---------- แจ้งเตือน ----------
  if v_is_reject then
    perform public.create_notification(
      'reject',
      'งาน ' || v_job_no || ' ถูกตีกลับ',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ไม่ระบุเหตุผล'),
      p_job_id, v_job_no, 'production', 'in_production');
  else
    if    p_to = 'planned' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ยืนยันแผนแล้ว — พร้อมเริ่มผลิต',
        null, p_job_id, v_job_no, 'production', 'planned');
    elsif p_to = 'qc' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ส่งถึง QC แล้ว',
        'รอตรวจสอบคุณภาพ (QC)', p_job_id, v_job_no, 'qc', 'qc');
    elsif p_to = 'qa' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' ส่งถึง QA แล้ว',
        'รอ QA ปล่อยผ่าน', p_job_id, v_job_no, 'qa', 'qa');
    elsif p_to = 'finished_goods' then
      perform public.create_notification(
        'arrival', 'งาน ' || v_job_no || ' พร้อมรับเข้าคลัง FG',
        'QA ปล่อยผ่านแล้ว — รอฝ่ายคลังรับเข้า', p_job_id, v_job_no, 'warehouse', 'finished_goods');
    end if;
  end if;
end;
$fn$;

revoke execute on function public.advance_job_status(uuid, job_status, text) from public;
revoke execute on function public.advance_job_status(uuid, job_status, text) from anon;
grant  execute on function public.advance_job_status(uuid, job_status, text) to authenticated;


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ)
--
-- ข้อ 1 · ฟังก์ชันถูกแทนที่ครบ (ไม่มีตัวซ้ำ)
--   select proname, count(*) from pg_proc
--    where proname in ('request_edit','review_edit_request','update_qa_sample','advance_job_status')
--    group by proname order by proname;
--   ✅ ต้องได้ 4 แถว ตัวละ 1
--   ❌ ถ้าได้ 2 = มี signature เก่าค้าง → แจ้ง Claude
--
-- ข้อ 2 · request_edit รู้จักชนิด qa_sample + แจ้งหัวหน้า QA
--   select prosrc like '%qa_sample%' and prosrc like '%''qa_lead''::app_role%'
--     from pg_proc where proname = 'request_edit';
--   ✅ true   ❌ false = ไฟล์นี้ยังไม่ได้รัน
--
-- ข้อ 3 · review_edit_request ให้หัวหน้า QA อนุมัติ qa_sample + sync Incident
--   select prosrc like '%เฉพาะหัวหน้า QA อนุมัติคำขอแก้ไขจุดเก็บตัวอย่างได้%'
--      and prosrc like '%qa_sample_sync_incident%'
--     from pg_proc where proname = 'review_edit_request';
--   ✅ true
--
-- ข้อ 4 · update_qa_sample ล็อกแถวที่อนุมัติแล้ว (ลูกน้อง)
--   select prosrc like '%กรุณากด "ขอแก้ไข"%' from pg_proc where proname = 'update_qa_sample';
--   ✅ true
--
-- ข้อ 5 · ด่านปล่อย FG ทั้งของเดิม (0095/0096) และของใหม่อยู่ครบ
--   select prosrc like '%ยังมีคำขอแก้ไขจุดเก็บตัวอย่าง%'
--      and prosrc like '%ยังมีจุดเก็บตัวอย่างรอหัวหน้า QA อนุมัติ%'
--      and prosrc like '%qc_gate_issues%'
--     from pg_proc where proname = 'advance_job_status';
--   ✅ true   ❌ false = ด่านเดิมหาย → แจ้ง Claude
-- ============================================================
