-- ============================================================
-- PD Monitor — D3 / 0005_fix_auth_roles_meta.sql  (HOTFIX)
-- ใช้เมื่อ: รัน 0004 แล้วเจอ error
--   "record \"new\" has no field \"created_by\" ... set_row_meta()"
--
-- สาเหตุ: trigger set_row_meta() (จาก 0001) ถูกผูกกับ profiles
--   แต่ profiles ไม่มีคอลัมน์ created_by/updated_by (มีแค่ created_at/updated_at/version)
--   บรรทัด new.created_by := old.created_by ทำงานเฉพาะตอน UPDATE
--   → D2 (seed มีแต่ INSERT) เลยไม่ error · มาโผล่ตอน 0004 ที่ UPDATE profiles
--
-- ไฟล์นี้ self-contained: แก้ trigger + ทำงานทั้งหมดของ D3 ในไฟล์เดียว
-- (= รันแทน 0004 ได้เลย) · ปลอดภัย รันซ้ำได้ · ไม่ต้อง reset/ลบข้อมูล D2
-- รันใน Supabase SQL Editor ครั้งเดียว
-- ============================================================

-- ------------------------------------------------------------
-- 0) FIX ต้นเหตุ: trigger เฉพาะ profiles ที่ไม่อ้าง created_by
-- ------------------------------------------------------------
create or replace function public.set_profile_meta()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if (tg_op = 'UPDATE') then
    new.version    := coalesce(old.version, 1) + 1;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meta_profiles on public.profiles;
create trigger trg_meta_profiles
  before insert or update on public.profiles
  for each row execute function public.set_profile_meta();

-- ------------------------------------------------------------
-- 1) เพิ่ม email ใน profiles (ใช้จับคู่กับ auth.users)
-- ------------------------------------------------------------
alter table public.profiles add column if not exists email text unique;

update public.profiles set email = 'somchai.prod@pdmonitor.app' where id = '11111111-1111-1111-1111-111111111111' and email is null;
update public.profiles set email = 'somying.qc@pdmonitor.app'   where id = '22222222-2222-2222-2222-222222222222' and email is null;
update public.profiles set email = 'prapai.qa@pdmonitor.app'    where id = '33333333-3333-3333-3333-333333333333' and email is null;
update public.profiles set email = 'wichai.wh@pdmonitor.app'    where id = '44444444-4444-4444-4444-444444444444' and email is null;
update public.profiles set email = 'manop.mgr@pdmonitor.app'    where id = '55555555-5555-5555-5555-555555555555' and email is null;

-- ------------------------------------------------------------
-- 2) Trigger: auth user ใหม่ → ผูกเข้า profile ตามอีเมล (ไม่ตรง = สร้างใหม่)
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set auth_user_id = new.id
   where email = new.email
     and auth_user_id is null;

  if not found then
    insert into public.profiles (auth_user_id, email, full_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 3) Helper functions (security definer, wrap auth.uid() ตาม B1)
-- ------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles
   where auth_user_id = (select auth.uid())
   limit 1;
$$;

create or replace function public.has_role(_role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.profile_id
     where p.auth_user_id = (select auth.uid())
       and ur.role = _role
  );
$$;

-- ------------------------------------------------------------
-- 4) RLS policy แยกตาม role (ทับ baseline read_authenticated ใน 0003)
-- ------------------------------------------------------------

-- profiles: แก้ได้เฉพาะ profile ของตัวเอง
drop policy if exists update_own_profile on public.profiles;
create policy update_own_profile on public.profiles
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- products: manager เขียน
drop policy if exists write_products on public.products;
create policy write_products on public.products
  for all to authenticated
  using (public.has_role('manager'))
  with check (public.has_role('manager'));

-- orders: manager เขียน
drop policy if exists write_orders on public.orders;
create policy write_orders on public.orders
  for all to authenticated
  using (public.has_role('manager'))
  with check (public.has_role('manager'));

-- batches: production หรือ manager เขียน
drop policy if exists write_batches on public.batches;
create policy write_batches on public.batches
  for all to authenticated
  using (public.has_role('production') or public.has_role('manager'))
  with check (public.has_role('production') or public.has_role('manager'));

-- jobs: production/qc/qa/manager เขียน
drop policy if exists write_jobs on public.jobs;
create policy write_jobs on public.jobs
  for all to authenticated
  using (
    public.has_role('production') or public.has_role('qc')
    or public.has_role('qa') or public.has_role('manager')
  )
  with check (
    public.has_role('production') or public.has_role('qc')
    or public.has_role('qa') or public.has_role('manager')
  );

-- production_records: production หรือ manager เขียน
drop policy if exists write_production_records on public.production_records;
create policy write_production_records on public.production_records
  for all to authenticated
  using (public.has_role('production') or public.has_role('manager'))
  with check (public.has_role('production') or public.has_role('manager'));

-- audit_log: อ่านได้เฉพาะ manager/qa
drop policy if exists read_authenticated on public.audit_log;
drop policy if exists read_audit_log on public.audit_log;
create policy read_audit_log on public.audit_log
  for select to authenticated
  using (public.has_role('manager') or public.has_role('qa'));
