-- ============================================================
-- PD Monitor — Part G / 0097_fg_dispatch.sql  (ก้อน 5)
--   คลัง / FG: บันทึก "จ่ายออก" → เห็นยอดคงคลังจริง
--
-- 🎯 โจทย์จากทีม
--   การ์ด "งาน FG ทั้งหมด / รอรับเข้าคลัง / ยอดรับเข้ารวม" นับสะสมตั้งแต่เปิดระบบ
--   ไม่มีทางถ่ายของออก ⇒ ตัวเลขโตไปเรื่อย ๆ ไม่มีความหมาย
--   ผู้ใช้เลือก: "เลือกช่วงเวลา (เดือน) + บันทึกจ่ายออก"
--
-- 🔑 โครง
--   · fg_dispatches = ใบจ่ายออก หลายใบต่อ 1 รายการคลัง (fg_inventory) · หน่วยตามรายการรับเข้าเสมอ
--   · คงคลัง = fg_inventory.qty − ผลรวมใบจ่ายออกที่ยังไม่ถูกลบ
--   · ลบใบจ่ายออก = soft delete + บังคับเหตุผล (แพทเทิร์น delete_qa_sample 0066 · GMP)
--   · receive_fg (ยกบอดี้ 0023) เพิ่มด่าน: แก้ยอดรับเข้าให้ต่ำกว่ายอดที่จ่ายออกไปแล้วไม่ได้
--     และเปลี่ยนหน่วยไม่ได้เมื่อมีใบจ่ายออกแล้ว (ไม่งั้นยอดคนละหน่วยจะมาลบกัน)
--
-- สิทธิ์ = can_manage_fg() เดิม (ฝ่ายคลัง + หัวหน้าคลัง + ผู้บริหาร + admin)
-- รัน "หลัง" 0096 · ไม่มี enum ใหม่ · รันซ้ำได้
-- ============================================================


-- ------------------------------------------------------------
-- (1) fg_dispatches
-- ------------------------------------------------------------
create table if not exists public.fg_dispatches (
  id              uuid primary key default gen_random_uuid(),
  fg_id           uuid not null references public.fg_inventory(id) on delete cascade,
  job_id          uuid not null references public.jobs(id) on delete cascade,
  qty             numeric(14,2) not null check (qty > 0),
  dispatched_date date not null default current_date,
  doc_no          text,            -- เลขที่ใบส่งของ / ใบเบิก
  customer        text,            -- ส่งให้ใคร (ค่าเริ่มต้น = ลูกค้าของออเดอร์)
  note            text,
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id),
  created_by      uuid references public.profiles(id),
  updated_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1
);

create index if not exists idx_fg_dispatches_fg   on public.fg_dispatches(fg_id);
create index if not exists idx_fg_dispatches_job  on public.fg_dispatches(job_id);
create index if not exists idx_fg_dispatches_date on public.fg_dispatches(dispatched_date);
create index if not exists idx_fg_inventory_received on public.fg_inventory(received_date);

drop trigger if exists trg_meta_fg_dispatches on public.fg_dispatches;
create trigger trg_meta_fg_dispatches before insert or update on public.fg_dispatches
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_fg_dispatches on public.fg_dispatches;
create trigger trg_audit_fg_dispatches after insert or update or delete on public.fg_dispatches
  for each row execute function public.log_audit();

-- อ่านได้ทุกคนที่ล็อกอิน · เขียนผ่าน RPC เท่านั้น (ไม่มี write policy — แนวเดียวกับ 0076)
alter table public.fg_dispatches enable row level security;
drop policy if exists read_fg_dispatches on public.fg_dispatches;
create policy read_fg_dispatches on public.fg_dispatches
  for select to authenticated using (true);

do $$ begin
  alter publication supabase_realtime add table public.fg_dispatches;
exception when duplicate_object then null; end $$;

comment on table public.fg_dispatches is
  'ใบจ่ายออก FG (Part G 0097) — คงคลัง = fg_inventory.qty − sum(qty ที่ deleted_at is null) · หน่วยตาม fg_inventory.unit';


