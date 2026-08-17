-- ============================================================
-- PD Monitor — Part 2.1 ก้อน 3 / 0046_lot_status_simplify.sql
-- สถานะล็อตเหลือ 2 ค่า + สิทธิ์ตั้งสถานะเป็นของฝ่ายวางแผน
--
--   (1) แปลงข้อมูลเก่า 6 ค่า → 2 ค่า (available = พร้อมใช้ · quarantine = ไม่พร้อมใช้)
--   (2) can_set_lot_status() — ฝ่ายวางแผน/ผู้บริหาร (แพตเทิร์นเดียวกับ can_set_machine_schedule 0039)
--   (3) upsert_product_lot — drop เก่า → สร้างใหม่ + field-level guard บนช่องสถานะ
--   (4) request_material  — เปลี่ยนด่านเป็น whitelist (เบิกได้เฉพาะ available)
--   (5) issue_requisition — ให้สอดคล้องกัน (จ่ายได้เฉพาะ available)
--
-- ⚠️ ข้อ (1) ย้อนกลับไม่ได้ — ล็อตที่ QC เคยตีตก 'rejected' จะกลายเป็น 'quarantine'
--    แยกจากของที่แค่ "ยังไม่ปล่อยใช้" ไม่ได้อีก (ร่องรอยเดิมยังอยู่ใน audit_log)
--    👉 แนะนำ export เก็บไว้ก่อนรัน:
--       select id, lot_no, status from public.material_lots order by lot_no;
-- ⚠️ ไม่แตะ enum material_lot_status — Postgres ลบค่า enum ทิ้งไม่ได้
--    4 ค่าที่เหลือ (released/testing/rejected/expired) กลายเป็นค่าที่ไม่มีใครเขียนแล้ว
-- ⚠️ ด่าน "กันของหมดอายุ" ยังใช้ expiry_date เหมือนเดิม ไม่เกี่ยวกับ status
--    → การเรียง FEFO + กล่องเตือนใกล้หมดอายุ ไม่ได้รับผลกระทบ
-- รัน "หลัง" 0001–0045
-- ============================================================

-- ------------------------------------------------------------
-- (1) แปลงข้อมูลเก่าให้เหลือ 2 ค่าจริง
--     เขียน audit reason ไว้ให้ตามรอยได้ว่าแถวไหนถูกแปลงเพราะอะไร
-- ------------------------------------------------------------
select set_config('app.audit_reason',
  'Part 2.1: ยุบสถานะล็อตเหลือ พร้อมใช้/ไม่พร้อมใช้', true);

update public.material_lots
   set status = 'available'
 where status = 'released';

update public.material_lots
   set status = 'quarantine'
 where status in ('testing', 'rejected', 'expired');

-- ------------------------------------------------------------
-- (2) can_set_lot_status — ใครกดเปลี่ยน "พร้อมใช้ / ไม่พร้อมใช้" ได้
--     ฝ่ายคลังยังเป็นคนเพิ่ม/แก้ล็อต แต่ปลดสถานะเป็นหน้าที่ฝ่ายวางแผน
-- ------------------------------------------------------------
create or replace function public.can_set_lot_status()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('planner') or public.has_role('manager');
$$;

grant execute on function public.can_set_lot_status() to authenticated;

comment on function public.can_set_lot_status() is
  'สิทธิ์ตั้งสถานะล็อต (พร้อมใช้/ไม่พร้อมใช้) = วางแผน/ผู้บริหาร — ต้องตรงกับ canSetLotStatus() ใน web/lib/data/role-access.ts';

