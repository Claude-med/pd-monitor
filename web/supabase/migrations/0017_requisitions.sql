-- ============================================================
-- PD Monitor — D10 / 0017_requisitions.sql  (A2 ก้อน 2: ใบเบิกวัตถุดิบ)
-- เบิกวัตถุดิบผูกกับงาน (job) → ฝ่ายคลัง "จ่าย" แล้วตัดสต็อกล็อต (atomic)
--   กันเบิกล็อตที่ไม่ผ่าน/หมดอายุ/สต็อกไม่พอ (validate ใน RPC ตอนจ่าย)
-- รัน "หลัง" 0001–0016
-- ============================================================

do $$ begin
  create type requisition_status as enum (
    'requested',  -- ขอเบิก (ยังไม่ตัดสต็อก)
    'issued',     -- จ่ายแล้ว (ตัดสต็อกแล้ว)
    'cancelled'   -- ยกเลิก
  );
exception when duplicate_object then null; end $$;

create table if not exists public.material_requisitions (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs(id) on delete cascade,
  material_lot_id uuid not null references public.material_lots(id),
  qty             numeric(14,2) not null check (qty > 0),
  status          requisition_status not null default 'requested',
  note            text,
  requested_by    uuid references public.profiles(id),
  issued_by       uuid references public.profiles(id),
  requested_at    timestamptz not null default now(),
  issued_at       timestamptz,
  created_by      uuid references public.profiles(id),
  updated_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1
);

create index if not exists idx_req_job    on public.material_requisitions(job_id);
create index if not exists idx_req_lot    on public.material_requisitions(material_lot_id);
create index if not exists idx_req_status on public.material_requisitions(status);

drop trigger if exists trg_meta_requisitions on public.material_requisitions;
create trigger trg_meta_requisitions before insert or update on public.material_requisitions
  for each row execute function public.set_row_meta();
drop trigger if exists trg_audit_requisitions on public.material_requisitions;
create trigger trg_audit_requisitions after insert or update or delete on public.material_requisitions
  for each row execute function public.log_audit();

alter table public.material_requisitions enable row level security;
drop policy if exists read_requisitions on public.material_requisitions;
create policy read_requisitions on public.material_requisitions
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- request_material — ขอเบิก (ฝ่ายผลิต/คลัง/ผู้บริหาร) · ยังไม่ตัดสต็อก
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
    raise exception 'สิทธิ์ของคุณเบิกวัตถุดิบไม่ได้ (เฉพาะฝ่ายผลิต/คลัง/ผู้บริหาร)';
  end if;

  select status into v_status from public.jobs where id = p_job_id;
  if v_status is null then raise exception 'ไม่พบงานนี้'; end if;
  if v_status = 'finished_goods' then
    raise exception 'งานนี้เข้าคลัง (FG) แล้ว เบิกวัตถุดิบเพิ่มไม่ได้';
  end if;

  select id, status, expiry_date into v_lot
    from public.material_lots where id = p_material_lot_id;
  if v_lot.id is null then raise exception 'ไม่พบล็อตวัตถุดิบที่เลือก'; end if;
  if v_lot.status in ('rejected', 'expired') then
    raise exception 'ล็อตนี้สถานะ % เบิกไม่ได้', v_lot.status;
  end if;
  if v_lot.expiry_date is not null and v_lot.expiry_date < current_date then
    raise exception 'ล็อตนี้หมดอายุแล้ว เบิกไม่ได้';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนที่เบิกต้องมากกว่า 0'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ขอเบิกวัตถุดิบ', true);

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
-- issue_requisition — จ่ายของ (ฝ่ายคลัง/ผู้บริหาร) · ตัดสต็อกล็อต (atomic)
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
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารจ่ายวัตถุดิบได้';
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
  if v_lot.id is null then raise exception 'ไม่พบล็อตวัตถุดิบ'; end if;
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
  perform set_config('app.audit_reason', 'จ่ายวัตถุดิบตามใบเบิก', true);

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
-- cancel_requisition — ยกเลิกใบเบิก (ผู้ขอ หรือ คลัง/ผู้บริหาร) · เฉพาะที่ยังไม่จ่าย
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
  perform set_config('app.audit_reason', 'ยกเลิกใบเบิกวัตถุดิบ', true);

  update public.material_requisitions
     set status = 'cancelled', updated_by = v_profile
   where id = p_id;
end;
$$;

grant execute on function public.cancel_requisition(uuid) to authenticated;

-- realtime
do $$ begin
  alter publication supabase_realtime add table public.material_requisitions;
exception when duplicate_object then null; end $$;
