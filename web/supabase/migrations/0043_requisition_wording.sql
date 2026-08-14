-- ============================================================
-- PD Monitor — Part 2 ก้อน 4 / 0043_requisition_wording.sql
-- เปลี่ยนคำเรียกในระบบเบิกจาก "วัตถุดิบ" → "ผลิตภัณฑ์"
--
--   ตั้งแต่ 0042 ล็อตผูกกับ products แล้ว (ยา · RM · PM อยู่ทะเบียนเดียวกัน)
--   ข้อความ error ของ 3 ฟังก์ชันนี้เด้งขึ้นหน้าจอผู้ใช้ตรงๆ จึงต้องแก้ให้ตรงคำที่ทีมใช้
--
-- ⚠️ ไม่เปลี่ยน signature ทั้ง 3 ตัว → create or replace ได้เลย ไม่ต้อง drop
-- ⚠️ ไม่แตะตรรกะ/ด่านกั้นใดๆ — ยกบอดี้เดิมมาครบ เปลี่ยนเฉพาะข้อความไทย
--      request_material    ← 0034:275-330 (เวอร์ชันล่าสุด มี allowlist สถานะงาน)
--      issue_requisition   ← 0017:112-166
--      cancel_requisition  ← 0017:171-203
-- รัน "หลัง" 0001–0042
-- ============================================================

-- ------------------------------------------------------------
-- (1) request_material — ขอเบิก (ฝ่ายผลิต/คลัง/ผู้บริหาร)
--     ด่านเดิมครบ: งานต้องอยู่ก่อนส่ง QC · ล็อตไม่ใช่ rejected/expired · ไม่หมดอายุ · qty > 0
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
  if v_lot.status in ('rejected', 'expired') then
    raise exception 'ล็อตนี้สถานะ % เบิกไม่ได้', v_lot.status;
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
-- (2) issue_requisition — จ่ายของ (ฝ่ายคลัง/ผู้บริหาร) · ตัดสต็อกล็อต (atomic)
--     ด่านเดิมครบ: ใบเบิกต้องยังไม่จ่าย · ล็อตต้อง available/released · ไม่หมดอายุ · สต็อกพอ
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
  if v_lot.status not in ('available', 'released') then
    raise exception 'ล็อตนี้สถานะ % (ยังไม่ปล่อยใช้) จ่ายไม่ได้', v_lot.status;
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

-- ------------------------------------------------------------
-- (3) cancel_requisition — ยกเลิกใบเบิก (ผู้ขอ หรือ คลัง/ผู้บริหาร) · เฉพาะที่ยังไม่จ่าย
-- ------------------------------------------------------------
create or replace function public.cancel_requisition(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_req     record;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  select id, status, requested_by into v_req
    from public.material_requisitions where id = p_id for update;
  if v_req.id is null then raise exception 'ไม่พบใบเบิกนี้'; end if;
  if v_req.status <> 'requested' then
    raise exception 'ยกเลิกได้เฉพาะใบเบิกที่ยังไม่จ่าย';
  end if;
  if not (v_req.requested_by = v_profile or public.can_manage_materials()) then
    raise exception 'เฉพาะผู้ขอเบิก หรือฝ่ายคลัง/ผู้บริหาร ยกเลิกได้';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ยกเลิกใบเบิกผลิตภัณฑ์', true);

  update public.material_requisitions
     set status = 'cancelled', updated_by = v_profile
   where id = p_id;
end;
$$;

grant execute on function public.cancel_requisition(uuid) to authenticated;

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   -- ทั้ง 3 ตัวต้องมีตัวละ 1 signature เท่านั้น
--   select p.oid::regprocedure from pg_proc p
--    where p.proname in ('request_material','issue_requisition','cancel_requisition');
-- ============================================================