-- ------------------------------------------------------------
-- (3) upsert_product_lot — body ยกจาก 0042:96-170
--     เพิ่ม field-level guard: ไม่ใช่ฝ่ายวางแผน/ผู้บริหาร →
--       เพิ่มใหม่ = บังคับ 'quarantine' (ไม่พร้อมใช้) · แก้ของเดิม = คงค่าเดิมไว้
--     กันที่ DB ไม่ใช่แค่ซ่อนช่องบนจอ (แพตเทิร์นเดียวกับ upsert_machine ใน 0039)
--
--     signature เท่าเดิมทุกตัว → create or replace ได้เลย ไม่ต้อง drop
--     (ไม่มีพารามิเตอร์เพิ่ม/ลด จึงไม่เกิด overload ซ้อน)
-- ------------------------------------------------------------
create or replace function public.upsert_product_lot(
  p_id            uuid,
  p_product_id    uuid,
  p_lot_no        text,
  p_qty           numeric,
  p_status        material_lot_status default 'quarantine',
  p_received_date date                default null,
  p_expiry_date   date                default null,
  p_note          text                default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_id      uuid;
  v_status  material_lot_status;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_materials() then
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารจัดการคลังผลิตภัณฑ์ได้';
  end if;

  p_lot_no := btrim(coalesce(p_lot_no, ''));
  if p_product_id is null
     or not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
  end if;
  if p_lot_no = '' then raise exception 'กรุณาระบุเลขล็อต (lot)'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'จำนวนคงเหลือห้ามติดลบ'; end if;
  if p_expiry_date is not null and p_received_date is not null
     and p_expiry_date < p_received_date then
    raise exception 'วันหมดอายุต้องไม่ก่อนวันรับเข้า';
  end if;

  -- สถานะรับได้แค่ 2 ค่าแล้ว (Part 2.1)
  -- ตรวจเฉพาะคนที่มีสิทธิ์ตั้งสถานะ — คนอื่นค่าที่ส่งมาจะถูกแทนที่อยู่ดี (guard ด้านล่าง)
  -- ถ้าตรวจก่อน override จะกลายเป็นว่าล็อตค่าเก่าที่หลุดรอดการแปลง แก้ไม่ได้เลย
  v_status := coalesce(p_status, 'quarantine');
  if public.can_set_lot_status() and v_status not in ('available', 'quarantine') then
    raise exception 'สถานะล็อตต้องเป็น พร้อมใช้ หรือ ไม่พร้อมใช้ เท่านั้น';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'จัดการล็อตผลิตภัณฑ์ ' || p_lot_no, true);

  if p_id is null then
    if exists (select 1 from public.material_lots
                where product_id = p_product_id and lot_no = p_lot_no) then
      raise exception 'ล็อต % ของผลิตภัณฑ์นี้มีอยู่แล้ว', p_lot_no;
    end if;

    -- field-level guard: คนที่ไม่ใช่ฝ่ายวางแผน/ผู้บริหาร เพิ่มล็อตได้แต่ตั้งสถานะไม่ได้
    if not public.can_set_lot_status() then
      v_status := 'quarantine';
    end if;

    insert into public.material_lots
      (product_id, lot_no, qty_on_hand, status, received_date, expiry_date, note, created_by)
    values
      (p_product_id, p_lot_no, p_qty, v_status,
       p_received_date, p_expiry_date, nullif(btrim(coalesce(p_note, '')), ''), v_profile)
    returning id into v_id;
  else
    if not exists (select 1 from public.material_lots where id = p_id) then
      raise exception 'ไม่พบล็อตที่เลือก';
    end if;
    if exists (select 1 from public.material_lots
                where product_id = p_product_id and lot_no = p_lot_no and id <> p_id) then
      raise exception 'ล็อต % ของผลิตภัณฑ์นี้ซ้ำกับล็อตอื่น', p_lot_no;
    end if;

    -- field-level guard: แก้ของเดิม = คงสถานะเดิมไว้ ห้ามให้ค่าที่ส่งมาทับ
    if not public.can_set_lot_status() then
      select status into v_status from public.material_lots where id = p_id;
    end if;

    update public.material_lots
       set lot_no = p_lot_no, qty_on_hand = p_qty,
           status = v_status,
           received_date = p_received_date, expiry_date = p_expiry_date,
           note = nullif(btrim(coalesce(p_note, '')), ''), updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_product_lot(
  uuid, uuid, text, numeric, material_lot_status, date, date, text
) to authenticated;

