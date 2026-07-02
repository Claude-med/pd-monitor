-- ============================================================
-- PD Monitor — 0034_regression_fixes_quickwins.sql  (ก้อน 1: แก้ regression + quick wins)
-- รวม 5 เรื่องที่แก้ที่ระดับฟังก์ชัน DB:
--   (1) [บั๊กแจ้งเตือน] advance_job_status — ยกบล็อก create_notification ของ 0029 กลับมา
--       (0032 recreate ทับเพื่อเพิ่ม gate QC แล้วลืมยก noti มาด้วย → forward/reject เงียบ)
--       *** คง GATE ครบ: line clearance (0018) + inprocess (0032) + deviation (0025) ***
--   (2) [ข้อ 4] inprocess_route_complete — ผ่อนเป็น "อย่างน้อย 1 สถานีใน route ตรวจผ่าน"
--   (3) [ข้อ 3] create_job_with_order — ยก logic ออกเลขงานอัตโนมัติของ 0019 กลับมา
--       (0031 recreate ทับเพื่อผูกสูตร/route แล้วลืมยกออกเลขอัตโนมัติมา → เว้นว่างไม่ได้)
--       *** คงผูกสูตร active + copy job_routes ของ 0031 ***
--   (4) [ข้อ 1] request_material — ขอเบิกได้เฉพาะงานสถานะ pending_announce/planned/in_production
--   (5) [ข้อ 6] request_edit — ใบเบิกที่ 'issued' (จ่ายแล้ว) ขอแก้ไขไม่ได้
-- ⚠️ ไม่แตะ enum · ไม่แตะ schema (แก้เฉพาะ body ฟังก์ชัน) · รัน "หลัง" 0001–0033
-- ============================================================

-- ------------------------------------------------------------
-- (1) advance_job_status = body ของ 0032 (gate ครบ) + บล็อกแจ้งเตือนของ 0029
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
as $$
declare
  v_profile   uuid;
  v_from      job_status;
  v_job_no    text;
  v_is_reject boolean := false;
  v_allowed   boolean := false;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  select status, job_no into v_from, v_job_no from public.jobs where id = p_job_id for update;
  if v_from is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  if v_from = p_to then
    raise exception 'สถานะไม่เปลี่ยนแปลง';
  end if;

  if    v_from = 'pending_announce' and p_to = 'planned' then
    v_allowed := public.has_role('manager');
  elsif v_from = 'planned'          and p_to = 'in_production' then
    v_allowed := public.has_role('production') or public.has_role('manager');
    -- GATE: ต้องผ่าน Line Clearance ก่อนเริ่มผลิต (A3)
    if v_allowed and not public.line_clearance_passed(p_job_id) then
      raise exception 'เริ่มผลิตไม่ได้ — ต้องทำ Line Clearance ให้ผ่านก่อน (เคลียร์ของเก่า/ทำความสะอาด/ตั้งเครื่อง + ผู้ตรวจรับเซ็น)';
    end if;
  elsif v_from = 'in_production'     and p_to = 'qc' then
    v_allowed := public.has_role('production');
    -- GATE: ต้องตรวจ in-process QC (ผ่าน) ตามสูตรก่อนส่ง QC (E2 · ผ่อนเป็น ≥1 สถานีใน 0034)
    if v_allowed and not public.inprocess_route_complete(p_job_id) then
      raise exception 'ส่ง QC ไม่ได้ — ต้องมีผลตรวจ in-process QC (ผ่าน) อย่างน้อย 1 สถานีในสูตรก่อน';
    end if;
  elsif v_from = 'qc'               and p_to = 'qa' then
    v_allowed := public.has_role('qc');
  elsif v_from = 'qc'               and p_to = 'in_production' then
    v_allowed := public.has_role('qc'); v_is_reject := true;
  elsif v_from = 'qa'               and p_to = 'finished_goods' then
    v_allowed := public.has_role('qa');
    -- GATE: ปล่อยผ่าน FG ไม่ได้ถ้ายังมี deviation เปิดค้าง (B3)
    if v_allowed and public.has_open_deviation(p_job_id) then
      raise exception 'ปล่อยผ่าน FG ไม่ได้ — ยังมี deviation เปิดค้าง ต้องปิด (closed) ก่อน';
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

  -- ---------- แจ้งเตือน (ยกกลับจาก 0029) ----------
  if v_is_reject then
    -- B4: แจ้งฝ่ายผลิตเมื่องานถูกตีกลับ (relevant = in_production → ซ่อนเมื่อส่งต่อไปแล้ว)
    perform public.create_notification(
      'reject',
      'งาน ' || v_job_no || ' ถูกตีกลับ',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ไม่ระบุเหตุผล'),
      p_job_id, v_job_no, 'production', 'in_production');
  else
    -- C1a: แจ้ง role ปลายทางว่า "งานมาถึงหน้าที่คุณแล้ว"
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
$$;

