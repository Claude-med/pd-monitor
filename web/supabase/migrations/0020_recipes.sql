-- ============================================================
-- PD Monitor — D11 / 0020_recipes.sql  (A4 ก้อน 1: สูตรการผลิต / BOM)
-- ตาราง product_recipes (หัวสูตรของยาแต่ละตัว + ขนาดแบตช์)
--   + recipe_items (รายการวัตถุดิบในสูตร = BOM ผูกกับ materials ของ A2)
-- เขียนผ่าน RPC security definer (manager/admin) ตามแพตเทิร์นเดิม
--   - upsert_recipe        : เพิ่ม/แก้หัวสูตร
--   - set_recipe_items     : แทนที่รายการ BOM ทั้งชุดแบบ atomic (jsonb)
-- รัน "หลัง" 0001–0019
-- ============================================================

-- ------------------------------------------------------------
-- product_recipes — หัวสูตร (1 ยา มีได้หลายเวอร์ชัน · is_active=ใช้อยู่)
-- ------------------------------------------------------------
create table if not exists public.product_recipes (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  name        text not null default 'สูตรมาตรฐาน',  -- ชื่อ/เวอร์ชันสูตร
  batch_size  numeric(14,2) check (batch_size is null or batch_size >= 0), -- ผลิตได้ต่อ 1 แบตช์
  batch_unit  text not null default 'เม็ด',
  is_active   boolean not null default true,
  note        text,
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);

