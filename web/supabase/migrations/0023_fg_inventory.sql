-- ============================================================
-- PD Monitor — D11 / 0023_fg_inventory.sql  (A6 ก้อน 1: คลัง FG)
-- ตาราง fg_inventory = สต็อกสินค้าสำเร็จรูป (รับเข้าเมื่องานถึงสถานะ FG)
--   1 งาน → 1 รายการคลัง (unique job_id) · รับเข้า/แก้ผ่าน RPC receive_fg
-- เขียนผ่าน RPC security definer (warehouse/manager/admin)
-- รัน "หลัง" 0001–0022
-- ============================================================

-- ------------------------------------------------------------
-- fg_inventory — สต็อก FG ต่อ 1 งาน
-- ------------------------------------------------------------
create table if not exists public.fg_inventory (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  product_id    uuid references public.products(id),
  lot_no        text,
  qty           numeric(14,2) not null default 0 check (qty >= 0),
  unit          text not null default 'เม็ด',
  location      text,
  received_date date not null default current_date,
  note          text,
  created_by    uuid references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  unique (job_id)
);

create index if not exists idx_fg_inventory_product on public.fg_inventory(product_id);
create index if not exists idx_fg_inventory_lot     on public.fg_inventory(lot_no);

-- ------------------------------------------------------------
-- triggers: meta + audit
-- ------------------------------------------------------------
drop trigger if exists trg_meta_fg_inventory on public.fg_inventory;
create trigger trg_meta_fg_inventory before insert or update on public.fg_inventory
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_fg_inventory on public.fg_inventory;
create trigger trg_audit_fg_inventory after insert or update or delete on public.fg_inventory
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.fg_inventory enable row level security;

drop policy if exists read_fg_inventory on public.fg_inventory;
create policy read_fg_inventory on public.fg_inventory
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- helper: เฉพาะคลัง/ผู้บริหาร/admin จัดการคลัง FG ได้
-- ------------------------------------------------------------
create or replace function public.can_manage_fg()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('warehouse') or public.has_role('manager');
$$;

-- ------------------------------------------------------------
-- receive_fg — รับงานเข้าคลัง FG (upsert ต่อ 1 งาน)
--   ดึง product/lot จากงานให้อัตโนมัติ (lot ใส่ override ได้)
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

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.fg_inventory;
exception when duplicate_object then null; end $$;