grant execute on function public.advance_job_status(uuid, job_status, text) to authenticated;

-- ------------------------------------------------------------
-- (2) inprocess_route_complete — ผ่อนเป็น "อย่างน้อย 1 สถานีใน route ตรวจผ่าน"
--     งานไม่มี route = true (ไม่บล็อก — backward compat)
-- ------------------------------------------------------------
create or replace function public.inprocess_route_complete(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- งานไม่มี route เลย → ไม่บล็อก
    not exists (select 1 from public.job_routes jr where jr.job_id = p_job_id)
    -- หรือ มีอย่างน้อย 1 สถานีใน route ที่มีผลตรวจ in-process 'pass'
    or exists (
      select 1
      from public.job_routes jr
      join public.inprocess_checks ic
        on ic.job_id = p_job_id
       and ic.station_id = jr.station_id
       and ic.result = 'pass'
      where jr.job_id = p_job_id
    );
$$;

-- ------------------------------------------------------------
-- (3) create_job_with_order = body ของ 0031 (สูตร/route) + ออกเลขอัตโนมัติของ 0019
-- ------------------------------------------------------------
create or replace function public.create_job_with_order(
  p_customer      text,
  p_product_id    uuid,
  p_quantity      numeric,
  p_unit          text,
  p_due_date      date,
  p_job_no        text,
  p_planned_start date default null,
  p_planned_end   date default null,
  p_lot_no        text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_order   uuid;
  v_batch   uuid;
  v_job     uuid;
  v_recipe  uuid;
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหาร/ฝ่ายวางแผนสร้างงานผลิตได้';
  end if;

  -- ---------- validate ----------
  p_customer := btrim(coalesce(p_customer, ''));
  v_job_no   := btrim(coalesce(p_job_no, ''));
  if p_customer = '' then raise exception 'กรุณาระบุลูกค้า'; end if;
  if p_product_id is null then raise exception 'กรุณาเลือกผลิตภัณฑ์'; end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'จำนวนต้องมากกว่า 0';
  end if;

  -- ออกเลขงานอัตโนมัติถ้าเว้นว่าง (กันชนด้วย sequence + วน loop เผื่อชนเลขที่ใส่มือไว้)
  if v_job_no = '' then
    loop
      v_job_no := 'JOB-' || to_char(current_date, 'YYYY') || '-'
                  || lpad(nextval('public.job_no_seq')::text, 4, '0');
      exit when not exists (select 1 from public.jobs where job_no = v_job_no);
    end loop;
  else
    if exists (select 1 from public.jobs where job_no = v_job_no) then
      raise exception 'เลขงาน % มีอยู่แล้ว — กรุณาใช้เลขอื่น', v_job_no;
    end if;
  end if;

  if p_planned_start is not null and p_planned_end is not null
     and p_planned_end < p_planned_start then
    raise exception 'วันสิ้นสุดแผนต้องไม่ก่อนวันเริ่ม';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'สร้างงานผลิตใหม่ ' || v_job_no, true);

  -- ---------- order ----------
  insert into public.orders (order_no, customer, product_id, quantity, unit, due_date, created_by)
  values ('ORD-' || v_job_no, p_customer, p_product_id, p_quantity,
          coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'เม็ด'), p_due_date, v_profile)
  returning id into v_order;

  -- ---------- batch (ถ้าระบุล็อต) ----------
  if p_lot_no is not null and btrim(p_lot_no) <> '' then
    if exists (select 1 from public.batches where lot_no = btrim(p_lot_no)) then
      raise exception 'เลขล็อต % มีอยู่แล้ว', btrim(p_lot_no);
    end if;
    insert into public.batches (lot_no, order_id, product_id, created_by)
    values (btrim(p_lot_no), v_order, p_product_id, v_profile)
    returning id into v_batch;
  end if;

  -- ---------- auto เลือกสูตร active ของยา (ถ้ามี) ----------
  select id into v_recipe
  from public.product_recipes
  where product_id = p_product_id and is_active
  order by updated_at desc
  limit 1;

  -- ---------- job ----------
  insert into public.jobs
    (job_no, order_id, batch_id, recipe_id, status, planned_start, planned_end, created_by)
  values
    (v_job_no, v_order, v_batch, v_recipe, 'pending_announce', p_planned_start, p_planned_end, v_profile)
  returning id into v_job;

  -- ---------- copy route ของยา → job_routes (snapshot) ----------
  insert into public.job_routes (job_id, station_id, step_no, station_group, note, created_by)
  select v_job, pr.station_id, pr.step_no, s.station_group, pr.note, v_profile
  from public.product_routes pr
  join public.stations s on s.id = pr.station_id
  where pr.product_id = p_product_id;

  return v_job_no;
