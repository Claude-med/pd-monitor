-- ============================================================
-- PD Monitor — Part C.2 ก้อน 4 / 0057_drop_requisitions.sql
-- ลบ "ระบบเบิกผลิตภัณฑ์แบบผูกล็อต" ทิ้งทั้งชุด (แทนที่ด้วย job_materials ใน 0056)
--
--   (0) pre-flight — มีใบที่จ่ายแล้ว หรือคำขอแก้ไขค้าง = หยุดทั้งไฟล์
--   (1) request_edit           — ตัด branch material_requisition
--   (2) review_edit_request    — ตัด branch + ปิดกับดัก else
--   (3) product_delete_report  — ตัดการนับใบเบิกเป็น blocker
--   (4) drop RPC เบิก 3 ตัว
--   (5) ถอด realtime → drop table material_requisitions → drop type requisition_status
--
-- ⛔ paste ไฟล์นี้ได้ "หลัง" โค้ดก้อน 2–3 ขึ้น Vercel แล้วเท่านั้น
--    ถ้า drop ตอนเว็บยังรันโค้ดเก่า หน้ารายละเอียดงานจะพังทั้งหน้า (PostgREST ตอบ 42P01 ทั้ง query)
-- ⚠️ ค่า 'material_requisition' ใน enum edit_target_type "ลบทิ้งไม่ได้"
--    Postgres ไม่มี ALTER TYPE ... DROP VALUE · ปล่อยค้างไว้ตลอดไป
--    (แถว edit_requests เก่ายังอ้างค่านี้ · ฝั่งแอปคงสมาชิก union ไว้แต่ไม่ offer ใน UI)
-- ⚠️ หลังไฟล์นี้ "ไม่มีระบบใดตัดสต็อก material_lots.qty_on_hand อัตโนมัติอีก"
--    ตัวเลขคงเหลือหน้าผลิตภัณฑ์คลังจะนิ่งจนกว่าฝ่ายคลังจะไปแก้เอง — ต้องแจ้งทีมก่อน
-- ℹ️ ไม่แตะ can_manage_materials() (0016 ยังใช้กับ upsert_product_lot/หน้าคลัง)
--    ไม่แตะ delete_job() (0035 ลบจาก jobs แล้วอาศัย cascade — job_materials ผูก cascade อยู่แล้ว)
--    ไม่แตะ material_lots — ทะเบียนล็อตยังใช้งานต่อตามเดิม
-- รัน "หลัง" 0001–0056
-- ============================================================

-- ------------------------------------------------------------
-- (0) pre-flight — กันลบข้อมูลที่มีความหมายทาง GMP ทิ้งแบบเงียบ
--     ทั้งไฟล์อยู่ในทรานแซกชันเดียว · raise ที่นี่ = rollback ทุกอย่างข้างล่าง
-- ------------------------------------------------------------
do $$
declare
  v_total        integer;
  v_issued       integer;
  v_pending_edit integer;
begin
  if to_regclass('public.material_requisitions') is null then
    raise notice 'material_requisitions ถูกลบไปแล้ว — ข้ามขั้นตอนตรวจ (รันซ้ำได้)';
    return;
  end if;

  select count(*), count(*) filter (where status = 'issued')
    into v_total, v_issued
    from public.material_requisitions;

  if v_issued > 0 then
    raise exception
      'มีใบเบิกที่ "จ่ายแล้ว" % ใบ (จากทั้งหมด % ใบ) — สต็อกถูกตัดไปจริงและการลบไม่คืนสต็อก '
      'ห้ามลบทิ้งเงียบตามหลัก GMP · export เก็บไว้ก่อนแล้วค่อยลบด้วยมือ',
      v_issued, v_total;
  end if;

  select count(*) into v_pending_edit
    from public.edit_requests
   where target_type = 'material_requisition' and status = 'pending';

  if v_pending_edit > 0 then
    raise exception
      'มีคำขอแก้ไขใบเบิกที่ยังรออนุมัติ % ใบ — อนุมัติหรือปฏิเสธให้จบก่อน '
      '(หลังลบระบบเบิกเดิมแล้วจะดำเนินการกับคำขอเหล่านี้ไม่ได้อีก)',
      v_pending_edit;
  end if;

  raise notice 'ตรวจแล้ว: material_requisitions % แถว · ไม่มีใบที่จ่ายแล้ว · ไม่มีคำขอค้าง — ลบได้', v_total;
end $$;

