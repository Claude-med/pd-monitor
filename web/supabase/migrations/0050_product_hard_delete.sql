-- ============================================================
-- PD Monitor — Part 3 ก้อน 4 / 0050_product_hard_delete.sql
-- ลบผลิตภัณฑ์ถาวร — สำหรับตัวที่ "ปิดใช้งาน" ไว้แล้วและไม่มีประวัติการผลิตผูกอยู่
--
--   0044 ทำให้ปุ่ม "ลบ" = ลบจริงถ้าว่าง · ติดแล้วปิดใช้งานให้แทน
--   แต่ตัวที่ถูกปิดใช้งานไปแล้ว "ไม่มีทางลบทิ้งได้เลย" — ทะเบียนรกขึ้นเรื่อยๆ
--
--   (1) product_delete_report() — นับ blocker/cascade (ภายใน ไม่ expose ผ่าน API)
--   (2) preview_delete_product() — อ่านอย่างเดียว ให้ UI แจกแจงก่อนกดลบ
--   (3) force_delete_product()   — ลบจริง เฉพาะผู้บริหาร + ต้องปิดใช้งานอยู่ก่อน
--
-- ⚠️ ผู้ใช้ยืนยัน: "มีงานผลิตผูกอยู่ = ห้ามลบ บอกเหตุผลแทน" — ประวัติการผลิตต้องอยู่ตาม GMP
-- ℹ️ ลบจริงยังมีร่องรอย: trigger trg_audit_products (0002) เก็บ old_data ทั้งแถวตอน DELETE
-- รัน "หลัง" 0001–0049
-- ============================================================

-- ------------------------------------------------------------
-- (1) product_delete_report — แหล่งความจริงเดียวของ "อะไรบล็อก / อะไรจะหายตาม"
--
--     preview กับ force ต้องนับด้วยตรรกะเดียวกันเป๊ะ ไม่งั้น preview บอกว่าลบได้
--     แต่ force ปฏิเสธ (หรือแย่กว่า: preview ไม่เตือนแล้วของหายจริง)
--
--     ⚠️ ต้อง revoke from public ด้วย — "ไม่เขียน grant" ไม่พอ!
--        Postgres แจก execute ให้ PUBLIC เป็นค่าเริ่มต้นทุกฟังก์ชัน
--        ตรวจด้วย REST แล้วพบว่าเรียกได้จริงแบบไม่ล็อกอิน = ข้ามด่าน can_manage_products()
--        ตัวนี้ไม่มี guard ในตัวเอง (จงใจ ให้ 2 ตัวล่างเป็นคนกั้น) จึงต้องปิดประตูที่สิทธิ์
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
  v_reqs      integer;
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
  -- ของที่จะโดน cascade ลบตาม ดันมีคนอื่นอ้างถึงแบบ NO ACTION อยู่
  -- ถ้าไม่ดักไว้ delete จะตายด้วย FK error ดิบภาษาอังกฤษ

  -- ใบเบิกอ้าง material_lots (0017:19) ที่จะถูก cascade ลบตาม product
  select count(*) into v_reqs
    from public.material_requisitions mr
    join public.material_lots ml on ml.id = mr.material_lot_id
   where ml.product_id = p_id;

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
  if v_reqs > 0 then
    v_blockers := v_blockers || jsonb_build_object('label', 'ใบเบิกที่อ้างล็อตของยานี้', 'count', v_reqs, 'unit', 'ใบ');
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

-- ปิดประตู: ห้ามเรียกตรงผ่าน API — เหลือแต่เจ้าของฟังก์ชัน (ที่ security definer ใช้รัน)
revoke execute on function public.product_delete_report(uuid) from public;
revoke execute on function public.product_delete_report(uuid) from anon;
revoke execute on function public.product_delete_report(uuid) from authenticated;

comment on function public.product_delete_report(uuid) is
  'ภายใน (revoke จาก public/anon/authenticated แล้ว) — นับสิ่งที่บล็อกการลบถาวร + สิ่งที่จะถูกลบตาม · ใช้ร่วมกันโดย preview_delete_product / force_delete_product';

