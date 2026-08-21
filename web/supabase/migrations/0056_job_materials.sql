-- ============================================================
-- PD Monitor — Part C.2 ก้อน 1 / 0056_job_materials.sql
-- "เบิกวัตถุดิบ/บรรจุภัณฑ์" แบบ note list (แทนระบบเบิกที่ผูกล็อตในคลัง)
--
--   (1) ตาราง job_materials + trigger meta/audit + RLS + realtime
--   (2) can_edit_job_materials()      — ฝ่ายผลิต/ผู้บริหาร (เพิ่ม/แก้/ลบ)
--   (3) can_set_job_material_status() — ฝ่ายคลัง/ผู้บริหาร (กดสถานะพร้อม/ไม่พร้อม)
--   (4) upsert_job_material      — เพิ่ม/แก้รายการ (ไม่แตะสถานะ)
--   (5) set_job_material_status  — เปลี่ยนสถานะอย่างเดียว (ไม่แตะช่องอื่น)
--   (6) delete_job_material      — ลบรายการ (ฝ่ายคลังลบไม่ได้)
--
-- ℹ️ ทำไมเป็นตารางใหม่ ไม่ใช่ ALTER material_requisitions:
--    ของเดิม material_lot_id เป็น not null ผูก FK ไปคลัง + enum requested/issued/cancelled
--    + issue_requisition ตัดสต็อกจริง · ความหมายคนละเรื่องกับ "note list ว่าต้องใช้อะไร พร้อมยัง"
--    ถ้ายัดรวมตารางเดียวจะได้แถวสองความหมายปนกันตลอดไป → ตารางใหม่ + ลบของเก่าใน 0057
-- ℹ️ ทำไม item_type เป็น text + check ไม่ใช่ enum:
--    บทเรียน 0040 — enum ลบค่าทิ้งไม่ได้ และ ADD VALUE ต้อง paste แยกทรานแซกชัน (0038)
-- ℹ️ ทำไม status เป็น text 2 ค่า ไม่ใช่ boolean is_ready:
--    ฝั่งแอปใช้แพทเทิร์น select-as-badge เดียวกับ MachineStatusPicker (0052) ที่ map
--    key → label/สี ตรง ๆ · boolean ต้องแปลงกลับไปมา และเติมค่าที่ 3 ทีหลังไม่ได้
-- ⚠️ status "ไม่ใช่ด่าน GMP" — ไม่กั้น advance_job_status() ตามที่ทีมยืนยัน
--    (เป็นบันทึกหน้างานให้ฝ่ายผลิตกับคลังคุยกัน ไม่ใช่เงื่อนไขเข้าขั้นตอนผลิต)
-- ⚠️ ไม่ผูกล็อตในคลัง = ไม่ตัดสต็อก material_lots และ "สาวย้อนกลับจากเลขล็อตวัตถุดิบ"
--    (recall ในหน้า /trace) ทำไม่ได้อีก — ทีมรับทราบและยืนยันแล้ว
-- รัน "หลัง" 0001–0055
-- ============================================================

-- ------------------------------------------------------------
-- (1) ตาราง job_materials
-- ------------------------------------------------------------
create table if not exists public.job_materials (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs(id) on delete cascade,
  item_name         text not null check (btrim(item_name) <> ''),
  item_type         text not null default 'RM' check (item_type in ('RM', 'PM')),
  qty               numeric(14,3) check (qty is null or qty > 0),
  qty_unit          text,
  note              text,
  status            text not null default 'not_ready'
                      check (status in ('not_ready', 'ready')),
  status_changed_by uuid references public.profiles(id),
  status_changed_at timestamptz,
  created_by        uuid references public.profiles(id),
  updated_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1
);

comment on table public.job_materials is
  'รายการวัตถุดิบ/บรรจุภัณฑ์ที่ต้องเบิกใช้ต่องาน (Part C.2) — บันทึกหน้างานแบบ note list ไม่ผูกล็อตในคลัง ไม่ตัดสต็อก';
comment on column public.job_materials.item_name is
  'ชื่อที่ฝ่ายผลิตพิมพ์เอง — ไม่ผูกทะเบียน products โดยตั้งใจ (โรงงานไม่ได้ใช้ BOM)';
