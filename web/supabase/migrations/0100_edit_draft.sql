-- ============================================================
-- PD Monitor — Part H / 0100_edit_draft.sql  (ก้อน 1.5)
--   กติกาแก้ไขเดียวกันทั้ง 3 จุด: บันทึกผลผลิตรายวัน · ผลตรวจ in-process · จุดเก็บตัวอย่าง (0099)
--
-- 🔑 กติกา (ผู้ใช้เลือก 25 ก.ย. 69)
--   · ยังไม่อนุมัติ (pending)      → ผู้บันทึกแก้ตรงได้ · ยังรออนุมัติตามเดิม
--   · ถูกตีกลับ (rejected)         → ผู้บันทึกแก้ตรงได้ · กลับเป็น "รออนุมัติ" + แจ้งหัวหน้าใหม่
--   · อนุมัติแล้ว (approved)       → ต้องยื่นคำขอแก้ไข (request_edit เดิม · ไม่เปลี่ยน)
--
-- 🔒 แก้ตรงได้เฉพาะ "คนที่บันทึกรายการนั้น" (หรือ admin)
--    บันทึกผลผลิต = created_by / operator_id · in-process = checked_by
--    เหตุผล: หัวหน้าที่แก้ค่าในร่างของคนอื่นแล้วกดอนุมัติเอง = ข้ามหลักสองลายเซ็น (GMP)
--    คนอื่นที่เห็นว่าผิด → หัวหน้าตีกลับให้ผู้บันทึกแก้ หรือยื่นคำขอแก้ไขเหมือนเดิม
--
-- 🧩 ฟังก์ชันเดียว รับ jsonb แบบเดียวกับ request_edit (หน้าจอส่งเฉพาะช่องที่เปลี่ยน)
--    ช่องที่แก้ได้ = whitelist ของ request_edit ยกเว้น สถานี/เครื่องจักร
--    (สถานีผูกกับขั้นตอน · เครื่องผูกกับ Line Clearance — ถ้าลงผิดให้ตีกลับแล้วบันทึกใหม่)
--
-- รัน "หลัง" 0099 · ฟังก์ชันใหม่ ไม่แตะของเดิม · รันซ้ำได้
-- ============================================================