-- ------------------------------------------------------------
-- (1) request_edit — ยกบอดี้ล่าสุดจาก 0037:144-226 มาทั้งดุ้น
--     แก้ 2 จุด: ตัด declare v_req_status (type กำลังจะหาย) · branch ใบเบิก -> raise
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
as $$
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
    v_allowed := array['input_qty','output_qty','loss_qty','hours','headcount','note','record_date','station','station_id','machine_id'];
    select job_id into v_job from public.production_records where id = p_target_id;
  elsif p_target_type = 'material_requisition' then
    -- Part C.2: ระบบเบิกแบบผูกล็อตถูกยกเลิก — ของใหม่ฝ่ายผลิตแก้ได้เองที่หน้างาน
    raise exception 'ระบบเบิกวัตถุดิบแบบเดิมถูกยกเลิกแล้ว — แก้รายการเบิกได้ที่หน้างานโดยตรง';
  else -- inprocess_check
    v_allowed := array['param','value','unit','result','note','station_id'];
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
$$;

grant execute on function public.request_edit(edit_target_type, uuid, jsonb, text) to authenticated;

-- ------------------------------------------------------------
-- (2) review_edit_request — ยกบอดี้ล่าสุดจาก 0037:234-346 มาทั้งดุ้น
--
--     🚨 กับดักที่ต้องแก้พร้อมกัน: ของเดิมใช้ if / elsif / else โดย "else = inprocess_check"
--        ถ้าตัด branch material_requisition ทิ้งเฉย ๆ คำขอชนิดเก่าที่ค้างอยู่จะตกลง else
--        แล้วสั่ง update inprocess_checks where id = <id ของใบเบิก> = แก้ 0 แถว
--        แต่ปิดสถานะเป็น 'applied' ต่อ = "อนุมัติสำเร็จ" ทั้งที่ไม่ได้แก้อะไรเลย (พังเงียบ)
--        → เปลี่ยนเป็น elsif inprocess_check + else raise
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
as $$
declare
  v_profile uuid;
  v_req     public.edit_requests%rowtype;
  v_note    text;
  v_job_no  text;
  v_in      numeric;
  v_out     numeric;
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

  -- ---------- ปฏิเสธ ----------
  -- ปฏิเสธได้ทุกชนิดรวมถึงใบเบิกระบบเดิมที่ค้างอยู่ (ไม่ได้แตะตารางเป้าหมาย)
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

  -- ---------- อนุมัติ → apply UPDATE จริง (audit_log trigger เก็บ old→new) ----------
  perform set_config('app.audit_reason', 'แก้ไขย้อนหลังตามคำขอที่อนุมัติ', true);

  if v_req.target_type = 'production_record' then
    update public.production_records set
      input_qty   = case when v_req.changes ? 'input_qty'   then (v_req.changes->>'input_qty')::numeric   else input_qty   end,
      output_qty  = case when v_req.changes ? 'output_qty'  then (v_req.changes->>'output_qty')::numeric  else output_qty  end,
      loss_qty    = case when v_req.changes ? 'loss_qty'    then (v_req.changes->>'loss_qty')::numeric    else loss_qty    end,
      hours       = case when v_req.changes ? 'hours'       then (v_req.changes->>'hours')::numeric       else hours       end,
      headcount   = case when v_req.changes ? 'headcount'   then (v_req.changes->>'headcount')::integer   else headcount   end,
      note        = case when v_req.changes ? 'note'        then nullif(btrim(v_req.changes->>'note'), '') else note        end,
      record_date = case when v_req.changes ? 'record_date' then (v_req.changes->>'record_date')::date    else record_date end,
      station_id  = case when v_req.changes ? 'station_id'  then (v_req.changes->>'station_id')::uuid      else station_id end,
      -- station(enum group): มาจาก station_id ใหม่ (ถ้าแก้) · หรือ station enum ตรงๆ (backward) · หรือคงเดิม
      station     = case
                      when v_req.changes ? 'station_id'
                        then (select s.station_group from public.stations s
                               where s.id = (v_req.changes->>'station_id')::uuid)
                      when v_req.changes ? 'station'
                        then (v_req.changes->>'station')::production_station
                      else station
                    end,
      machine_id  = case when v_req.changes ? 'machine_id'  then nullif(v_req.changes->>'machine_id', '')::uuid  else machine_id  end,
      updated_by  = v_profile
    where id = v_req.target_id;
    select input_qty, output_qty into v_in, v_out
    from public.production_records where id = v_req.target_id;
    if v_in is not null and v_out is not null and v_out > v_in then
      raise exception 'แก้ไม่ได้ — ผลิตได้ต้องไม่เกินจำนวนตั้งต้น';
    end if;

  elsif v_req.target_type = 'inprocess_check' then
    -- inprocess_check (station_id + set station(group) ควบ)
    update public.inprocess_checks set
      param      = case when v_req.changes ? 'param'  then nullif(btrim(v_req.changes->>'param'), '') else param  end,
      value      = case when v_req.changes ? 'value'  then nullif(btrim(v_req.changes->>'value'), '') else value  end,
      unit       = case when v_req.changes ? 'unit'   then nullif(btrim(v_req.changes->>'unit'), '')  else unit   end,
      result     = case when v_req.changes ? 'result' then (v_req.changes->>'result')::check_result   else result end,
      note       = case when v_req.changes ? 'note'   then nullif(btrim(v_req.changes->>'note'), '')  else note   end,
      station_id = case when v_req.changes ? 'station_id' then (v_req.changes->>'station_id')::uuid    else station_id end,
      station    = case when v_req.changes ? 'station_id'
                        then (select s.station_group from public.stations s
                               where s.id = (v_req.changes->>'station_id')::uuid)
                        else station end,
      updated_by = v_profile
    where id = v_req.target_id;

  else
    -- material_requisition (และชนิดอื่นที่อาจเพิ่มใน enum ภายหลัง) — ต้อง raise เสมอ
    -- ห้ามปล่อยตกมาถึงนี่แบบเงียบ ๆ เด็ดขาด (ดูคำเตือนหัวข้อ (2))
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
$$;

