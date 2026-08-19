-- ============================================================
-- PD Monitor — Part 3 ก้อน 5 / 0051_lot_status_by_planner.sql
-- ฝ่ายวางแผนกดปลดสถานะล็อตเองได้ — แก้ให้ตรงกับดีไซน์ที่ Part 2.1 ตั้งใจไว้
--
--   0046 ตั้งใจให้ "ฝ่ายวางแผนเป็นคนปลดล็อตเป็นพร้อมใช้" และเขียน can_set_lot_status()
--   ไว้ถูกแล้ว แต่ code path จริงกันฝ่ายวางแผนไว้ 3 ชั้น:
--     1. materials/page.tsx  — canManage = warehouse/manager (ไม่มีปุ่มให้กด)
--     2. materials/actions.ts — requireWarehouse()
--     3. upsert_product_lot   — เช็ค can_manage_materials() ที่ไม่มี planner
--   → ผลจริง: มีแต่ manager/admin ที่ปลดได้ · และล็อตที่ยังไม่ปลดจะเบิกไม่ได้เลย
--     (0046:202-204, :260-262 ใช้ whitelist 'available')
--   → ระบบจะติดตายทันทีที่เปิดใช้จริง ถ้าผู้บริหารไม่ว่างมากดให้
--
--   (1) set_lot_status() — RPC ตัวเดียว แก้ได้เฉพาะ "สถานะ" เท่านั้น
--
-- ℹ️ ไม่แตะ upsert_product_lot / can_manage_materials() เลย
--    จำนวนคงเหลือกับเลขล็อตยังเป็นของฝ่ายคลังเหมือนเดิม (กันสต็อกเพี้ยน)
-- ℹ️ material_lots มี meta/audit trigger ครบแล้วจาก 0016:78-82
-- รัน "หลัง" 0001–0050
-- ============================================================

-- ------------------------------------------------------------
-- (1) set_lot_status — ปลด/ยึดสถานะล็อต (ฝ่ายวางแผน/ผู้บริหาร)
--
--     แคบโดยตั้งใจ: รับแค่ 2 พารามิเตอร์ แก้แค่คอลัมน์เดียว
--     ฝ่ายวางแผนจึงกดปุ่มสถานะบนแถวได้ตรงๆ โดยไม่ต้องเปิดฟอร์มแก้ทั้งใบ
--     (ถ้าให้ไปใช้ upsert_product_lot จะต้องส่ง qty/lot_no มาด้วย = เสี่ยงเขียนทับสต็อก)
-- ------------------------------------------------------------
create or replace function public.set_lot_status(
  p_lot_id uuid,
  p_status material_lot_status
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_lot_no  text;
  v_code    text;
  v_old     material_lot_status;
  v_label   text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_set_lot_status() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารตั้งสถานะล็อตได้';
  end if;

  -- whitelist — enum ใน DB ยังมี 6 ค่าเพราะ Postgres ลบค่า enum ทิ้งไม่ได้
  -- แต่ 0046 ยุบเหลือใช้จริง 2 ค่า · ห้ามให้เขียนค่าที่เลิกใช้กลับเข้ามา
  if p_status not in ('available', 'quarantine') then
    raise exception 'สถานะล็อตต้องเป็น "พร้อมใช้" หรือ "ไม่พร้อมใช้" เท่านั้น';
  end if;

  select ml.lot_no, ml.status, p.code
    into v_lot_no, v_old, v_code
    from public.material_lots ml
    join public.products p on p.id = ml.product_id
   where ml.id = p_lot_id;

  if v_lot_no is null then
    raise exception 'ไม่พบล็อตที่เลือก';
  end if;

  if v_old = p_status then
    return p_lot_id;   -- ไม่เปลี่ยนอะไร = ไม่ต้องเขียน audit ซ้ำ
  end if;

  v_label := case p_status::text
               when 'available'  then 'พร้อมใช้'
               else 'ไม่พร้อมใช้'
             end;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'ตั้งสถานะล็อต ' || v_code || ' / ' || v_lot_no || ' เป็น "' || v_label || '"', true);

  update public.material_lots
     set status = p_status, updated_by = v_profile
   where id = p_lot_id;

  return p_lot_id;
end;
$fn$;

grant execute on function public.set_lot_status(uuid, material_lot_status) to authenticated;

comment on function public.set_lot_status(uuid, material_lot_status) is
  'ตั้งสถานะล็อต (พร้อมใช้/ไม่พร้อมใช้) — ฝ่ายวางแผน/ผู้บริหาร · แก้เฉพาะคอลัมน์ status ไม่แตะจำนวน/เลขล็อต';

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   select oid::regprocedure from pg_proc where proname = 'set_lot_status';
--
--   -- สถานะล็อตตอนนี้ — ควรเหลือแค่ available / quarantine
--   select status, count(*) from public.material_lots group by 1 order by 1;
--
--   -- ร่องรอยการปลดสถานะ
--   select reason, changed_at from public.audit_log
--    where table_name = 'material_lots' order by id desc limit 5;
-- ============================================================
