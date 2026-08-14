-- ============================================================
-- PD Monitor — Part 2 ก้อน 3 / 0042_lots_to_products.sql
-- ยุบ "วัตถุดิบ (materials)" เข้า "ผลิตภัณฑ์ (products)" — ล็อตย้ายไปผูกกับ products
--
--   (1) คัดลอก materials ทุกแถว → products (type = rm/pm ตามของเดิม)
--   (2) material_lots.material_id → product_id
--   (3) upsert_product_lot แทน upsert_material_lot
--   (4) drop upsert_material (ไม่มีใครเรียกแล้ว — เพิ่มผลิตภัณฑ์ที่หน้าผลิตภัณฑ์แทน)
--
-- ⚠️ ไฟล์นี้ "ย้ายข้อมูลจริง" — มี pre-flight ตรวจรหัสชนกันอยู่ในตัว
--    ถ้าเจอปัญหาจะ raise exception → SQL Editor rollback ทั้งไฟล์ ไม่มีอะไรเปลี่ยน
-- ⚠️ ไม่ drop ตาราง materials — เก็บไว้เผื่อ rollback + recipe_items เก่ายังอ้างอยู่
-- ⚠️ ไม่เปลี่ยนชื่อตาราง material_lots / material_requisitions — เปลี่ยนแค่ FK column
--    ทำให้ RLS · realtime · audit ของแถวเก่า · และ RPC เบิก 3 ตัวไม่ต้องแตะเลย
-- ⚠️ รันซ้ำได้ (ถ้าย้ายไปแล้วจะข้ามขั้นตอนย้ายข้อมูลเอง)
-- รัน "หลัง" 0001–0041
-- ============================================================

-- ------------------------------------------------------------
-- (1) ย้ายข้อมูล — ทำในบล็อกเดียวเพื่อให้ rollback พร้อมกันทั้งชุด
-- ------------------------------------------------------------
do $$
declare
  v_dup    text;
  v_orphan integer;
  v_moved  integer;
begin
  -- ข้ามถ้าย้ายไปแล้ว (รันซ้ำได้)
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_lots'
       and column_name  = 'material_id'
  ) then
    raise notice 'material_lots ผูกกับ products อยู่แล้ว — ข้ามขั้นตอนย้ายข้อมูล';
    return;
  end if;

  -- ---------- pre-flight: รหัสห้ามชนกัน ----------
  -- ถ้าชน แปลว่ามีของคนละอย่างใช้รหัสเดียวกัน → ต้องแก้ข้อมูลก่อน ห้ามเดาแทน
  select string_agg(m.code, ', ' order by m.code) into v_dup
  from public.materials m
  join public.products p on p.code = m.code;

  if v_dup is not null then
    raise exception
      'รหัสชนกันระหว่างวัตถุดิบกับผลิตภัณฑ์: % — กรุณาแก้รหัสให้ไม่ซ้ำก่อนรันไฟล์นี้', v_dup;
  end if;

  perform set_config('app.audit_reason', 'ยุบวัตถุดิบเข้าผลิตภัณฑ์ (Part 2 ก้อน 3)', true);

  -- ---------- คัดลอก materials → products ----------
  insert into public.products (code, name, type, unit, is_active, created_by)
  select m.code, m.name, m.type::text, m.unit, m.is_active, m.created_by
  from public.materials m;

  get diagnostics v_moved = row_count;
  raise notice 'คัดลอกวัตถุดิบเข้าผลิตภัณฑ์ % รายการ', v_moved;

  -- ---------- material_lots: material_id → product_id ----------
  alter table public.material_lots
    add column product_id uuid references public.products(id) on delete cascade;

  update public.material_lots l
     set product_id = p.id
    from public.materials m
    join public.products  p on p.code = m.code
   where l.material_id = m.id;

  select count(*) into v_orphan from public.material_lots where product_id is null;
  if v_orphan > 0 then
    raise exception 'มีล็อต % รายการที่หาผลิตภัณฑ์ปลายทางไม่เจอ — ยกเลิกการย้ายทั้งหมด', v_orphan;
  end if;

  alter table public.material_lots alter column product_id set not null;

  -- drop คอลัมน์เก่า (unique(material_id, lot_no) + index จะถูกลบตามไปเอง)
  alter table public.material_lots drop column material_id;

  alter table public.material_lots
    add constraint material_lots_product_lot_key unique (product_id, lot_no);

  create index if not exists idx_material_lots_product
    on public.material_lots (product_id);

  raise notice 'ย้ายล็อตไปผูกกับผลิตภัณฑ์เรียบร้อย';
end $$;

comment on column public.material_lots.product_id is
  'ผลิตภัณฑ์เจ้าของล็อต (Part 2: ยุบ materials เข้า products แล้ว)';

-- ------------------------------------------------------------
-- (2) upsert_product_lot — body เดิมจาก 0016:181-255
--     เปลี่ยน: p_material_id → p_product_id · เช็ก products แทน materials · ข้อความไทย
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

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'จัดการล็อตผลิตภัณฑ์ ' || p_lot_no, true);

  if p_id is null then
    if exists (select 1 from public.material_lots
                where product_id = p_product_id and lot_no = p_lot_no) then
      raise exception 'ล็อต % ของผลิตภัณฑ์นี้มีอยู่แล้ว', p_lot_no;
    end if;
    insert into public.material_lots
      (product_id, lot_no, qty_on_hand, status, received_date, expiry_date, note, created_by)
    values
      (p_product_id, p_lot_no, p_qty, coalesce(p_status, 'quarantine'),
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
    update public.material_lots
       set lot_no = p_lot_no, qty_on_hand = p_qty,
           status = coalesce(p_status, status),
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
-- (3) เลิกใช้ฟังก์ชันเดิมของวัตถุดิบ
--     upsert_material_lot อ้างคอลัมน์ material_id ที่ถูก drop ไปแล้ว → ต้องลบทิ้ง
--     upsert_material ไม่มีหน้าไหนเรียกแล้ว (เพิ่มผลิตภัณฑ์ที่หน้า "ผลิตภัณฑ์" แทน)
-- ------------------------------------------------------------
drop function if exists public.upsert_material_lot(
  uuid, uuid, text, numeric, material_lot_status, date, date, text
);
drop function if exists public.upsert_material(uuid, text, text, material_type, text);

-- ============================================================
-- ตรวจหลังรัน (ออปชัน)
--   -- จำนวนล็อตต้องเท่าเดิม และไม่มีแถวไหน product_id เป็น null
--   select count(*) as lots, count(product_id) as mapped from public.material_lots;
--   -- ผลิตภัณฑ์แยกตามประเภท
--   select type, count(*) from public.products group by type order by type;
--   -- ล็อตพร้อมชื่อผลิตภัณฑ์
--   select p.code, p.name, p.type, l.lot_no, l.qty_on_hand, l.status
--     from public.material_lots l join public.products p on p.id = l.product_id
--    order by p.code, l.lot_no;
-- ============================================================