grant execute on function public.review_edit_request(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- (3) product_delete_report — ยกบอดี้ล่าสุดจาก 0050:28-134 มาทั้งดุ้น
--     แก้จุดเดียว: ตัด v_reqs (นับใบเบิกที่อ้างล็อตของยานี้เป็น blocker)
--     ตารางใบเบิกกำลังจะหาย · job_materials ไม่ผูก material_lots จึงไม่เป็น blocker
-- ------------------------------------------------------------
create or replace function public.product_delete_report(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_code      text;
  v_name      text;
  v_active    boolean;
  v_orders    integer;
  v_jobs      integer;
  v_batches   integer;
  v_fg        integer;
  v_jobrecipe integer;
  v_lots      integer;
  v_routes    integer;
  v_recipes   integer;
  v_items     integer;
  v_blockers  jsonb := '[]'::jsonb;
  v_cascades  jsonb := '[]'::jsonb;
begin
  select code, name, is_active into v_code, v_name, v_active
    from public.products where id = p_id;
  if v_code is null then
    raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
  end if;

  -- ---------- blocker: อ้างตรงถึง products แบบ NO ACTION ----------
  select count(*) into v_orders  from public.orders       where product_id = p_id;
  select count(*) into v_batches from public.batches      where product_id = p_id;
  select count(*) into v_fg      from public.fg_inventory where product_id = p_id;
  select count(*) into v_jobs
    from public.jobs j
    join public.orders o on o.id = j.order_id
   where o.product_id = p_id;

  -- ---------- blocker แบบลูกโซ่ ----------
  -- (Part C.2: ตัดการนับใบเบิกที่อ้าง material_lots ออก — ระบบเบิกแบบผูกล็อตถูกลบแล้ว)

  -- jobs.recipe_id อ้าง product_recipes (0031:16) ที่จะถูก cascade ลบตาม product
  select count(*) into v_jobrecipe
    from public.jobs j
    join public.product_recipes pr on pr.id = j.recipe_id
   where pr.product_id = p_id;

  -- ---------- cascade: หายตามแน่นอน ต้องบอกให้เห็นก่อนกดลบ ----------
  select count(*) into v_lots    from public.material_lots   where product_id = p_id;
  select count(*) into v_routes  from public.product_routes  where product_id = p_id;
  select count(*) into v_recipes from public.product_recipes where product_id = p_id;
  select count(*) into v_items
    from public.recipe_items ri
    join public.product_recipes pr on pr.id = ri.recipe_id
   where pr.product_id = p_id;

  if v_jobs > 0 then
    v_blockers := v_blockers || jsonb_build_object('label', 'งานผลิต', 'count', v_jobs, 'unit', 'ใบ');
  end if;
  if v_orders > 0 then
    v_blockers := v_blockers || jsonb_build_object('label', 'ใบสั่งผลิต', 'count', v_orders, 'unit', 'ใบ');
  end if;
  if v_batches > 0 then
    v_blockers := v_blockers || jsonb_build_object('label', 'ล็อตการผลิต', 'count', v_batches, 'unit', 'ล็อต');
  end if;
  if v_fg > 0 then
    v_blockers := v_blockers || jsonb_build_object('label', 'สต็อกสินค้าสำเร็จรูป', 'count', v_fg, 'unit', 'รายการ');
  end if;
  if v_jobrecipe > 0 then
    v_blockers := v_blockers || jsonb_build_object('label', 'งานที่อ้างสูตรของยานี้', 'count', v_jobrecipe, 'unit', 'ใบ');
  end if;

  if v_lots > 0 then
    v_cascades := v_cascades || jsonb_build_object('label', 'ล็อตในคลัง', 'count', v_lots, 'unit', 'ล็อต');
  end if;
  if v_routes > 0 then
    v_cascades := v_cascades || jsonb_build_object('label', 'ขั้นตอนการผลิต', 'count', v_routes, 'unit', 'สถานี');
  end if;
  if v_recipes > 0 then
    v_cascades := v_cascades || jsonb_build_object('label', 'สูตรการผลิต', 'count', v_recipes, 'unit', 'สูตร');
  end if;
  if v_items > 0 then
    v_cascades := v_cascades || jsonb_build_object('label', 'รายการวัตถุดิบในสูตร', 'count', v_items, 'unit', 'รายการ');
  end if;

  return jsonb_build_object(
    'id',         p_id,
    'code',       v_code,
    'name',       v_name,
    'is_active',  v_active,
    'can_delete', jsonb_array_length(v_blockers) = 0,
    'blockers',   v_blockers,
    'cascades',   v_cascades
  );
end;
$fn$;

-- ปิดประตูซ้ำ: create or replace เก็บ grant เดิมไว้ก็จริง แต่เขียนให้ชัดตามบทเรียน 0050/0054
revoke execute on function public.product_delete_report(uuid) from public;
revoke execute on function public.product_delete_report(uuid) from anon;
revoke execute on function public.product_delete_report(uuid) from authenticated;

comment on function public.product_delete_report(uuid) is
  'ภายใน (revoke จาก public/anon/authenticated แล้ว) — นับสิ่งที่บล็อกการลบถาวร + สิ่งที่จะถูกลบตาม · ใช้ร่วมกันโดย preview_delete_product / force_delete_product';

-- ------------------------------------------------------------
-- (4) drop RPC ระบบเบิกเดิม — ระบุ signature เป๊ะ กัน overload ค้าง (PGRST203)
-- ------------------------------------------------------------
drop function if exists public.request_material(uuid, uuid, numeric, text);
drop function if exists public.issue_requisition(uuid);
drop function if exists public.cancel_requisition(uuid);

-- ------------------------------------------------------------
-- (5) ถอด realtime → drop table → drop enum
--     drop table ถอดออกจาก publication ให้เองอยู่แล้ว แต่เขียนไว้ให้อ่านไฟล์แล้วรู้ว่าจัดการครบ
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime drop table public.material_requisitions;
exception
  when undefined_object then null;
  when undefined_table  then null;
end $$;

-- trigger / index / policy ของตารางหายตามไปเอง
drop table if exists public.material_requisitions;

-- ใช้เฉพาะในตารางที่เพิ่ง drop และในฟังก์ชันที่ recreate ไปแล้วข้างบน จึงลบได้
drop type if exists public.requisition_status;

-- ------------------------------------------------------------
-- ตรวจหลังรัน (ออปชัน)
-- ------------------------------------------------------------
-- select to_regclass('public.material_requisitions');                        -- null
-- select count(*) from pg_type where typname = 'requisition_status';         -- 0
-- select count(*) from pg_proc where proname in
--   ('request_material','issue_requisition','cancel_requisition');           -- 0
-- select oid::regprocedure from pg_proc where proname in
--   ('request_edit','review_edit_request','product_delete_report');          -- ตัวละ 1 แถว ไม่ซ้อน
-- select has_function_privilege('anon','public.product_delete_report(uuid)','execute');  -- false
-- select count(*) from public.edit_requests where target_type = 'material_requisition';
--   -- ถ้ามี > 0 = คำขอเก่าค้างอยู่ · กด "ปฏิเสธ" ปิดได้ แต่อนุมัติไม่ได้แล้ว (ตั้งใจ)