create or replace function public.edit_draft(
  p_target_type edit_target_type,
  p_target_id   uuid,
  p_changes     jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile  uuid;
  v_allowed  text[];
  v_key      text;
  v_rec      public.production_records%rowtype;
  v_chk      public.inprocess_checks%rowtype;
  v_status   job_status;
  v_job_no   text;
  v_resubmit boolean;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'ยังไม่มีการแก้ไข (ค่ายังเหมือนเดิม)';
  end if;

  if exists (
    select 1 from public.edit_requests
     where target_type = p_target_type and target_id = p_target_id and status = 'pending'
  ) then
    raise exception 'รายการนี้มีคำขอแก้ไขรออนุมัติอยู่ — รอให้หัวหน้าอนุมัติหรือปฏิเสธก่อน';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  -- ==================== บันทึกผลผลิตรายวัน ====================
  if p_target_type = 'production_record' then
    if not (public.has_role('production')
            or public.has_role('production_lead')
            or public.has_role('manager')) then
      raise exception 'สิทธิ์ของคุณแก้ไขบันทึกผลผลิตไม่ได้';
    end if;
    v_allowed := array['input_qty','output_qty','loss_qty','minutes','headcount','note',
                       'record_date','input_unit','output_unit','loss_unit','shift','work_period'];

    select * into v_rec from public.production_records where id = p_target_id for update;
    if v_rec.id is null then raise exception 'ไม่พบบันทึกผลผลิตที่เลือก'; end if;
    if v_rec.status = 'approved' then
      raise exception 'บันทึกนี้หัวหน้าอนุมัติแล้ว — กรุณากด "ขอแก้ไข" เพื่อยื่นคำขอแก้ไขแทน';
    end if;
    if not (v_rec.created_by = v_profile or v_rec.operator_id = v_profile
            or public.has_role('admin')) then
      raise exception 'แก้ไขตรงได้เฉพาะผู้บันทึกรายการนี้ — คนอื่นให้ยื่นคำขอแก้ไข';
    end if;
    select status, job_no into v_status, v_job_no from public.jobs where id = v_rec.job_id;
    if v_status <> 'in_production' then
      raise exception 'แก้ไขบันทึกผลผลิตได้เฉพาะงานที่กำลังผลิตอยู่ — นอกนั้นให้ยื่นคำขอแก้ไข';
    end if;

    for v_key in select jsonb_object_keys(p_changes) loop
      if not (v_key = any(v_allowed)) then
        raise exception 'ฟิลด์ "%" แก้ไขตรงไม่ได้', v_key;
      end if;
    end loop;

    v_resubmit := v_rec.status = 'rejected';
    perform set_config('app.audit_reason',
      case when v_resubmit then 'แก้บันทึกผลผลิตที่ถูกตีกลับ แล้วส่งอนุมัติใหม่'
           else 'แก้บันทึกผลผลิต (ยังไม่อนุมัติ)' end, true);

    -- ตั้ง status เองในคำสั่งเดียวกัน ⇒ trigger reset_production_record_approval (0085)
    -- เห็น new.status ≠ old.status แล้วไม่ทำงานซ้ำ (ไม่มีแจ้งเตือนซ้อน 2 ใบ)
    update public.production_records set
      input_qty   = case when p_changes ? 'input_qty'   then (p_changes->>'input_qty')::numeric   else input_qty   end,
      output_qty  = case when p_changes ? 'output_qty'  then (p_changes->>'output_qty')::numeric  else output_qty  end,
      loss_qty    = case when p_changes ? 'loss_qty'    then coalesce(nullif(p_changes->>'loss_qty', '')::numeric, 0) else loss_qty end,
      minutes     = case when p_changes ? 'minutes'     then nullif(p_changes->>'minutes', '')::numeric   else minutes     end,
      headcount   = case when p_changes ? 'headcount'   then nullif(p_changes->>'headcount', '')::integer else headcount   end,
      note        = case when p_changes ? 'note'        then nullif(btrim(p_changes->>'note'), '')        else note        end,
      record_date = case when p_changes ? 'record_date' then (p_changes->>'record_date')::date          else record_date end,
      input_unit  = case when p_changes ? 'input_unit'  then nullif(btrim(p_changes->>'input_unit'), '')  else input_unit  end,
      output_unit = case when p_changes ? 'output_unit' then nullif(btrim(p_changes->>'output_unit'), '') else output_unit end,
      loss_unit   = case when p_changes ? 'loss_unit'   then nullif(btrim(p_changes->>'loss_unit'), '')   else loss_unit   end,
      shift       = case when p_changes ? 'shift'       then nullif(p_changes->>'shift', '')::work_shift  else shift       end,
      work_period = case when p_changes ? 'work_period' then nullif(p_changes->>'work_period', '')::work_period else work_period end,
      status       = 'pending'::production_record_status,
      approved_by  = case when v_resubmit then null else approved_by  end,
      approved_at  = case when v_resubmit then null else approved_at  end,
      approve_note = case when v_resubmit then null else approve_note end,
      updated_by  = v_profile
    where id = p_target_id;

    -- ตรวจค่าหลังแก้ ด้วยกติกาเดียวกับ add_production_record (0092)
    select * into v_rec from public.production_records where id = p_target_id;
    if v_rec.input_qty is null or v_rec.input_qty < 0 then
      raise exception 'ยอดที่ต้องการจำเป็นต้องกรอกและห้ามติดลบ';
    end if;
    if v_rec.output_qty is null or v_rec.output_qty < 0 then
      raise exception 'ยอดผลิตได้ (output) จำเป็นต้องกรอกและห้ามติดลบ';
    end if;
    if coalesce(v_rec.loss_qty, 0) < 0 then raise exception 'ของเสีย (loss) ห้ามติดลบ'; end if;
    if v_rec.minutes is not null and (v_rec.minutes < 0 or v_rec.minutes > 1440) then
      raise exception 'นาทีทำงานต้องอยู่ระหว่าง 0–1440 (24 ชั่วโมง)';
    end if;
    if v_rec.headcount is not null and v_rec.headcount < 1 then
      raise exception 'จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
    end if;
    if v_rec.output_qty > v_rec.input_qty then
      raise exception 'ยอดผลิตได้ (%) มากกว่ายอดที่ต้องการ (%) ไม่ได้', v_rec.output_qty, v_rec.input_qty;
    end if;
    if (v_rec.output_qty + coalesce(v_rec.loss_qty, 0)) > v_rec.input_qty then
      raise exception 'ผลิตได้ + ของเสีย (%) มากกว่ายอดที่ต้องการ (%) ไม่ได้',
        (v_rec.output_qty + coalesce(v_rec.loss_qty, 0)), v_rec.input_qty;
    end if;
    if v_rec.record_date > current_date then
      raise exception 'วันที่บันทึกเป็นวันในอนาคตไม่ได้';
    end if;

    if v_resubmit then
      perform public.create_notification(
        'approval_request',
        'บันทึกผลผลิต ' || to_char(v_rec.record_date, 'DD/MM/YYYY') || ' งาน '
          || coalesce(v_job_no, '') || ' แก้ไขแล้ว — ส่งอนุมัติใหม่',
        'รายการที่เคยไม่อนุมัติ ถูกผู้บันทึกแก้ไขแล้ว',
        v_rec.job_id, v_job_no, 'production_lead'::app_role, null::job_status, null::uuid, true);
    end if;

  -- ==================== ผลตรวจ in-process ====================
  elsif p_target_type = 'inprocess_check' then
    if not public.can_record_inprocess() then
      raise exception 'เฉพาะ QC/หัวหน้า QC/ผู้บริหารแก้ไขผลตรวจระหว่างผลิตได้';
    end if;
    v_allowed := array['param','value','unit','result','note','valid_date'];

    select * into v_chk from public.inprocess_checks where id = p_target_id for update;
    if v_chk.id is null then raise exception 'ไม่พบผลตรวจที่เลือก'; end if;
    if v_chk.status = 'approved' then
      raise exception 'ผลตรวจนี้หัวหน้า QC อนุมัติแล้ว — กรุณากด "ขอแก้ไข" เพื่อยื่นคำขอแก้ไขแทน';
    end if;
    if not (v_chk.checked_by = v_profile or public.has_role('admin')) then
      raise exception 'แก้ไขตรงได้เฉพาะผู้ลงผลตรวจรายการนี้ — คนอื่นให้ยื่นคำขอแก้ไข';
    end if;
    select status, job_no into v_status, v_job_no from public.jobs where id = v_chk.job_id;
    if v_status not in ('in_production', 'qc', 'qa') then
      raise exception 'แก้ไขผลตรวจระหว่างผลิตได้เฉพาะงานที่กำลังผลิต/QC/QA';
    end if;

    for v_key in select jsonb_object_keys(p_changes) loop
      if not (v_key = any(v_allowed)) then
        raise exception 'ฟิลด์ "%" แก้ไขตรงไม่ได้', v_key;
      end if;
    end loop;
    if p_changes ? 'param' and nullif(btrim(coalesce(p_changes->>'param', '')), '') is null then
      raise exception 'กรุณาระบุหัวข้อที่ตรวจ';
    end if;
    if p_changes ? 'result' and coalesce(p_changes->>'result', '') not in ('pass', 'fail') then
      raise exception 'ผลตรวจต้องเป็น ผ่าน หรือ ไม่ผ่าน';
    end if;

    v_resubmit := v_chk.status = 'rejected';
    perform set_config('app.audit_reason',
      case when v_resubmit then 'แก้ผลตรวจ in-process ที่ถูกตีกลับ แล้วส่งอนุมัติใหม่'
           else 'แก้ผลตรวจ in-process (ยังไม่อนุมัติ)' end, true);

    update public.inprocess_checks set
      param      = case when p_changes ? 'param'  then btrim(p_changes->>'param')                   else param  end,
      value      = case when p_changes ? 'value'  then nullif(btrim(p_changes->>'value'), '')       else value  end,
      unit       = case when p_changes ? 'unit'   then nullif(btrim(p_changes->>'unit'), '')        else unit   end,
      result     = case when p_changes ? 'result' then (p_changes->>'result')::check_result         else result end,
      note       = case when p_changes ? 'note'   then nullif(btrim(p_changes->>'note'), '')        else note   end,
      valid_date = case when p_changes ? 'valid_date' then nullif(p_changes->>'valid_date', '')::date else valid_date end,
      status       = 'pending'::inprocess_status,
      approved_by  = case when v_resubmit then null else approved_by  end,
      approved_at  = case when v_resubmit then null else approved_at  end,
      approve_note = case when v_resubmit then null else approve_note end,
      updated_by = v_profile
    where id = p_target_id;

    if v_resubmit then
      -- ℹ️ Incident Case ที่เปิดตอนถูกตีกลับ (0085) ไม่ปิดให้เอง — QA เป็นคนตัดสินปิดเคส
      perform public.create_notification(
        'approval_request',
        'ผลตรวจระหว่างผลิต งาน ' || coalesce(v_job_no, '') || ' แก้ไขแล้ว — ส่งอนุมัติใหม่',
        coalesce(p_changes->>'param', v_chk.param, ''),
        v_chk.job_id, v_job_no, 'qc_lead'::app_role, null::job_status, null::uuid, true);
    end if;

  else
    raise exception 'รายการชนิดนี้แก้ไขตรงผ่านช่องทางนี้ไม่ได้';
  end if;
end;
$fn$;

revoke execute on function public.edit_draft(edit_target_type, uuid, jsonb) from public;
revoke execute on function public.edit_draft(edit_target_type, uuid, jsonb) from anon;
grant  execute on function public.edit_draft(edit_target_type, uuid, jsonb) to authenticated;

comment on function public.edit_draft(edit_target_type, uuid, jsonb) is
  'แก้ตรงรายการที่ยังไม่อนุมัติ/ถูกตีกลับ (บันทึกผลผลิต · in-process) — เฉพาะผู้บันทึก · ตีกลับแล้วแก้ = ส่งอนุมัติใหม่ (Part H 0100)';

-- ============================================================
-- ✅ ตรวจหลัง paste
--
-- ข้อ 1 · ฟังก์ชันใหม่มีอยู่ 1 ตัว
--   select count(*) from pg_proc where proname = 'edit_draft';
--   ✅ 1   ❌ 0 = ไฟล์นี้ยังไม่ได้รัน
--
-- ข้อ 2 · ลูกน้อง/ทุกคนที่ล็อกอินเรียกได้
--   select has_function_privilege('authenticated',
--     'public.edit_draft(edit_target_type, uuid, jsonb)', 'execute');
--   ✅ true
-- ============================================================
