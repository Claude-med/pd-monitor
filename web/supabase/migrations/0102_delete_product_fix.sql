-- ============================================================
-- PD Monitor — Part I / 0102_delete_product_fix.sql  (ก้อน 1)
--   แก้บั๊ก: กด "ลบ" ผลิตภัณฑ์ (หน้า ผลิตภัณฑ์/ขั้นตอนการผลิต) แล้วขึ้น
--     relation "public.material_lots" does not exist
--
-- สาเหตุ: 0101 drop ตาราง material_lots แต่แก้เฉพาะ product_delete_report
--   ส่วน delete_product (0044:177) ยังนับ "ล็อตในคลัง" จากตารางที่หายไปแล้ว
--   plpgsql ตรวจชื่อตารางตอน "เรียกใช้" ไม่ใช่ตอนสร้าง ⇒ 0101 paste ผ่าน แต่ปุ่มลบพังทุกครั้ง
--
-- แก้: ยกบอดี้ 0044 มาทั้งก้อน · ตัด v_lots ออก (ตัวแปร · เงื่อนไขลบจริง · ข้อความ) · อย่างอื่นเหมือนเดิมทุกบรรทัด
-- สิทธิ์คงเดิม (ผู้ใช้ยืนยัน 30 ก.ย. 69): can_manage_products() = วางแผน / คลัง / ผู้บริหาร (+ หัวหน้าฝ่ายนั้น + admin)
--
-- รัน "หลัง" 0101 · รันซ้ำได้
-- ============================================================

create or replace function public.delete_product(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_code    text;
  v_orders  integer;
  v_jobs    integer;
  v_batches integer;
  v_fg      integer;
  v_parts   text[] := '{}';
  v_msg     text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_products() then
    raise exception 'เฉพาะฝ่ายวางแผน/ฝ่ายคลัง/ผู้บริหารจัดการผลิตภัณฑ์ได้';
  end if;

  select code into v_code from public.products where id = p_id;
  if v_code is null then raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก'; end if;

  select count(*) into v_orders  from public.orders        where product_id = p_id;
  select count(*) into v_batches from public.batches       where product_id = p_id;
  select count(*) into v_fg      from public.fg_inventory  where product_id = p_id;
  -- Part I (0102): ตัดการนับ material_lots — ตารางถูกลบใน 0101
  select count(*) into v_jobs
    from public.jobs j
    join public.orders o on o.id = j.order_id
   where o.product_id = p_id;

  perform set_config('app.current_profile_id', v_profile::text, true);

  -- ยังไม่มีใครใช้ → ลบออกจากฐานข้อมูลจริง
  if v_orders = 0 and v_batches = 0 and v_fg = 0 then
    perform set_config('app.audit_reason',
      'ลบผลิตภัณฑ์ ' || v_code || ' (ยังไม่ถูกใช้งาน — ลบจริง)', true);
    delete from public.products where id = p_id;
    return jsonb_build_object(
      'action', 'deleted',
      'message', 'ลบผลิตภัณฑ์ ' || v_code || ' ออกจากระบบแล้ว'
    );
  end if;

  -- ถูกใช้งานไปแล้ว → เก็บแถวไว้เป็นประวัติ GMP แต่ปิดใช้งาน
  if v_jobs    > 0 then v_parts := v_parts || ('งานผลิต '        || v_jobs    || ' ใบ');    end if;
  if v_orders  > 0 then v_parts := v_parts || ('ใบสั่งผลิต '      || v_orders  || ' ใบ');    end if;
  if v_batches > 0 then v_parts := v_parts || ('ล็อตการผลิต '     || v_batches || ' รายการ'); end if;
  if v_fg      > 0 then v_parts := v_parts || ('สต็อก FG '        || v_fg      || ' รายการ'); end if;
  v_msg := 'ลบไม่ได้ — มี' || array_to_string(v_parts, ' · ') || ' ใช้อยู่ · เปลี่ยนเป็นปิดใช้งานแทนแล้ว';

  perform set_config('app.audit_reason',
    'ปิดใช้งานผลิตภัณฑ์ ' || v_code || ' (' || array_to_string(v_parts, ' · ') || ')', true);

  update public.products
     set is_active = false, updated_by = v_profile
   where id = p_id;

  return jsonb_build_object('action', 'deactivated', 'message', v_msg);
end;
$$;

-- grant ครบ 3 บรรทัด (บทเรียน 0088:61-62 — grant เฉย ๆ ไม่ถอน EXECUTE ของ PUBLIC)
revoke execute on function public.delete_product(uuid) from public;
revoke execute on function public.delete_product(uuid) from anon;
grant  execute on function public.delete_product(uuid) to authenticated;


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ)
--
-- ข้อ 1 · ไม่มีฟังก์ชันไหนอ้างตาราง material_lots เหลืออยู่แล้ว (กันตกหล่นแบบรอบนี้ซ้ำ)
--   ⚠️ ต้องหาเฉพาะ "จุดที่ใช้ตารางจริง" (from / join / update …) — ค้นคำเฉย ๆ จะติดบรรทัดหมายเหตุ
--      (เวอร์ชันแรกของข้อนี้ใช้ ilike '%material_lots%' แล้วได้ delete_product / product_delete_report
--       ซึ่งมีคำนี้แค่ในหมายเหตุ — ตรวจแล้ว 30 ก.ย. 69 ไม่ใช่บั๊ก)
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.prosrc ~* '(from|join|update|into|table)\s+(public\.)?material_lots';
--   ✅ ไม่มีแถวเลย (No rows returned)
--   ❌ มีชื่อฟังก์ชันโผล่ = ยังมีตัวที่จะพังแบบเดียวกัน → ส่งชื่อให้ Claude
--
-- ข้อ 2 · สิทธิ์เรียกใช้ถูกต้อง
--   select has_function_privilege('anon',          'public.delete_product(uuid)', 'execute') as anon_เรียกได้,
--          has_function_privilege('authenticated', 'public.delete_product(uuid)', 'execute') as user_เรียกได้;
--   ✅ anon_เรียกได้ = false · user_เรียกได้ = true
--
-- ข้อ 3 · ทดสอบบนเว็บ (หน้า ผลิตภัณฑ์/ขั้นตอนการผลิต)
--   · ลบผลิตภัณฑ์ที่ยังไม่เคยเปิดงาน → ✅ "ลบผลิตภัณฑ์ … ออกจากระบบแล้ว"
--   · ลบผลิตภัณฑ์ที่มีงานผูกอยู่     → ✅ "ลบไม่ได้ — มีงานผลิต … · เปลี่ยนเป็นปิดใช้งานแทนแล้ว"
--   ❌ ยังขึ้น material_lots does not exist = ไฟล์นี้ยังไม่ได้ paste
-- ============================================================
