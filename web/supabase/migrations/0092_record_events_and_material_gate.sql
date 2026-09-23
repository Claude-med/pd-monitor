-- ============================================================
-- PD Monitor — Part F / 0092_record_events_and_material_gate.sql
--   (1) 🧾 เพิ่มรายการเบิก        → แจ้งฝ่ายคลัง ให้ไปกดสถานะ "พร้อม"
--   (2) 🧪 เพิ่มผลิตภัณฑ์ใหม่      → แจ้งฝ่ายผลิต ให้ไปผูกขั้นตอนการผลิต (Route)
--   (3) 🔬 บันทึกผลผลิตรายวันใหม่ → แจ้ง "ลูกน้อง QC" ให้เปิดตรวจระหว่างผลิต
--   (4) 🛠️ เครื่องจักรใกล้/เลยกำหนดสอบเทียบ-ซ่อมบำรุง → แจ้งฝ่ายวิศวกรรม (cron เรียก · ตั้งตารางที่ 0094)
--   (5) 🚦 ด่านใหม่: วัตถุดิบ/บรรจุภัณฑ์ต้อง "พร้อม" ครบ ก่อนบันทึกผลผลิตรายวัน
--
-- 🚨 ทุกใบเรียก create_notification แบบ 9 arg (0084:79-89) และต้องส่งครบทุกตัวพร้อม cast
--    ห้ามเติม DEFAULT ให้ 2 ตัวท้ายเด็ดขาด — การเรียกแบบ 7-arg ของฟังก์ชันเก่าจะกำกวมทันที
--    แล้ว Postgres ตอบ "function is not unique" พังทั้งระบบ (0084:68-72)
--
-- 🧠 ยกบอดี้ 3 ฟังก์ชันมาทั้งก้อนแล้ว diff เทียบ — ทุก hunk เป็น "บรรทัดเพิ่ม" ล้วน ไม่มีของเดิมหาย
--    ต้นฉบับ: upsert_job_material 0056:154-262 · upsert_product 0070:32-100
--             add_production_record 0086:562-806
--
-- รัน "หลัง" 0091 · รันซ้ำได้
-- ============================================================