-- ------------------------------------------------------------
-- (2) preview_delete_product — อ่านอย่างเดียว ให้ UI แจกแจงก่อน
-- ------------------------------------------------------------
create or replace function public.preview_delete_product(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if public.current_profile_id() is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_manage_products() then
    raise exception 'เฉพาะฝ่ายวางแผน/ฝ่ายคลัง/ผู้บริหารดูข้อมูลนี้ได้';
  end if;

  return public.product_delete_report(p_id);
end;
$fn$;

grant execute on function public.preview_delete_product(uuid) to authenticated;

comment on function public.preview_delete_product(uuid) is
  'ดูก่อนลบถาวร — คืน {code,name,is_active,can_delete,blockers[],cascades[]} ไม่แก้ข้อมูลใดๆ';

-- ------------------------------------------------------------
-- (3) force_delete_product — ลบถาวรจริง
--
--     3 ด่านซ้อนกัน:
--       1. ต้องเป็นผู้บริหาร (ไม่ใช่ can_manage_products — สูงกว่าปุ่ม "ลบ" ปกติ)
--       2. ต้อง is_active = false อยู่แล้ว → บังคับให้ "ปิดใช้งานก่อน แล้วค่อยลบ"
--          กันการลบตัวที่ยังใช้งานอยู่พลาดในคลิกเดียว
--       3. นับ blocker ใหม่ ณ ตอนกด (ไม่เชื่อค่าจาก preview — ระหว่างนั้นอาจมีคนสร้างงานใหม่)
-- ------------------------------------------------------------
create or replace function public.force_delete_product(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_rep     jsonb;
  v_code    text;
  v_parts   text[] := '{}';
  v_item    jsonb;
  v_detail  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหารลบผลิตภัณฑ์ถาวรได้';
  end if;

  v_rep  := public.product_delete_report(p_id);
  v_code := v_rep ->> 'code';

  if (v_rep ->> 'is_active')::boolean then
    raise exception 'ต้องปิดใช้งาน % ก่อน แล้วจึงลบถาวรได้', v_code;
  end if;

  -- ---------- ติด blocker → บอกเป็นภาษาไทยว่าติดอะไรบ้าง ----------
  if not (v_rep ->> 'can_delete')::boolean then
    for v_item in select * from jsonb_array_elements(v_rep -> 'blockers') loop
      v_parts := v_parts || ((v_item ->> 'label') || ' ' || (v_item ->> 'count') || ' ' || (v_item ->> 'unit'));
    end loop;
    raise exception
      'ลบถาวร % ไม่ได้ — มี% ผูกอยู่ · ข้อมูลการผลิตต้องเก็บไว้ตาม GMP',
      v_code, array_to_string(v_parts, ' · ');
  end if;

  -- ---------- สรุปสิ่งที่จะหายตามไว้ใน audit reason ----------
  for v_item in select * from jsonb_array_elements(v_rep -> 'cascades') loop
    v_parts := v_parts || ((v_item ->> 'label') || ' ' || (v_item ->> 'count') || ' ' || (v_item ->> 'unit'));
  end loop;
  v_detail := case when array_length(v_parts, 1) is null
                then 'ไม่มีข้อมูลลูกผูกอยู่'
                else 'ลบตามไปด้วย: ' || array_to_string(v_parts, ' · ')
              end;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'ลบผลิตภัณฑ์ถาวร ' || v_code || ' · ' || v_detail, true);

  delete from public.products where id = p_id;

  return jsonb_build_object(
    'action',  'deleted',
    'message', 'ลบผลิตภัณฑ์ ' || v_code || ' ออกจากระบบถาวรแล้ว (' || v_detail || ')'
  );
end;
$fn$;

grant execute on function public.force_delete_product(uuid) to authenticated;

comment on function public.force_delete_product(uuid) is
  'ลบผลิตภัณฑ์ถาวร — ผู้บริหารเท่านั้น · ต้องปิดใช้งานอยู่ก่อน · มีประวัติการผลิตผูกอยู่ = ปฏิเสธ';

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   -- ต้องเจอ 3 แถว
--   select proname from pg_proc
--    where proname in ('product_delete_report','preview_delete_product','force_delete_product');
--
--   -- product_delete_report ต้องเรียกตรงไม่ได้ → ทั้ง 2 คอลัมน์ต้องเป็น false
--   select has_function_privilege('anon',          'public.product_delete_report(uuid)', 'execute') as anon_เรียกได้,
--          has_function_privilege('authenticated', 'public.product_delete_report(uuid)', 'execute') as user_เรียกได้;
--
--   -- ดูรายงานของยาแต่ละตัว (can_delete / blockers / cascades)
--   select code, public.preview_delete_product(id) from public.products order by code;
--
--   -- หลังลบจริงต้องมีร่องรอยใน audit_log พร้อม old_data
--   select action, reason, changed_at from public.audit_log
--    where table_name = 'products' order by id desc limit 3;
-- ============================================================
