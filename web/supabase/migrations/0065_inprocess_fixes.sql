-- ============================================================
-- PD Monitor — Part C.4 / 0065_inprocess_fixes.sql  (ก้อน 2)
--   (1) 🐞 แก้บั๊ก "column status is of type inprocess_status but expression is of type text"
--       — หัวหน้า QC กดอนุมัติ/ไม่อนุมัติไม่ได้เลยตั้งแต่ 0064
--   (2) เปิดให้ "ขอแก้ไขย้อนหลัง" แก้ valid_date ได้ (ก่อนหน้านี้ไม่มีในรายชื่อฟิลด์)
--   (3) ปิดปุ่มขอแก้ไขผลตรวจ in-process ไม่ให้ฝ่ายอื่นใช้ — เป็นหน้าที่ QC
--   (4) อุดช่องโหว่: แก้ "ผล/ค่าที่วัดได้" ของผลตรวจที่อนุมัติไปแล้ว → ต้องกลับไปรออนุมัติใหม่
--
-- 🐞 ต้นเหตุ (1) — 0064:244
--       set status = case when p_decision = 'approve' then 'approved' else 'rejected' end
--    ทั้งสองแขนของ CASE เป็น literal ชนิด `unknown` ทั้งคู่ → Postgres รวมชนิดผลลัพธ์ของ CASE
--    ให้เป็น `text` ก่อนจะไปดูชนิดของคอลัมน์ปลายทาง → assign text เข้า enum ไม่ได้ (42804)
--    จุดอื่นในไฟล์เดียวกันรอด เพราะเป็น literal เดี่ยวที่ coerce ตามคอลัมน์ได้ (0064:50, 0064:171)
--    เป็นบั๊กตระกูลเดียวกับ 0055 (type inference ของ unknown literal)
--    → แก้ด้วยการ cast ผลลัพธ์ของ CASE ทั้งก้อนเป็น inprocess_status
--
-- ℹ️ ทั้งไฟล์เป็น `create or replace` ด้วย signature เดิมทั้ง 3 ตัว
--    → ไม่ต้อง drop · ไม่เกิด overload ซ้อน (PGRST203) · ACL เดิมติดมาด้วย
-- ℹ️ บอดี้ยกมาทั้งดุ้นจากฉบับล่าสุด: review_inprocess_check ← 0064 · request_edit /
--    review_edit_request ← 0063 (ไม่ใช่ 0033/0037 ซึ่งเป็นฉบับเก่า)
-- ℹ️ ไม่แตะ schema ตาราง · ไม่แตะ add_inprocess_check · ด่าน GMP เท่าเดิมทุกประการ
-- รัน "หลัง" 0001–0064
-- ============================================================

-- ------------------------------------------------------------
-- (1) review_inprocess_check — แก้บรรทัดเดียว (cast enum) ที่เหลือเหมือน 0064 เป๊ะ
-- ------------------------------------------------------------
create or replace function public.review_inprocess_check(
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
  v_chk     public.inprocess_checks%rowtype;
  v_note    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_approve_inprocess() then
    raise exception 'เฉพาะหัวหน้า QC/ผู้บริหารอนุมัติผลตรวจได้';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'คำสั่งไม่ถูกต้อง';
  end if;

  select * into v_chk from public.inprocess_checks where id = p_id for update;
  if v_chk.id is null then raise exception 'ไม่พบผลตรวจที่เลือก'; end if;
  if v_chk.status <> 'pending' then
    raise exception 'ผลตรวจนี้ถูกพิจารณาไปแล้ว (สถานะ: %)', v_chk.status;
  end if;
  if v_chk.checked_by = v_profile then
    raise exception 'ผู้อนุมัติต้องเป็นคนละคนกับผู้ลงผลตรวจ (สองลายเซ็นตามแนว GMP)';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_decision = 'reject' and v_note is null then
    raise exception 'การไม่อนุมัติต้องระบุเหตุผล';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    case when p_decision = 'approve' then 'อนุมัติผลตรวจ in-process ' else 'ไม่อนุมัติผลตรวจ in-process ' end
    || coalesce(v_chk.param, ''), true);

  update public.inprocess_checks
     -- 🐞 บรรทัดนี้คือบั๊ก 0064:244 — ต้อง cast ผลของ CASE ทั้งก้อน ไม่งั้นได้ text
     set status       = (case when p_decision = 'approve' then 'approved' else 'rejected' end)::inprocess_status,
         approved_by  = v_profile,
         approved_at  = now(),
         approve_note = v_note,
         updated_by   = v_profile
   where id = p_id;
end;
$fn$;

revoke execute on function public.review_inprocess_check(uuid, text, text) from public;
revoke execute on function public.review_inprocess_check(uuid, text, text) from anon;
grant  execute on function public.review_inprocess_check(uuid, text, text) to authenticated;

comment on function public.review_inprocess_check(uuid, text, text) is
  'อนุมัติ/ไม่อนุมัติผลตรวจ in-process 1 รายการ (หัวหน้า QC/ผู้บริหาร) — ต้องคนละคนกับผู้ลงผล · ไม่อนุมัติต้องมีเหตุผล';

-- ------------------------------------------------------------
-- (2)+(3) request_edit — เพิ่ม valid_date เข้า whitelist + กันฝ่ายอื่นขอแก้ผลตรวจ QC
--     บอดี้ยกมาจาก 0063:388-465 แก้ 2 จุดในบล็อก inprocess_check
--     🚨 คงโครง if / elsif / else raise ไว้เป๊ะ (บทเรียน Part C.2 — ตัด branch แล้วตกลง else)
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
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.request_edit(edit_target_type, uuid, jsonb, text) from public;
revoke execute on function public.request_edit(edit_target_type, uuid, jsonb, text) from anon;
grant  execute on function public.request_edit(edit_target_type, uuid, jsonb, text) to authenticated;

-- ------------------------------------------------------------
-- (2)+(4) review_edit_request — เขียน valid_date ตอนอนุมัติ + รีเซ็ตการอนุมัติเมื่อผลถูกแก้
--     บอดี้ยกมาจาก 0063:469-565 แก้เฉพาะบล็อก inprocess_check
--     🚨 คง `else raise` ไว้เป๊ะ — คำขอชนิดเก่า (ใบเบิก) ต้องไม่ถูกปิดเป็น applied ทั้งที่ไม่ได้แก้อะไร
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

  if not (public.has_role('manager')
          or (v_req.target_type = 'inprocess_check' and public.has_role('qa'))) then
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

-- ============================================================
-- ตรวจหลังรัน (คัดลอกไปรันแยกได้)
-- ------------------------------------------------------------
-- -- ไม่มี overload ซ้อน (ต้องได้ตัวละ 1 แถว)
-- select proname, count(*) from pg_proc
--  where proname in ('review_inprocess_check','request_edit','review_edit_request')
--  group by proname;
--
-- -- anon ต้องเรียกไม่ได้ทั้ง 3 ตัว (ต้องได้ false ทุกแถว)
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute') as anon_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('review_inprocess_check','request_edit','review_edit_request');
--
-- -- valid_date อยู่ใน whitelist แล้ว (ยิงผ่านแอปด้วยบัญชี QC จะได้ผลจริงกว่า)
-- ============================================================