comment on column public.job_materials.item_type is
  'RM = วัตถุดิบ (Raw Material) · PM = บรรจุภัณฑ์ (Packaging Material) — text+check ไม่ใช่ enum ตามบทเรียน 0040';
comment on column public.job_materials.qty is
  'จำนวนที่เบิก — เว้นว่างได้ (เช่น "แป้ง — ตามสูตร") · หน่วยอยู่คนละคอลัมน์เพราะกรอกอิสระ';
comment on column public.job_materials.qty_unit is
  'หน่วยที่พิมพ์เอง (kg · ม้วน · ใบ) — ไม่ผูกทะเบียนหน่วยของ products';
comment on column public.job_materials.status is
  'ความพร้อมของของ: not_ready = ไม่พร้อม (ค่าตั้งต้นตอนฝ่ายผลิตขอ) · ready = พร้อม (ฝ่ายคลังกด) — ⚠️ ไม่ใช่ด่าน GMP ไม่กั้น advance_job_status() แค่ขึ้นแถบเตือนบนหน้าจอ';
comment on column public.job_materials.status_changed_by is
  'สำเนาเพื่อแสดงบนการ์ด ("พร้อม โดยสมชาย") — หลักฐานจริงอยู่ที่ audit_log ซึ่งอ่านได้เฉพาะบางฝ่าย';
comment on column public.job_materials.status_changed_at is
  'สำเนาเพื่อแสดงบนการ์ด — หลักฐานจริงอยู่ที่ audit_log';

-- query หลักของหน้ารายละเอียดงาน: ต่อ 1 งาน + เรียงตามลำดับที่พิมพ์
create index if not exists idx_job_materials_job
  on public.job_materials (job_id, created_at);

-- partial index สำหรับหน้ารวมฝ่ายคลัง ที่ค่าเริ่มต้นกรองเฉพาะของที่ยังไม่พร้อม
create index if not exists idx_job_materials_notready
  on public.job_materials (status)
  where status = 'not_ready';

-- ไม่ใส่ unique (job_id, item_name) โดยตั้งใจ — งานเดียวเบิกของชื่อเดิมซ้ำได้จริง
-- (คนละขนาด/คนละหมายเหตุ) ถ้าใส่จะเด้ง error ที่ผู้ใช้หน้างานไม่เข้าใจ

drop trigger if exists trg_meta_job_materials on public.job_materials;
create trigger trg_meta_job_materials before insert or update on public.job_materials
  for each row execute function public.set_row_meta();

drop trigger if exists trg_audit_job_materials on public.job_materials;
create trigger trg_audit_job_materials after insert or update or delete on public.job_materials
  for each row execute function public.log_audit();

-- RLS: default-deny · ทุกคนที่ล็อกอินอ่านได้ · เขียนผ่าน RPC security definer เท่านั้น
--      (ไม่มี policy insert/update/delete = ไม่มีทางเขียนตารางนี้นอกจากผ่าน 3 RPC ข้างล่าง
--       นี่คือตัวบังคับสิทธิ์จริง ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ)
alter table public.job_materials enable row level security;

drop policy if exists read_job_materials on public.job_materials;
create policy read_job_materials on public.job_materials
  for select to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.job_materials;
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- (2) can_edit_job_materials — ใครเพิ่ม/แก้/ลบรายการเบิกได้
--     ฝ่ายผลิตเป็นคนรู้ว่างานนี้ต้องใช้อะไร · ผู้บริหารทำแทนได้
--     (admin ผ่านเองจาก has_role — 0013:33)
--
--     ไม่ reuse can_set_job_lot() ที่ role เท่ากันเป๊ะตอนนี้ — คนละความหมาย
--     ถ้าวันหน้าเปลี่ยนสิทธิ์กรอกเลขล็อต จะได้ไม่ลากสิทธิ์รายการเบิกไปด้วยแบบเงียบ
-- ------------------------------------------------------------
create or replace function public.can_edit_job_materials()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('production') or public.has_role('manager');
$$;

grant execute on function public.can_edit_job_materials() to authenticated;