-- ------------------------------------------------------------
-- (1) upsert_job_material — แจ้งฝ่ายคลังเมื่อมีรายการเบิกใหม่
-- ------------------------------------------------------------
create or replace function public.upsert_job_material(
  p_id        uuid,
  p_job_id    uuid,
  p_item_name text,
  p_item_type text default 'RM',
  p_qty       numeric default null,
  p_qty_unit  text default null,
  p_note      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_job_no  text;
  v_name    text;
  v_type    text;
  v_unit    text;
  v_note    text;
  v_qty     numeric(14,3);
  v_id      uuid;
  v_old     public.job_materials%rowtype;
  v_reset   boolean := false;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  if not public.can_edit_job_materials() then
    raise exception 'เฉพาะฝ่ายผลิต/ผู้บริหารเพิ่ม-แก้รายการเบิกได้ (ฝ่ายคลังแก้ได้เฉพาะสถานะ)';
  end if;

  select j.job_no into v_job_no from public.jobs j where j.id = p_job_id;
  if v_job_no is null then
    raise exception 'ไม่พบงานที่เลือก';
  end if;

  v_name := btrim(coalesce(p_item_name, ''));
  if v_name = '' then
    raise exception 'กรุณาระบุชื่อวัตถุดิบ/บรรจุภัณฑ์';
  end if;

  v_type := upper(btrim(coalesce(p_item_type, 'RM')));
  if v_type not in ('RM', 'PM') then
    raise exception 'ประเภทต้องเป็น RM (วัตถุดิบ) หรือ PM (บรรจุภัณฑ์)';
  end if;

  if p_qty is not null and p_qty <= 0 then
    raise exception 'จำนวนที่เบิกต้องมากกว่า 0 (เว้นว่างได้ถ้ายังไม่ระบุจำนวน)';
  end if;
  -- ปัดให้เท่า precision ของคอลัมน์ก่อน เพื่อให้การเทียบ "ค่าเปลี่ยนไหม" ข้างล่างตรงกับที่เก็บจริง
  v_qty  := round(p_qty, 3);
  v_unit := nullif(btrim(coalesce(p_qty_unit, '')), '');
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  perform set_config('app.current_profile_id', v_profile::text, true);

  -- ---------- เพิ่มใหม่ ----------
  if p_id is null then
    perform set_config('app.audit_reason',
      'เพิ่มรายการเบิก "' || v_name || '" (' || v_type || ') งาน ' || v_job_no, true);

    insert into public.job_materials (job_id, item_name, item_type, qty, qty_unit, note)
    values (p_job_id, v_name, v_type, v_qty, v_unit, v_note)
    returning id into v_id;

    -- 🧾 แจ้งฝ่ายคลังว่ามีของให้ตรวจแล้วกดสถานะ "พร้อม" (Part F · 0092)
    --    กันใบท่วม: รายการเบิกถูกเพิ่มทีละบรรทัด ถ้ายิงใบละบรรทัดจะได้สิบ ๆ ใบต่อ 1 งาน
    --    ⇒ เขียนหัวข้อแบบรวม แล้วข้ามถ้าเพิ่งยิงใบของงานเดียวกันไปภายใน 10 นาที
    if not exists (
      select 1 from public.notifications n
       where n.kind = 'material_request'
         and n.job_id = p_job_id
         and n.created_at > now() - interval '10 minutes'
    ) then
      perform public.create_notification(
        'material_request',
        'งาน ' || v_job_no || ' มีรายการเบิกวัตถุดิบ/บรรจุภัณฑ์ใหม่',
        'เปิดหน้า "เบิกวัตถุดิบ / บรรจุภัณฑ์" เพื่อตรวจของแล้วกดสถานะเป็น "พร้อม" — ฝ่ายผลิตบันทึกผลผลิตไม่ได้จนกว่าของจะพร้อมครบ',
        p_job_id, v_job_no, 'warehouse'::app_role, null::job_status, null::uuid, true);
    end if;

    return v_id;
  end if;

  -- ---------- แก้ของเดิม ----------
  select * into v_old from public.job_materials where id = p_id;
  if v_old.id is null then
    raise exception 'ไม่พบรายการเบิกที่เลือก';
  end if;
  if v_old.job_id <> p_job_id then
    raise exception 'รายการนี้ไม่ได้อยู่ในงานนี้';
  end if;

  -- แก้ "สาระสำคัญ" หลังฝ่ายคลังกดพร้อมแล้ว → รีเซ็ตกลับเป็นไม่พร้อม ให้คลังตรวจใหม่
  -- (แก้เฉพาะหมายเหตุไม่รีเซ็ต — หมายเหตุไม่กระทบว่าของพร้อมจ่ายหรือไม่)
  v_reset := v_old.status = 'ready'
             and ( v_old.item_name is distinct from v_name
                or v_old.item_type is distinct from v_type
                or v_old.qty       is distinct from v_qty
                or v_old.qty_unit  is distinct from v_unit );

  perform set_config('app.audit_reason',
    'แก้รายการเบิก "' || v_name || '" (' || v_type || ') งาน ' || v_job_no
    || case when v_reset then ' — ข้อมูลเปลี่ยน จึงรีเซ็ตสถานะกลับเป็น "ไม่พร้อม"' else '' end,
    true);

  update public.job_materials
     set item_name         = v_name,
         item_type         = v_type,
         qty               = v_qty,
         qty_unit          = v_unit,
         note              = v_note,
         status            = case when v_reset then 'not_ready' else status end,
         status_changed_by = case when v_reset then null else status_changed_by end,
         status_changed_at = case when v_reset then null else status_changed_at end,
         updated_by        = v_profile
   where id = p_id;

  return p_id;
end;
$fn$;

revoke execute on function public.upsert_job_material(uuid, uuid, text, text, numeric, text, text) from public;
revoke execute on function public.upsert_job_material(uuid, uuid, text, text, numeric, text, text) from anon;
grant  execute on function public.upsert_job_material(uuid, uuid, text, text, numeric, text, text) to authenticated;


-- ------------------------------------------------------------
-- (2) upsert_product — แจ้งฝ่ายผลิตเมื่อมีผลิตภัณฑ์ใหม่
--     🔒 ของเดิมมีแต่ grant to authenticated ⇒ PUBLIC ยังถือ EXECUTE — ปิดให้ที่นี่ (0088:61-62)
-- ------------------------------------------------------------
create or replace function public.upsert_product(
  p_id          uuid,
  p_code        text,
  p_name        text,
  p_unit        text default 'TAB',
  p_reg_no      text default null,
  p_dosage_form text default null,
  p_appearance  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_id      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_products() then
    raise exception 'เฉพาะฝ่ายวางแผน/ฝ่ายคลัง/ผู้บริหารจัดการผลิตภัณฑ์ได้';
  end if;

  p_code := btrim(coalesce(p_code, ''));
  p_name := btrim(coalesce(p_name, ''));
  p_unit := btrim(coalesce(p_unit, ''));

  if p_code = '' then raise exception 'กรุณาระบุรหัสผลิตภัณฑ์ (code)'; end if;
  if p_name = '' then raise exception 'กรุณาระบุชื่อผลิตภัณฑ์'; end if;
  if p_unit = '' then p_unit := 'TAB'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    if exists (select 1 from public.products where code = p_code) then
      raise exception 'รหัสผลิตภัณฑ์ % มีอยู่แล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'เพิ่มผลิตภัณฑ์ ' || p_code, true);
    insert into public.products (code, name, unit, reg_no, dosage_form, appearance, created_by)
    values (p_code, p_name, p_unit,
            nullif(btrim(coalesce(p_reg_no, '')), ''),
            nullif(btrim(coalesce(p_dosage_form, '')), ''),
            nullif(btrim(coalesce(p_appearance, '')), ''),
            v_profile)
    returning id into v_id;

    -- 🧪 แจ้งฝ่ายผลิตว่ามีผลิตภัณฑ์ใหม่ ให้เข้าไปผูก "ขั้นตอนการผลิต (Route)" (Part F · 0092)
    --    ฝ่ายวางแผนแก้ route เองได้แล้วเหมือนกัน (0090) — ใบนี้ไว้ให้ฝ่ายผลิตรับรู้/เข้าไปแก้
    --    job_id/job_no = null เพราะยังไม่ผูกกับงานใด
    perform public.create_notification(
      'product_new',
      'ผลิตภัณฑ์ใหม่ ' || p_code || ' — ' || p_name,
      'ยังไม่มีขั้นตอนการผลิต (Route) · เปิดหน้า "ผลิตภัณฑ์ / ขั้นตอนการผลิต" แล้วกด "แก้ขั้นตอน"',
      null::uuid, null::text, 'production'::app_role, null::job_status, null::uuid, true);
  else
    if not exists (select 1 from public.products where id = p_id) then
      raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
    end if;
    if exists (select 1 from public.products where code = p_code and id <> p_id) then
      raise exception 'รหัสผลิตภัณฑ์ % ถูกใช้กับรายการอื่นแล้ว', p_code;
    end if;
    perform set_config('app.audit_reason', 'แก้ผลิตภัณฑ์ ' || p_code, true);
    update public.products
       set code        = p_code,
           name        = p_name,
           unit        = p_unit,
           reg_no      = nullif(btrim(coalesce(p_reg_no, '')), ''),
           dosage_form = nullif(btrim(coalesce(p_dosage_form, '')), ''),
           appearance  = nullif(btrim(coalesce(p_appearance, '')), ''),
           updated_by  = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.upsert_product(uuid, text, text, text, text, text, text) from public;
revoke execute on function public.upsert_product(uuid, text, text, text, text, text, text) from anon;
grant  execute on function public.upsert_product(uuid, text, text, text, text, text, text) to authenticated;


-- ------------------------------------------------------------
-- (3)+(5) add_production_record — ด่านความพร้อมวัตถุดิบ + แจ้งลูกน้อง QC
-- ------------------------------------------------------------
create or replace function public.add_production_record(
  p_job_id       uuid,
  p_job_route_id uuid,
  p_input        numeric,
  p_output       numeric,
  p_loss         numeric     default 0,
  p_minutes      numeric     default null,
  p_record_date  date        default current_date,
  p_note         text        default null,
  p_client_id    uuid        default null,
  p_machine_id   uuid        default null,
  p_headcount    integer     default null,
  p_shift        work_shift  default null,
  p_period       work_period default null,
  p_input_unit   text        default null,
  p_output_unit  text        default null,
  p_loss_unit    text        default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile    uuid;
  v_status     job_status;
  v_loss       numeric := coalesce(p_loss, 0);
  v_id         uuid;
  v_mc         record;
  v_station_id uuid;
  v_st_name    text;
  v_route_job  uuid;
  v_mc_count   int;
  -- 0086
  v_job_no     text;
  v_step       integer;
  v_is_pack    boolean;
  v_new        boolean;
  v_prev       int;
  v_pack_step  integer;
  v_missing    text[] := '{}';
  -- Part F (0092)
  v_mat_total   int;
  v_mat_missing int;
  v_qc          record;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  if not (public.has_role('production')
          or public.has_role('production_lead')
          or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณบันทึกผลผลิตไม่ได้ (เฉพาะฝ่ายผลิต/ผู้บริหาร)';
  end if;

  -- idempotency
  if p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  select status into v_status from public.jobs where id = p_job_id for update;
  if v_status is null then raise exception 'ไม่พบงานนี้'; end if;
  if v_status <> 'in_production' then
    raise exception 'บันทึกผลผลิตได้เฉพาะงานที่กำลังผลิตอยู่ (สถานะปัจจุบัน: %)', v_status;
  end if;

  -- ขั้นตอน → สถานี (station_id มาจาก route ไม่ให้ผู้ใช้เลือกเองแล้ว)
  if p_job_route_id is null then raise exception 'กรุณาเลือกขั้นตอนการผลิต'; end if;
  select jr.job_id, jr.station_id, s.name, jr.step_no, s.is_packing
    into v_route_job, v_station_id, v_st_name, v_step, v_is_pack
    from public.job_routes jr
    join public.stations s on s.id = jr.station_id
   where jr.id = p_job_route_id;
  if v_station_id is null then raise exception 'ไม่พบขั้นตอนการผลิตที่เลือก'; end if;
  if v_route_job <> p_job_id then
    raise exception 'ขั้นตอนการผลิตนี้ไม่ใช่ของงานที่เลือก';
  end if;

  -- เครื่องจักร (ถ้าระบุ)
  if p_machine_id is not null then
    select id, code, status, is_active into v_mc
      from public.machines where id = p_machine_id;
    if v_mc.id is null then raise exception 'ไม่พบเครื่องจักรที่เลือก'; end if;
    if not v_mc.is_active then raise exception 'เครื่อง % ถูกปิดใช้งานแล้ว เลือกไม่ได้', v_mc.code; end if;
    if v_mc.status in ('maintenance', 'calibration_due') then
      raise exception 'เครื่อง % อยู่สถานะซ่อม/ถึงกำหนดสอบเทียบ — เริ่มงานบนเครื่องนี้ไม่ได้', v_mc.code;
    end if;
    if not exists (
      select 1 from public.job_route_machines
       where job_route_id = p_job_route_id and machine_id = p_machine_id
    ) then
      raise exception 'เครื่อง % ไม่ได้ถูกเลือกไว้ในขั้นตอนนี้', v_mc.code;
    end if;
  end if;

  -- ---------- GATE Line Clearance (0062) — กั้นรายสถานี/เครื่อง ----------
  select count(*) into v_mc_count
    from public.job_route_machines where job_route_id = p_job_route_id;

  -- ไม่มีเครื่องผูกไว้เลย = ทำ LC ไม่ได้ → ไม่กั้น (กันล็อกตายจนบันทึกอะไรไม่ได้)
  if v_mc_count > 0 then
    if p_machine_id is not null then
      if not public.line_clearance_passed(p_job_route_id, p_machine_id) then
        raise exception
          'บันทึกผลผลิตไม่ได้ — เครื่อง % ที่สถานี "%" ยังไม่ผ่าน Line Clearance (ต้องมีหัวหน้าฝ่ายผลิตยืนยัน)',
          v_mc.code, v_st_name;
      end if;
    elsif not exists (
      select 1
        from public.job_route_machines jrm
       where jrm.job_route_id = p_job_route_id
         and public.line_clearance_passed(p_job_route_id, jrm.machine_id)
    ) then
      raise exception
        'บันทึกผลผลิตไม่ได้ — สถานี "%" ยังไม่มีเครื่องไหนผ่าน Line Clearance เลย', v_st_name;
    end if;
  end if;

  -- ---------- GATE ความพร้อมวัตถุดิบ/บรรจุภัณฑ์ (Part F · 0092) ----------
  --   ทีมตัดสินใจ: ต้องมีรายการเบิกอย่างน้อย 1 รายการ และฝ่ายคลังกดเป็น "พร้อม" ครบทุกรายการ
  --   จึงจะบันทึกผลผลิตรายวันได้ (เดิมสถานะพร้อม/ไม่พร้อมเป็นแค่ป้าย ไม่กั้นอะไรเลย — 0056:21-22)
  --   ⚠️ upsert_job_material รีเซ็ต ready → not_ready เองเมื่อแก้สาระสำคัญของรายการ (0056:237-241)
  --      ⇒ แก้บรรทัดเบิกกลางงาน = ต้องให้คลังกดพร้อมใหม่ก่อนบันทึกต่อ (ตั้งใจตามแนว GMP)
  select count(*) into v_mat_total
    from public.job_materials where job_id = p_job_id;
  if v_mat_total = 0 then
    raise exception
      'บันทึกผลผลิตไม่ได้ — งานนี้ยังไม่มีรายการเบิกวัตถุดิบ/บรรจุภัณฑ์ (ต้องลงรายการอย่างน้อย 1 รายการ แล้วให้ฝ่ายคลังกด "พร้อม")';
  end if;

  select count(*) into v_mat_missing
    from public.job_materials where job_id = p_job_id and status <> 'ready';
  if v_mat_missing > 0 then
    raise exception
      'บันทึกผลผลิตไม่ได้ — ยังมีวัตถุดิบ/บรรจุภัณฑ์ที่ฝ่ายคลังยังไม่กดเป็น "พร้อม" อีก % รายการ',
      v_mat_missing;
  end if;

  -- validation
  if p_input is null or p_input < 0 then
    raise exception 'ยอดที่ต้องการจำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if p_output is null or p_output < 0 then
    raise exception 'ยอดผลิตได้ (output) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if v_loss < 0 then raise exception 'ของเสีย (loss) ห้ามติดลบ'; end if;
  if p_minutes is not null and (p_minutes < 0 or p_minutes > 1440) then
    raise exception 'นาทีทำงานต้องอยู่ระหว่าง 0–1440 (24 ชั่วโมง)';
  end if;
  if p_headcount is not null and p_headcount < 1 then
    raise exception 'จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
  end if;
  if p_output > p_input then
    raise exception 'ยอดผลิตได้ (%) มากกว่ายอดที่ต้องการ (%) ไม่ได้', p_output, p_input;
  end if;
  if (p_output + v_loss) > p_input then
    raise exception 'ผลิตได้ + ของเสีย (%) มากกว่ายอดที่ต้องการ (%) ไม่ได้', (p_output + v_loss), p_input;
  end if;
  if p_record_date > current_date then
    raise exception 'วันที่บันทึกเป็นวันในอนาคตไม่ได้';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกผลผลิต ' || v_st_name, true);

  insert into public.production_records
    (job_id, job_route_id, station_id, record_date,
     input_qty, output_qty, loss_qty, minutes,
     input_unit, output_unit, loss_unit, shift, work_period,
     operator_id, note, created_by, client_id, machine_id, headcount)
  values
    (p_job_id, p_job_route_id, v_station_id, p_record_date,
     p_input, p_output, v_loss, p_minutes,
     nullif(btrim(coalesce(p_input_unit, '')), ''),
     nullif(btrim(coalesce(p_output_unit, '')), ''),
     nullif(btrim(coalesce(p_loss_unit, '')), ''),
     p_shift, p_period,
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile, p_client_id,
     p_machine_id, p_headcount)
  on conflict (client_id) do nothing
  returning id into v_id;

  -- v_id เป็น null = ชนกับ client_id เดิม (ยิงซ้ำจากหน้าจอ) ⇒ ไม่ใช่แถวใหม่ ห้ามแจ้งเตือนซ้ำ
  v_new := v_id is not null;
  if v_id is null and p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
  end if;

  if v_new then
    select job_no into v_job_no from public.jobs where id = p_job_id;

    -- ---------- (ก) ⏳ รอหัวหน้าฝ่ายผลิตอนุมัติ (0080 ตั้งให้เป็นผู้อนุมัติตัวจริง) ----------
    --   skip_creator = true — คนบันทึกอนุมัติของตัวเองไม่ได้อยู่แล้ว (0080:126-129)
    perform public.create_notification(
      'approval_request',
      'บันทึกผลผลิต ' || to_char(p_record_date, 'DD/MM/YYYY') || ' งาน '
        || coalesce(v_job_no, '') || ' รอหัวหน้าอนุมัติ',
      'สถานี ' || v_st_name || ' · ผลิตได้ ' || p_output
        || coalesce(' ' || nullif(btrim(coalesce(p_output_unit, '')), ''), ''),
      p_job_id, v_job_no, 'production_lead'::app_role, null::job_status, null::uuid, true);

    -- ---------- (ข) 🏭 งานเข้าสถานี ----------
    --   ระบบไม่มีคอลัมน์ "สถานีปัจจุบัน" และไม่มีสถานะ "แพ็ค" ใน job_status (เหตุผล 0081:14-18)
    --   ⇒ ใช้นิยามเดียวกับแดชบอร์ด: ดูจากบันทึกผลผลิตที่ไม่ถูกตีกลับ (0081:166-171)
    --   "เข้าสถานี" = บันทึกใบแรกของขั้นตอนนั้น (ก่อนหน้านี้ยังไม่มีใบไหนเลย)
    select count(*) into v_prev
      from public.production_records
     where job_route_id = p_job_route_id and status <> 'rejected' and id <> v_id;

    if v_prev = 0 then
      -- 🚨 สถานีบรรจุไม่ต้องแจ้ง — ทีมระบุชัดใน requirement ว่า "ไม่ต้องแจ้งเตือน: งานเข้าสถานีบรรจุ"
      --    (ของที่ต้องแจ้งของฝั่งบรรจุคือ "พร้อมเข้าสถานีแพ็ค" ในข้อ (ค) ซึ่งมาก่อนหน้า 1 ขั้น)
      if not coalesce(v_is_pack, false) then
        perform public.create_notification(
          'station',
          'งาน ' || coalesce(v_job_no, '') || ' เข้าสถานี ' || v_st_name || ' แล้ว',
          'ขั้นตอนที่ ' || v_step,
          p_job_id, v_job_no, 'production'::app_role, null::job_status, null::uuid, true);
      end if;

      -- ---------- (ค) 📦 พร้อมเข้าสถานีแพ็ค ----------
      --   ยิงเมื่อขั้นตอนที่เพิ่งเริ่มบันทึก คือขั้น "ก่อนหน้าสถานีแพ็คตัวแรก" ของ route งานนี้
      --   (อยู่ในบล็อก v_prev = 0 ⇒ ยิงครั้งเดียวตอนเข้าขั้นนั้น ไม่ยิงซ้ำทุกใบ)
      select min(jr.step_no) into v_pack_step
        from public.job_routes jr
        join public.stations s on s.id = jr.station_id
       where jr.job_id = p_job_id and s.is_packing;

      if v_pack_step is not null
         and v_step = (select max(jr2.step_no) from public.job_routes jr2
                        where jr2.job_id = p_job_id and jr2.step_no < v_pack_step) then
        perform public.create_notification(
          'station',
          'งาน ' || coalesce(v_job_no, '') || ' ใกล้พร้อมเข้าสถานีแพ็ค',
          'กำลังทำขั้นตอนสุดท้ายก่อนบรรจุ (' || v_st_name || ')',
          p_job_id, v_job_no, 'production'::app_role, null::job_status, null::uuid, true);
      end if;
    end if;

    -- ---------- (ง) 📋 ข้อมูลสำคัญหาย ----------
    --   ระบบไม่มีคอลัมน์ "เวลาเริ่ม/เวลาสิ้นสุด" — เก็บเป็น กะ + ช่วง + จำนวนนาที แทน
    --   และ "ผู้ปฏิบัติงาน" เก็บเป็นตัวเลข headcount (จำนวนคน) ไม่ใช่รายชื่อ
    --   ⇒ เช็กจากช่องที่มีอยู่จริงตามที่ตกลงกับผู้ใช้
    --   ยอดผลิตได้ (output) บังคับกรอกใน validation ด้านบนอยู่แล้ว จึงไม่มีทางหาย
    --   ⚠️ เช็กเครื่องจักรเฉพาะขั้นตอนที่ "มีเครื่องผูกไว้" (v_mc_count > 0)
    --      ไม่งั้นขั้นตอนที่ไม่ใช้เครื่องจะโดนเตือนทุกใบ
    --   skip_creator = false — คนกรอกคือคนที่ต้องกลับมาเติมให้ครบ
    if v_mc_count > 0 and p_machine_id is null then
      v_missing := array_append(v_missing, 'เครื่องจักร');
    end if;
    if p_headcount is null then v_missing := array_append(v_missing, 'จำนวนผู้ปฏิบัติงาน'); end if;
    if p_minutes   is null then v_missing := array_append(v_missing, 'เวลาที่ใช้ (นาที)');    end if;
    if p_shift     is null then v_missing := array_append(v_missing, 'กะ');                  end if;
    if p_period    is null then v_missing := array_append(v_missing, 'ช่วงเวลา (ปกติ/OT)');   end if;

    if array_length(v_missing, 1) > 0 then
      perform public.create_notification(
        'missing_data',
        'บันทึกผลผลิต ' || to_char(p_record_date, 'DD/MM/YYYY') || ' งาน '
          || coalesce(v_job_no, '') || ' กรอกไม่ครบ',
        'สถานี ' || v_st_name || ' · ยังไม่ได้ระบุ: ' || array_to_string(v_missing, ', '),
        p_job_id, v_job_no, 'production'::app_role, null::job_status, null::uuid, false);
    end if;

    -- ---------- (จ) 🔬 แจ้ง "ลูกน้อง QC" ให้เปิดตรวจระหว่างผลิต (Part F · 0092) ----------
    --   🔑 ใช้ target_role = 'qc' ไม่ได้ — has_role('qc') ให้ qc_lead ผ่านด้วย (0078:64-66)
    --      และ RLS เปิดให้ manager เห็นทุกแถว (0084:154)
    --      ⇒ "เฉพาะลูกน้อง" ทำได้ทางเดียวคือจ่าหน้ารายบุคคล (target_profile_id)
    --   🎁 ใบที่จ่าหน้าถึงตัวบุคคล ผู้บริหาร/แอดมินมองไม่เห็นโดยออกแบบอยู่แล้ว (0084:50-51)
    --   ปริมาณ: 1 บันทึก × จำนวนคน QC — รอบล้าง 7 วัน (0091) คุมปริมาณให้แล้ว
    for v_qc in
      select p.id
        from public.profiles p
        join public.user_roles ur on ur.profile_id = p.id and ur.role = 'qc'
       where p.is_active
         and p.deleted_at is null
         and not exists (
           select 1 from public.user_roles l
            where l.profile_id = p.id
              and l.role in ('qc_lead', 'manager', 'admin')
         )
    loop
      perform public.create_notification(
        'qc_due',
        'งาน ' || coalesce(v_job_no, '') || ' มีบันทึกผลผลิตใหม่ — รอตรวจระหว่างผลิต',
        'สถานี ' || v_st_name || ' · วันที่ ' || to_char(p_record_date, 'DD/MM/YYYY')
          || ' · เปิด "ตรวจระหว่างผลิต (In-process QC)" ของบันทึกใบนี้',
        p_job_id, v_job_no, null::app_role, null::job_status, v_qc.id, false);
    end loop;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) from public;
revoke execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) from anon;
grant  execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) to authenticated;


-- ------------------------------------------------------------
-- (4) notify_machine_due — เครื่องจักรใกล้/เลยกำหนดสอบเทียบ · ซ่อมบำรุง
--
-- เกณฑ์ "ใกล้ครบ" = 7 วัน ให้ตรงกับป้าย DueBadge ที่หน้าเครื่องจักรใช้อยู่
-- (web/app/(app)/machines/machines-view.tsx) · รวมใบที่เลยกำหนดไปแล้วด้วย
--
-- 🔑 กันเตือนซ้ำทุกวันโดยไม่ต้องเพิ่มคอลัมน์:
--    หัวข้อใส่ "วันครบกำหนดจริง" (ไม่ใช่ "เหลือ N วัน") ⇒ หัวข้อคงที่
--    แล้วข้ามถ้ามีใบ machine_due หัวข้อเดียวกันภายใน 7 วันล่าสุด
--    ⇒ ได้จังหวะเตือนซ้ำสัปดาห์ละครั้ง พอดีกับรอบล้างของ 0091
--    (พอเลยกำหนด หัวข้อเปลี่ยนเป็น "เลยกำหนด" → ยิงใหม่อีกครั้ง = ถูกต้อง)
--
-- 🔒 ไม่ grant ให้ authenticated — เรียกโดย pg_cron (0094) หรือรันมือใน SQL Editor
-- ------------------------------------------------------------
create or replace function public.notify_machine_due(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_days  int := greatest(coalesce(p_days, 7), 0);
  v_n     int := 0;
  v_m     record;
  v_title text;
  v_body  text;
begin
  for v_m in
    select x.code, x.name, x.room, x.kind, x.due
      from (
        select m.code, m.name, m.room,
               'สอบเทียบ'::text as kind, m.next_calibration_date as due
          from public.machines m
         where m.is_active and m.next_calibration_date is not null
        union all
        select m.code, m.name, m.room,
               'ซ่อมบำรุง'::text, m.next_maintenance_date
          from public.machines m
         where m.is_active and m.next_maintenance_date is not null
      ) x
     where x.due <= current_date + v_days
     order by x.due
  loop
    if v_m.due < current_date then
      v_title := 'เครื่อง ' || v_m.code || ' เลยกำหนด' || v_m.kind || ' ('
                 || to_char(v_m.due, 'DD/MM/YYYY') || ')';
      v_body  := v_m.name || coalesce(' · ห้อง ' || v_m.room, '')
                 || ' · เลยกำหนดมาแล้ว ' || (current_date - v_m.due) || ' วัน';
    else
      v_title := 'เครื่อง ' || v_m.code || ' ถึงกำหนด' || v_m.kind || ' '
                 || to_char(v_m.due, 'DD/MM/YYYY');
      v_body  := v_m.name || coalesce(' · ห้อง ' || v_m.room, '')
                 || ' · ' || case when v_m.due = current_date
                                  then 'ครบกำหนดวันนี้'
                                  else 'อีก ' || (v_m.due - current_date) || ' วัน' end;
    end if;

    if not exists (
      select 1 from public.notifications n
       where n.kind = 'machine_due'
         and n.title = v_title
         and n.created_at > now() - interval '7 days'
    ) then
      perform public.create_notification(
        'machine_due', v_title, v_body,
        null::uuid, null::text, 'engineering'::app_role, null::job_status, null::uuid, false);
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$fn$;

revoke execute on function public.notify_machine_due(integer) from public;
revoke execute on function public.notify_machine_due(integer) from anon;
revoke execute on function public.notify_machine_due(integer) from authenticated;

comment on function public.notify_machine_due(integer) is
  'แจ้งฝ่ายวิศวกรรมเมื่อเครื่องจักรใกล้/เลยกำหนดสอบเทียบหรือซ่อมบำรุง (ค่าเริ่มต้น 7 วัน) — เรียกโดย pg_cron (0094) · คืนจำนวนใบที่สร้าง';


-- ============================================================
-- ✅ ตรวจหลัง paste
--   select proname from pg_proc where proname = 'notify_machine_due';          -- 1 แถว
--   select prosrc like '%material_request%' from pg_proc where proname = 'upsert_job_material';    -- true
--   select prosrc like '%product_new%'      from pg_proc where proname = 'upsert_product';         -- true
--   select prosrc like '%qc_due%'           from pg_proc where proname = 'add_production_record';  -- true
--   select prosrc like '%job_materials%'    from pg_proc where proname = 'add_production_record';  -- true
--
--   -- ทดลองยิงใบเครื่องจักรด้วยมือ (รันซ้ำครั้งที่ 2 ต้องได้ 0 = ไม่ยิงซ้ำ)
--   select public.notify_machine_due(7);
--
-- ⚠️ ก่อนใช้งานจริง — ด่านวัตถุดิบมีผลกับ "ทุกงาน" ทันที
--   ดูว่างานที่กำลังผลิตอยู่ตอนนี้จะติดกี่ใบ:
--     select j.job_no,
--            count(jm.id)                                   as รายการเบิก,
--            count(jm.id) filter (where jm.status <> 'ready') as ยังไม่พร้อม
--       from public.jobs j
--       left join public.job_materials jm on jm.job_id = j.id
--      where j.status = 'in_production'
--      group by j.job_no
--     having count(jm.id) = 0 or count(jm.id) filter (where jm.status <> 'ready') > 0
--      order by j.job_no;
-- ============================================================