-- ------------------------------------------------------------
-- (2) fg_dispatched_qty — ยอดจ่ายออกรวม (ไม่นับใบที่ถูกลบ) ของรายการคลัง 1 รายการ
-- ------------------------------------------------------------
create or replace function public.fg_dispatched_qty(p_fg_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(qty), 0) from public.fg_dispatches
   where fg_id = p_fg_id and deleted_at is null;
$$;

revoke execute on function public.fg_dispatched_qty(uuid) from public;
revoke execute on function public.fg_dispatched_qty(uuid) from anon;
grant  execute on function public.fg_dispatched_qty(uuid) to authenticated;


-- ------------------------------------------------------------
-- (3) add_fg_dispatch — บันทึกจ่ายออก · จ่ายรวมต้องไม่เกินยอดรับเข้า
-- ------------------------------------------------------------
create or replace function public.add_fg_dispatch(
  p_job_id          uuid,
  p_qty             numeric,
  p_dispatched_date date default null,
  p_doc_no          text default null,
  p_customer        text default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile  uuid;
  v_fg       public.fg_inventory%rowtype;
  v_used     numeric;
  v_date     date;
  v_customer text;
  v_id       uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_fg() then
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารบันทึกจ่ายออกได้';
  end if;

  -- ล็อกแถวคลังกันจ่ายซ้อนจากสองแท็บจนเกินยอด
  select * into v_fg from public.fg_inventory where job_id = p_job_id for update;
  if v_fg.id is null then raise exception 'งานนี้ยังไม่ได้รับเข้าคลัง — จ่ายออกไม่ได้'; end if;

  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนจ่ายออกต้องมากกว่า 0'; end if;

  v_used := public.fg_dispatched_qty(v_fg.id);
  if v_used + p_qty > v_fg.qty then
    raise exception 'จ่ายออกเกินยอดคงคลัง — คงเหลือ % %', (v_fg.qty - v_used), v_fg.unit;
  end if;

  v_date := coalesce(p_dispatched_date, current_date);
  if v_date > current_date + 1 then raise exception 'วันที่จ่ายออกล่วงหน้าเกินไป'; end if;

  select o.customer into v_customer
    from public.jobs j join public.orders o on o.id = j.order_id
   where j.id = p_job_id;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'จ่ายออกคลัง FG', true);

  insert into public.fg_dispatches
    (fg_id, job_id, qty, dispatched_date, doc_no, customer, note, created_by, updated_by)
  values
    (v_fg.id, p_job_id, p_qty, v_date,
     nullif(btrim(coalesce(p_doc_no, '')), ''),
     coalesce(nullif(btrim(coalesce(p_customer, '')), ''), v_customer),
     nullif(btrim(coalesce(p_note, '')), ''),
     v_profile, v_profile)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function public.add_fg_dispatch(uuid, numeric, date, text, text, text) from public;
revoke execute on function public.add_fg_dispatch(uuid, numeric, date, text, text, text) from anon;
grant  execute on function public.add_fg_dispatch(uuid, numeric, date, text, text, text) to authenticated;