-- ------------------------------------------------------------
-- (4) request_material — body ยกจาก 0043:20-73 ทั้งดุ้น
--     เปลี่ยนจุดเดียว: ด่านล็อตจาก blacklist (rejected/expired) → whitelist (available)
--
--     เหตุผล: หลังยุบสถานะแล้ว 'quarantine' = "ไม่พร้อมใช้" ถ้ายังใช้ blacklist เดิม
--     จะขอเบิกล็อตที่ยังไม่ปล่อยได้ แล้วไปตายตอนคลังกดจ่าย — สับสนและเสียเวลา
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
    raise exception 'สิทธิ์ของคุณเบิกผลิตภัณฑ์ไม่ได้ (เฉพาะฝ่ายผลิต/คลัง/ผู้บริหาร)';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานนี้'; end if;
  -- เบิกได้เฉพาะช่วงก่อนส่ง QC (รอแจ้งผลิต/มีแผนแล้ว/กำลังผลิต)
  if v_status not in ('pending_announce', 'planned', 'in_production') then
    raise exception 'เบิกผลิตภัณฑ์ได้เฉพาะช่วงก่อนส่ง QC (รอแจ้งผลิต/มีแผนแล้ว/กำลังผลิต) — สถานะปัจจุบัน: %', v_status;
  end if;

  select id, status, expiry_date into v_lot
    from public.material_lots where id = p_material_lot_id;
  if v_lot.id is null then raise exception 'ไม่พบล็อตผลิตภัณฑ์ที่เลือก'; end if;
  if v_lot.status <> 'available' then
    raise exception 'ล็อตนี้ยังไม่พร้อมใช้ — ให้ฝ่ายวางแผนกดเปลี่ยนสถานะเป็น "พร้อมใช้" ก่อน';
  end if;
  if v_lot.expiry_date is not null and v_lot.expiry_date < current_date then
    raise exception 'ล็อตนี้หมดอายุแล้ว เบิกไม่ได้';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนที่เบิกต้องมากกว่า 0'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ขอเบิกผลิตภัณฑ์', true);

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
-- (5) issue_requisition — body ยกจาก 0043:83-133 ทั้งดุ้น
--     เปลี่ยนจุดเดียว: not in ('available','released') → <> 'available'
--     (ด่านล็อกใบเบิก/ล็อต · กันหมดอายุ · กันสต็อกไม่พอ · ตัดสต็อก คงเดิมครบ)
-- ------------------------------------------------------------
create or replace function public.issue_requisition(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_req     record;
  v_lot     record;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_materials() then
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารจ่ายผลิตภัณฑ์ได้';
  end if;

  -- ล็อกใบเบิก
  select id, material_lot_id, qty, status into v_req
    from public.material_requisitions where id = p_id for update;
  if v_req.id is null then raise exception 'ไม่พบใบเบิกนี้'; end if;
  if v_req.status <> 'requested' then
    raise exception 'ใบเบิกนี้สถานะ % จ่ายซ้ำไม่ได้', v_req.status;
  end if;

  -- ล็อกล็อต + ตรวจความพร้อม
  select id, status, qty_on_hand, expiry_date into v_lot
    from public.material_lots where id = v_req.material_lot_id for update;
  if v_lot.id is null then raise exception 'ไม่พบล็อตผลิตภัณฑ์'; end if;
  if v_lot.status <> 'available' then
    raise exception 'ล็อตนี้ยังไม่พร้อมใช้ จ่ายไม่ได้ — ให้ฝ่ายวางแผนกดเปลี่ยนสถานะก่อน';
  end if;
  if v_lot.expiry_date is not null and v_lot.expiry_date < current_date then
    raise exception 'ล็อตนี้หมดอายุแล้ว จ่ายไม่ได้';
  end if;
  if v_req.qty > v_lot.qty_on_hand then
    raise exception 'สต็อกไม่พอ (คงเหลือ % · ขอเบิก %)', v_lot.qty_on_hand, v_req.qty;
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'จ่ายผลิตภัณฑ์ตามใบเบิก', true);

  -- ตัดสต็อก
  update public.material_lots
     set qty_on_hand = qty_on_hand - v_req.qty, updated_by = v_profile
   where id = v_lot.id;

  -- ปิดใบเบิก = จ่ายแล้ว
  update public.material_requisitions
     set status = 'issued', issued_by = v_profile, issued_at = now(), updated_by = v_profile
   where id = p_id;
end;
$$;

grant execute on function public.issue_requisition(uuid) to authenticated;

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   select status, count(*) from public.material_lots group by status;
--   -- ต้องเหลือแค่ available / quarantine
--
--   -- ล็อตที่ยังไม่พร้อมใช้ (คลังต้องรอฝ่ายวางแผนปลด)
--   select p.code, l.lot_no, l.qty_on_hand
--     from public.material_lots l join public.products p on p.id = l.product_id
--    where l.status = 'quarantine' and l.qty_on_hand > 0 order by p.code, l.lot_no;
-- ============================================================
