-- ============================================================
-- PD Monitor — เฟสหลัง / 0031_job_recipe_route.sql  (E1: ผูกสูตร/route กับงาน)
--   ยกระดับ recipe/route จาก master data → ผูกกับงานจริงตอนสร้าง
--   - jobs.recipe_id        = สูตร (active) ที่ใช้ผลิตงานนี้
--   - job_routes            = snapshot ลำดับสถานีของงาน (route เปลี่ยนภายหลังไม่กระทบงานเก่า — GMP)
--   - create_job_with_order = auto ผูกสูตร active + copy product_routes → job_routes
-- ⚠️ คง param + logic เดิมของ create_job_with_order ทุกประการ (แค่ต่อท้าย)
-- ⚠️ ไม่แตะ enum production_station เดิม
-- รัน "หลัง" 0001–0030
-- ============================================================

-- ------------------------------------------------------------
-- 1) jobs.recipe_id — สูตรที่ผูกกับงาน (nullable: งานเก่า/ยาไม่มีสูตร = null)
-- ------------------------------------------------------------
alter table public.jobs
  add column if not exists recipe_id uuid references public.product_recipes(id);

-- ------------------------------------------------------------
-- 2) job_routes — snapshot ลำดับสถานีต่องาน
--    station_group เก็บควบ (rollup กลุ่มเดิม) เพื่อ gate/แสดงผลไม่ต้อง join ซ้ำ
-- ------------------------------------------------------------
create table if not exists public.job_routes (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  station_id    uuid not null references public.stations(id),
  step_no       integer not null,
  station_group production_station not null,
  note          text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  unique (job_id, station_id)
);

create index if not exists idx_job_routes_job on public.job_routes(job_id);

-- audit (append-only traceability)
drop trigger if exists trg_audit_job_routes on public.job_routes;
create trigger trg_audit_job_routes after insert or update or delete on public.job_routes
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- RLS: authenticated อ่านได้ · เขียนผ่าน RPC (create_job_with_order) เท่านั้น
-- ------------------------------------------------------------
alter table public.job_routes enable row level security;
drop policy if exists read_job_routes on public.job_routes;
create policy read_job_routes on public.job_routes
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- 3) ยกเครื่อง create_job_with_order — คงเดิมทุกอย่าง + ผูกสูตร/route
-- ------------------------------------------------------------
create or replace function public.create_job_with_order(
  p_customer      text,
  p_product_id    uuid,
  p_quantity      numeric,
  p_unit          text,
  p_due_date      date,
  p_job_no        text,
  p_planned_start date default null,
  p_planned_end   date default null,
  p_lot_no        text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_order   uuid;
  v_batch   uuid;
  v_job     uuid;
  v_recipe  uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหาร/ฝ่ายวางแผนสร้างงานผลิตได้';
  end if;

  -- ---------- validate ----------
  p_job_no   := btrim(coalesce(p_job_no, ''));
  p_customer := btrim(coalesce(p_customer, ''));
  if p_job_no = ''   then raise exception 'กรุณาระบุเลขงาน (Job No)'; end if;
  if p_customer = '' then raise exception 'กรุณาระบุลูกค้า'; end if;
  if p_product_id is null then raise exception 'กรุณาเลือกผลิตภัณฑ์'; end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'จำนวนต้องมากกว่า 0';
  end if;
  if exists (select 1 from public.jobs where job_no = p_job_no) then
    raise exception 'เลขงาน % มีอยู่แล้ว — กรุณาใช้เลขอื่น', p_job_no;
  end if;
  if p_planned_start is not null and p_planned_end is not null
     and p_planned_end < p_planned_start then
    raise exception 'วันสิ้นสุดแผนต้องไม่ก่อนวันเริ่ม';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'สร้างงานผลิตใหม่ ' || p_job_no, true);

  -- ---------- order ----------
  insert into public.orders (order_no, customer, product_id, quantity, unit, due_date, created_by)
  values ('ORD-' || p_job_no, p_customer, p_product_id, p_quantity,
          coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'เม็ด'), p_due_date, v_profile)
  returning id into v_order;

  -- ---------- batch (ถ้าระบุล็อต) ----------
  if p_lot_no is not null and btrim(p_lot_no) <> '' then
    if exists (select 1 from public.batches where lot_no = btrim(p_lot_no)) then
      raise exception 'เลขล็อต % มีอยู่แล้ว', btrim(p_lot_no);
    end if;
    insert into public.batches (lot_no, order_id, product_id, created_by)
    values (btrim(p_lot_no), v_order, p_product_id, v_profile)
    returning id into v_batch;
  end if;

  -- ---------- auto เลือกสูตร active ของยา (ถ้ามี) ----------
  select id into v_recipe
  from public.product_recipes
  where product_id = p_product_id and is_active
  order by updated_at desc
  limit 1;

  -- ---------- job ----------
  insert into public.jobs
    (job_no, order_id, batch_id, recipe_id, status, planned_start, planned_end, created_by)
  values
    (p_job_no, v_order, v_batch, v_recipe, 'pending_announce', p_planned_start, p_planned_end, v_profile)
  returning id into v_job;

  -- ---------- copy route ของยา → job_routes (snapshot) ----------
  insert into public.job_routes (job_id, station_id, step_no, station_group, note, created_by)
  select v_job, pr.station_id, pr.step_no, s.station_group, pr.note, v_profile
  from public.product_routes pr
  join public.stations s on s.id = pr.station_id
  where pr.product_id = p_product_id;

  return p_job_no;
end;
$$;

grant execute on function public.create_job_with_order(
  text, uuid, numeric, text, date, text, date, date, text
) to authenticated;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.job_routes;
exception when duplicate_object then null; end $$;