comment on function public.can_edit_job_materials() is
  'สิทธิ์เพิ่ม/แก้/ลบรายการเบิกวัตถุดิบ-บรรจุภัณฑ์ = ฝ่ายผลิต/ผู้บริหาร — ต้องตรงกับ canEditJobMaterials() ใน web/lib/data/role-access.ts';

-- ------------------------------------------------------------
-- (3) can_set_job_material_status — ใครกดสถานะ พร้อม/ไม่พร้อม ได้
--     ฝ่ายคลังเป็นคนเห็นของจริงว่ามีพร้อมจ่ายไหม
--
--     ไม่ reuse can_manage_materials() (0016) ด้วยเหตุผลเดียวกับข้อ (2)
-- ------------------------------------------------------------
create or replace function public.can_set_job_material_status()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('warehouse') or public.has_role('manager');
$$;

grant execute on function public.can_set_job_material_status() to authenticated;

comment on function public.can_set_job_material_status() is
  'สิทธิ์กดสถานะความพร้อมของรายการเบิก = ฝ่ายคลัง/ผู้บริหาร — ต้องตรงกับ canSetJobMaterialStatus() ใน web/lib/data/role-access.ts';

-- ------------------------------------------------------------
-- (4) upsert_job_material — เพิ่ม/แก้รายการเบิก
--
--     🔑 UPDATE ข้างล่างระบุคอลัมน์เอง และ "ไม่มี status ให้ฝ่ายผลิตส่งเข้ามา"
--        → ฝ่ายผลิตเปลี่ยนสถานะไม่ได้ที่ระดับ DB ไม่ใช่แค่ซ่อนปุ่ม
--        ⚠️ ห้ามใครมาเติมพารามิเตอร์ p_status ทีหลัง — ถ้าทำ สิทธิ์ทั้งชุดพังทันที
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

comment on function public.upsert_job_material(uuid, uuid, text, text, numeric, text, text) is
  'เพิ่ม/แก้รายการเบิกวัตถุดิบ-บรรจุภัณฑ์ของงาน (ฝ่ายผลิต/ผู้บริหาร) — ไม่แตะคอลัมน์ status ยกเว้นกรณีรีเซ็ตเพราะแก้ข้อมูลหลังคลังกดพร้อม';

-- ------------------------------------------------------------
-- (5) set_job_material_status — เปลี่ยนสถานะความพร้อมอย่างเดียว
--
--     แคบโดยตั้งใจแบบเดียวกับ set_machine_status (0052): ฝ่ายคลังกดจากการ์ดบ่อย
--     ถ้าใช้ upsert ทั้งใบ หน้าจอต้องส่งชื่อ/จำนวน/หมายเหตุกลับมาด้วย = เสี่ยงทับ
--     ข้อมูลจาก snapshot เก่าที่ค้างในเบราว์เซอร์ และทำให้ฝ่ายคลังแก้ช่องอื่นได้ไปด้วย
-- ------------------------------------------------------------
create or replace function public.set_job_material_status(
  p_id     uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_status  text;
  v_old     text;
  v_name    text;
  v_type    text;
  v_job_no  text;
  v_label   text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  if not public.can_set_job_material_status() then
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารเปลี่ยนสถานะความพร้อมได้';
  end if;

  v_status := btrim(coalesce(p_status, ''));
  if v_status not in ('ready', 'not_ready') then
    raise exception 'สถานะต้องเป็น "พร้อม" หรือ "ไม่พร้อม" เท่านั้น';
  end if;

  select m.item_name, m.item_type, m.status, j.job_no
    into v_name, v_type, v_old, v_job_no
    from public.job_materials m
    join public.jobs j on j.id = m.job_id
   where m.id = p_id;

  if v_name is null then
    raise exception 'ไม่พบรายการเบิกที่เลือก';
  end if;

  if v_old = v_status then
    return p_id;   -- ไม่เปลี่ยนอะไร = ไม่ต้องเขียน audit ซ้ำ
  end if;

  v_label := case v_status when 'ready' then 'พร้อม' else 'ไม่พร้อม' end;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'ตั้งความพร้อม "' || v_name || '" (' || v_type || ') งาน ' || v_job_no
    || ' เป็น "' || v_label || '"', true);

  update public.job_materials
     set status            = v_status,
         status_changed_by = v_profile,
         status_changed_at = now(),
         updated_by        = v_profile
   where id = p_id;

  return p_id;