end;
$$;

grant execute on function public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text
) to authenticated;

-- ------------------------------------------------------------
-- (4) request_material — ขอเบิกได้เฉพาะงานก่อนส่ง QC (pending_announce/planned/in_production)
-- ------------------------------------------------------------
create or replace function public.request_material(
  p_job_id          uuid,
  p_material_lot_id uuid,
  p_qty             numeric,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_status  job_status;
  v_lot     record;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('production') or public.can_manage_materials()) then
    raise exception 'สิทธิ์ของคุณเบิกวัตถุดิบไม่ได้ (เฉพาะฝ่ายผลิต/คลัง/ผู้บริหาร)';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานนี้'; end if;
  -- [ข้อ 1] เบิกได้เฉพาะช่วงก่อนส่ง QC (รอแจ้งผลิต/มีแผนแล้ว/กำลังผลิต)
  if v_status not in ('pending_announce', 'planned', 'in_production') then
    raise exception 'เบิกวัตถุดิบได้เฉพาะช่วงก่อนส่ง QC (รอแจ้งผลิต/มีแผนแล้ว/กำลังผลิต) — สถานะปัจจุบัน: %', v_status;
  end if;

  select id, status, expiry_date into v_lot
    from public.material_lots where id = p_material_lot_id;
  if v_lot.id is null then raise exception 'ไม่พบล็อตวัตถุดิบที่เลือก'; end if;
  if v_lot.status in ('rejected', 'expired') then
    raise exception 'ล็อตนี้สถานะ % เบิกไม่ได้', v_lot.status;
  end if;
  if v_lot.expiry_date is not null and v_lot.expiry_date < current_date then
    raise exception 'ล็อตนี้หมดอายุแล้ว เบิกไม่ได้';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนที่เบิกต้องมากกว่า 0'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ขอเบิกวัตถุดิบ', true);

  insert into public.material_requisitions
    (job_id, material_lot_id, qty, status, note, requested_by, created_by)
  values
    (p_job_id, p_material_lot_id, p_qty, 'requested',
     nullif(btrim(coalesce(p_note, '')), ''), v_profile, v_profile)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.request_material(uuid, uuid, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- (5) request_edit — ใบเบิกที่จ่ายแล้ว (issued) ขอแก้ไขไม่ได้ [ข้อ 6]
--     (คง whitelist + กันคำขอค้างซ้ำ + แจ้งผู้อนุมัติ เดิมของ 0033)
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
  v_req_status requisition_status;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'กรุณาระบุเหตุผลการขอแก้ไข'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'ไม่มีรายการที่จะแก้ไข';
  end if;

  -- whitelist ฟิลด์ + ดึง job_id ต่อชนิด
  if p_target_type = 'production_record' then
    v_allowed := array['input_qty','output_qty','loss_qty','hours','headcount','note','record_date','station','machine_id'];
    select job_id into v_job from public.production_records where id = p_target_id;
  elsif p_target_type = 'material_requisition' then
    v_allowed := array['qty','note'];
    select job_id, status into v_job, v_req_status from public.material_requisitions where id = p_target_id;
    -- [ข้อ 6] ใบเบิกที่จ่ายแล้ว = ล็อกถาวร แก้ไขไม่ได้
    if v_req_status = 'issued' then
      raise exception 'ใบเบิกที่จ่ายแล้ว (issued) แก้ไขไม่ได้';
    end if;
  else -- inprocess_check
    v_allowed := array['param','value','unit','result','note'];
    select job_id into v_job from public.inprocess_checks where id = p_target_id;
  end if;
  if v_job is null then raise exception 'ไม่พบรายการที่จะขอแก้ไข'; end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'ฟิลด์ "%" แก้ไขไม่ได้', v_key;
    end if;
  end loop;

  -- กันคำขอค้างซ้ำต่อรายการเดียวกัน
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

  -- แจ้งผู้อนุมัติ: manager เสมอ (+ qa ถ้าเป็นข้อมูล QC)
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