-- ------------------------------------------------------------
-- (4) delete_fg_dispatch — soft delete + บังคับเหตุผล (ยอดกลับเข้าคงคลัง)
-- ------------------------------------------------------------
create or replace function public.delete_fg_dispatch(
  p_id     uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile uuid;
  v_row     public.fg_dispatches%rowtype;
  v_reason  text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_fg() then
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารลบรายการจ่ายออกได้';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'กรุณาระบุเหตุผลที่ลบ'; end if;

  select * into v_row from public.fg_dispatches where id = p_id for update;
  if v_row.id is null then raise exception 'ไม่พบรายการที่เลือก'; end if;
  if v_row.deleted_at is not null then raise exception 'รายการนี้ถูกลบไปแล้ว'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ลบรายการจ่ายออก FG: ' || v_reason, true);

  update public.fg_dispatches
     set deleted_at = now(),
         deleted_by = v_profile,
         updated_by = v_profile
   where id = p_id;
end;
$fn$;

revoke execute on function public.delete_fg_dispatch(uuid, text) from public;
revoke execute on function public.delete_fg_dispatch(uuid, text) from anon;
grant  execute on function public.delete_fg_dispatch(uuid, text) to authenticated;


-- ------------------------------------------------------------
-- (5) receive_fg — ยกบอดี้ 0023 · เพิ่มด่าน 2 ข้อเมื่อมีใบจ่ายออกแล้ว
-- ------------------------------------------------------------
create or replace function public.receive_fg(
  p_job_id   uuid,
  p_qty      numeric,
  p_unit     text default null,
  p_location text default null,
  p_lot_no   text default null,
  p_note     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_id      uuid;
  v_status  job_status;
  v_product uuid;
  v_lot     text;
  v_unit    text;
  v_old     public.fg_inventory%rowtype;   -- Part G (0097)
  v_used    numeric;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_fg() then
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารรับเข้าคลัง FG ได้';
  end if;

  select j.status, o.product_id, b.lot_no, o.unit
    into v_status, v_product, v_lot, v_unit
  from public.jobs j
  join public.orders o on o.id = j.order_id
  left join public.batches b on b.id = j.batch_id
  where j.id = p_job_id;

  if v_status is null then raise exception 'ไม่พบงานที่เลือก'; end if;
  if v_status <> 'finished_goods' then
    raise exception 'รับเข้าคลังได้เฉพาะงานที่ถึงสถานะ FG แล้ว';
  end if;
  if p_qty is null or p_qty < 0 then raise exception 'จำนวนห้ามว่างหรือติดลบ'; end if;

  -- Part G (0097): มีใบจ่ายออกแล้ว → ยอดรับเข้าต้องไม่ต่ำกว่ายอดจ่าย และห้ามเปลี่ยนหน่วย
  select * into v_old from public.fg_inventory where job_id = p_job_id for update;
  if v_old.id is not null then
    v_used := public.fg_dispatched_qty(v_old.id);
    if v_used > 0 then
      if p_qty < v_used then
        raise exception 'ยอดรับเข้าต่ำกว่ายอดที่จ่ายออกไปแล้ว (% %)', v_used, v_old.unit;
      end if;
      if coalesce(nullif(btrim(coalesce(p_unit, '')), ''), v_old.unit) <> v_old.unit then
        raise exception 'เปลี่ยนหน่วยไม่ได้ — มีรายการจ่ายออกเป็นหน่วย "%" แล้ว', v_old.unit;
      end if;
    end if;
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'รับเข้าคลัง FG', true);

  insert into public.fg_inventory
    (job_id, product_id, lot_no, qty, unit, location, note, created_by)
  values
    (p_job_id, v_product,
     coalesce(nullif(btrim(coalesce(p_lot_no, '')), ''), v_lot),
     p_qty,
     coalesce(nullif(btrim(coalesce(p_unit, '')), ''), v_unit, 'เม็ด'),
     nullif(btrim(coalesce(p_location, '')), ''),
     nullif(btrim(coalesce(p_note, '')), ''),
     v_profile)
  on conflict (job_id) do update
    set qty = excluded.qty,
        unit = excluded.unit,
        lot_no = excluded.lot_no,
        location = excluded.location,
        note = excluded.note,
        updated_by = v_profile
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.receive_fg(uuid, numeric, text, text, text, text)
  to authenticated;


-- ============================================================
-- ✅ ตรวจหลัง paste
--   select to_regclass('public.fg_dispatches');                                      -- fg_dispatches
--   select proname, count(*) from pg_proc
--    where proname in ('add_fg_dispatch','delete_fg_dispatch','fg_dispatched_qty','receive_fg')
--    group by proname;                                                                -- ตัวละ 1
--   select prosrc like '%fg_dispatched_qty%' from pg_proc where proname = 'receive_fg'; -- true
--   select count(*) from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'fg_dispatches';              -- 1
-- ============================================================