end;
$fn$;

revoke execute on function public.set_job_material_status(uuid, text) from public;
revoke execute on function public.set_job_material_status(uuid, text) from anon;
grant  execute on function public.set_job_material_status(uuid, text) to authenticated;

comment on function public.set_job_material_status(uuid, text) is
  'กดสถานะ พร้อม/ไม่พร้อม ให้รายการเบิก (ฝ่ายคลัง/ผู้บริหาร) — แก้เฉพาะ status/status_changed_* ไม่แตะชื่อ/จำนวน/หมายเหตุ';

-- ------------------------------------------------------------
-- (6) delete_job_material — ลบรายการเบิก (ฝ่ายคลังลบไม่ได้)
--
--     ลบจริง ไม่ soft delete — เป็นบันทึกหน้างานที่พิมพ์ผิดแล้วลบทิ้งได้
--     trigger trg_audit_job_materials เก็บ old_data ทั้งแถวไว้ใน audit_log = ร่องรอย GMP ครบ
--     ไม่บล็อกแม้ status = 'ready' ตามที่ทีมยืนยัน — กันพลาดด้วยปุ่มยืนยัน 2 ขั้นที่หน้าจอ
-- ------------------------------------------------------------
create or replace function public.delete_job_material(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_name    text;
  v_type    text;
  v_status  text;
  v_qty     numeric;
  v_unit    text;
  v_job_no  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;

  if not public.can_edit_job_materials() then
    raise exception 'เฉพาะฝ่ายผลิต/ผู้บริหารลบรายการเบิกได้ (ฝ่ายคลังลบไม่ได้)';
  end if;

  select m.item_name, m.item_type, m.status, m.qty, m.qty_unit, j.job_no
    into v_name, v_type, v_status, v_qty, v_unit, v_job_no
    from public.job_materials m
    join public.jobs j on j.id = m.job_id
   where m.id = p_id;

  if v_name is null then
    raise exception 'ไม่พบรายการเบิกที่เลือก';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'ลบรายการเบิก "' || v_name || '" (' || v_type || ') งาน ' || v_job_no
    || ' · จำนวน ' || coalesce(v_qty::text, '—') || ' ' || coalesce(v_unit, '')
    || ' · สถานะขณะลบ "' || case v_status when 'ready' then 'พร้อม' else 'ไม่พร้อม' end || '"',
    true);

  delete from public.job_materials where id = p_id;

  return p_id;
end;
$fn$;

revoke execute on function public.delete_job_material(uuid) from public;
revoke execute on function public.delete_job_material(uuid) from anon;
grant  execute on function public.delete_job_material(uuid) to authenticated;

comment on function public.delete_job_material(uuid) is
  'ลบรายการเบิกวัตถุดิบ-บรรจุภัณฑ์ (ฝ่ายผลิต/ผู้บริหาร) — ฝ่ายคลังลบไม่ได้ · audit_log เก็บทั้งแถวไว้';

-- ------------------------------------------------------------
-- ตรวจหลังรัน (ออปชัน)
-- ------------------------------------------------------------
-- select to_regclass('public.job_materials');                                       -- ไม่เป็น null
-- select count(*) from pg_publication_tables
--  where pubname='supabase_realtime' and tablename='job_materials';                 -- 1
-- select policyname, cmd from pg_policies where tablename='job_materials';          -- read_job_materials / SELECT ตัวเดียว
-- select oid::regprocedure from pg_proc where proname in
--  ('upsert_job_material','set_job_material_status','delete_job_material',
--   'can_edit_job_materials','can_set_job_material_status');                        -- 5 แถว ตัวละ 1 (ไม่ซ้อน)
-- select has_function_privilege('anon','public.set_job_material_status(uuid,text)','execute');  -- false
-- select tgname from pg_trigger where tgrelid='public.job_materials'::regclass and not tgisinternal;
--   -- trg_meta_job_materials · trg_audit_job_materials
