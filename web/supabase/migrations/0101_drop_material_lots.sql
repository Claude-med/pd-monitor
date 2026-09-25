-- ============================================================
-- PD Monitor — Part H / 0101_drop_material_lots.sql  (ก้อน 4)
--   ลบเมนู "ผลิตภัณฑ์คลัง" (/materials) ถาวร — ผู้ใช้เลือก 25 ก.ย. 69
--
-- เหตุผล: ตั้งแต่ 0057 (ยกเลิกระบบเบิกแบบผูกล็อต) ไม่มีส่วนไหนของระบบใช้ทะเบียนล็อตนี้อีก
--   · ไม่มีอะไรตัดสต็อก qty_on_hand · job_materials ไม่ผูกล็อต · Trace ไม่ได้ใช้
--   งานจริงของคลังเหลือ "วัตถุดิบพร้อม" (/job-materials) + คลัง FG (/warehouse) ซึ่งไม่แตะของในไฟล์นี้
--
-- 🚨 ทำย้อนกลับไม่ได้ — ก่อน paste ให้ export ตาราง material_lots เป็น CSV เก็บไว้ก่อน
--    (Supabase → Table Editor → material_lots → Export → CSV)
--
-- 🚨 ลำดับ deploy: push โค้ดที่เอาหน้า /materials ออกก่อน แล้วค่อย paste ไฟล์นี้
--
-- ลบ: ตาราง material_lots · RPC upsert_product_lot / set_lot_status · helper can_set_lot_status /
--     can_manage_materials · enum material_lot_status
-- แก้: product_delete_report (ยกบอดี้ 0057) — ตัดการนับ "ล็อตในคลัง" ออก
-- ไม่แตะ: products · jobs.lot_no / batches · fg_inventory · job_materials
--
-- รัน "หลัง" 0100 · รันซ้ำได้
-- ============================================================


-- ------------------------------------------------------------
-- (1) product_delete_report — ยกบอดี้ 0057 · ตัด v_lots ออก (ตารางกำลังจะหาย)
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
  -- Part H (0101): ตาราง material_lots ถูกลบ — ไม่มี "ล็อตในคลัง" ให้นับอีก
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
-- (2) drop RPC/helper ของหน้าคลังเดิม — ลบทุก overload ตามชื่อ (กัน signature เก่าค้าง · PGRST203)
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('upsert_product_lot', 'set_lot_status',
                         'can_set_lot_status', 'can_manage_materials')
  loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;


-- ------------------------------------------------------------
-- (3) ถอด realtime → drop table → drop enum
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime drop table public.material_lots;
exception
  when undefined_object then null;
  when undefined_table  then null;
end $$;

-- trigger (audit) / index / policy ของตารางหายตามไปเอง
drop table if exists public.material_lots;

-- ใช้เฉพาะในตารางและ RPC ที่เพิ่งลบข้างบน
drop type if exists public.material_lot_status;


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ)
--
-- ข้อ 1 · ตารางหายแล้ว
--   select to_regclass('public.material_lots');
--   ✅ null (ช่องว่าง)   ❌ ได้ชื่อตาราง = ไฟล์นี้ยังไม่ได้รัน
--
-- ข้อ 2 · RPC/helper หายหมด
--   select count(*) from pg_proc where proname in
--     ('upsert_product_lot','set_lot_status','can_set_lot_status','can_manage_materials');
--   ✅ 0
--
-- ข้อ 3 · enum หาย
--   select count(*) from pg_type where typname = 'material_lot_status';
--   ✅ 0   ❌ ถ้า error "cannot drop type ... because other objects depend on it" ตอน paste → แจ้ง Claude
--
-- ข้อ 4 · รายงานการลบผลิตภัณฑ์ยังทำงาน (ไม่อ้างตารางที่หายไป)
--   select prosrc not like '%from public.material_lots%' from pg_proc where proname = 'product_delete_report';
--   ✅ true
-- ============================================================