-- ------------------------------------------------------------
-- recipe_items — รายการวัตถุดิบในสูตร (BOM) ผูกกับ materials (A2)
-- ------------------------------------------------------------
create table if not exists public.recipe_items (
  id          uuid primary key default gen_random_uuid(),
  recipe_id   uuid not null references public.product_recipes(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty         numeric(14,4) not null check (qty >= 0),  -- ปริมาณต่อแบตช์
  unit        text,
  note        text,
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1,
  unique (recipe_id, material_id)  -- กันใส่วัตถุดิบเดิมซ้ำในสูตรเดียว
);

create index if not exists idx_product_recipes_product on public.product_recipes(product_id);
create index if not exists idx_recipe_items_recipe     on public.recipe_items(recipe_id);
create index if not exists idx_recipe_items_material   on public.recipe_items(material_id);

-- ------------------------------------------------------------
-- triggers: meta (updated_at/version) + audit
-- ------------------------------------------------------------
drop trigger if exists trg_meta_product_recipes on public.product_recipes;
create trigger trg_meta_product_recipes before insert or update on public.product_recipes
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_product_recipes on public.product_recipes;
create trigger trg_audit_product_recipes after insert or update or delete on public.product_recipes
  for each row execute function public.log_audit();

drop trigger if exists trg_meta_recipe_items on public.recipe_items;
create trigger trg_meta_recipe_items before insert or update on public.recipe_items
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_recipe_items on public.recipe_items;
create trigger trg_audit_recipe_items after insert or update or delete on public.recipe_items
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- RLS: เปิด (default-deny) · authenticated อ่านได้ทุกคน · เขียนผ่าน RPC เท่านั้น
-- ------------------------------------------------------------
alter table public.product_recipes enable row level security;
alter table public.recipe_items enable row level security;

drop policy if exists read_product_recipes on public.product_recipes;
create policy read_product_recipes on public.product_recipes
  for select to authenticated using (true);

drop policy if exists read_recipe_items on public.recipe_items;
create policy read_recipe_items on public.recipe_items
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- helper: เฉพาะผู้บริหาร/ผู้ดูแลระบบ จัดการสูตรการผลิตได้
--   (สูตร = เอกสารควบคุม GMP · has_role ถือว่า admin ผ่านทุก role)
-- ------------------------------------------------------------
create or replace function public.can_manage_recipes()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('manager');
$$;

-- ------------------------------------------------------------
-- upsert_recipe — เพิ่ม/แก้หัวสูตร
-- ------------------------------------------------------------
create or replace function public.upsert_recipe(
  p_id         uuid,
  p_product_id uuid,
  p_name       text,
  p_batch_size numeric default null,
  p_batch_unit text    default 'เม็ด',
  p_is_active  boolean default true,
  p_note       text    default null
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
  if not public.can_manage_recipes() then
    raise exception 'เฉพาะผู้บริหารจัดการสูตรการผลิตได้';
  end if;

  p_name := nullif(btrim(coalesce(p_name, '')), '');
  if p_name is null then p_name := 'สูตรมาตรฐาน'; end if;
  if p_product_id is null
     or not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'ไม่พบยา/ผลิตภัณฑ์ที่เลือก';
  end if;
  if p_batch_size is not null and p_batch_size < 0 then
    raise exception 'ขนาดแบตช์ห้ามติดลบ';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);

  if p_id is null then
    perform set_config('app.audit_reason', 'เพิ่มสูตรการผลิต ' || p_name, true);
    insert into public.product_recipes
      (product_id, name, batch_size, batch_unit, is_active, note, created_by)
    values
      (p_product_id, p_name, p_batch_size,
       coalesce(nullif(btrim(coalesce(p_batch_unit, '')), ''), 'เม็ด'),
       coalesce(p_is_active, true),
       nullif(btrim(coalesce(p_note, '')), ''), v_profile)
    returning id into v_id;
  else
    if not exists (select 1 from public.product_recipes where id = p_id) then
      raise exception 'ไม่พบสูตรที่เลือก';
    end if;
    perform set_config('app.audit_reason', 'แก้สูตรการผลิต ' || p_name, true);
    update public.product_recipes
       set name = p_name,
           batch_size = p_batch_size,
           batch_unit = coalesce(nullif(btrim(coalesce(p_batch_unit, '')), ''), batch_unit),
           is_active = coalesce(p_is_active, is_active),
           note = nullif(btrim(coalesce(p_note, '')), ''),
           updated_by = v_profile
     where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_recipe(uuid, uuid, text, numeric, text, boolean, text)
  to authenticated;

-- ------------------------------------------------------------
-- set_recipe_items — แทนที่รายการ BOM ทั้งชุดแบบ atomic
--   p_items = jsonb array ของ { material_id, qty, unit, note }
-- ------------------------------------------------------------
create or replace function public.set_recipe_items(
  p_recipe_id uuid,
  p_items     jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_recipes() then
    raise exception 'เฉพาะผู้บริหารจัดการสูตรการผลิตได้';
  end if;
  if p_recipe_id is null
     or not exists (select 1 from public.product_recipes where id = p_recipe_id) then
    raise exception 'ไม่พบสูตรที่เลือก';
  end if;

  p_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'รูปแบบรายการวัตถุดิบไม่ถูกต้อง';
  end if;

  -- ตรวจ: วัตถุดิบทุกตัวต้องมีจริง
  if exists (
    select 1 from jsonb_array_elements(p_items) it
    where not exists (
      select 1 from public.materials m where m.id = (it->>'material_id')::uuid
    )
  ) then
    raise exception 'มีวัตถุดิบในสูตรที่ไม่พบในระบบ';
  end if;

  -- ตรวจ: จำนวนห้ามว่าง/ติดลบ
  if exists (
    select 1 from jsonb_array_elements(p_items) it
    where (it->>'qty') is null or (it->>'qty')::numeric < 0
  ) then
    raise exception 'จำนวนวัตถุดิบในสูตรห้ามว่างหรือติดลบ';
  end if;

  -- ตรวจ: ห้ามวัตถุดิบซ้ำในสูตรเดียว
  if exists (
    select (it->>'material_id') as mid
    from jsonb_array_elements(p_items) it
    group by (it->>'material_id')
    having count(*) > 1
  ) then
    raise exception 'มีวัตถุดิบซ้ำกันในสูตร — รวมเป็นรายการเดียว';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ปรับรายการวัตถุดิบในสูตร (BOM)', true);

  delete from public.recipe_items where recipe_id = p_recipe_id;

  insert into public.recipe_items (recipe_id, material_id, qty, unit, note, created_by)
  select p_recipe_id,
         (it->>'material_id')::uuid,
         (it->>'qty')::numeric,
         nullif(btrim(coalesce(it->>'unit', '')), ''),
         nullif(btrim(coalesce(it->>'note', '')), ''),
         v_profile
  from jsonb_array_elements(p_items) it;
end;
$$;

grant execute on function public.set_recipe_items(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.product_recipes;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.recipe_items;
exception when duplicate_object then null; end $$;
