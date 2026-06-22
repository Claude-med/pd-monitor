-- ============================================================
-- PD Monitor — D2 / 0002_audit_log.sql
-- Audit trail แบบ append-only ผ่าน Postgres trigger (A1)
-- บันทึกทุก INSERT/UPDATE/DELETE: ใคร เวลา ตาราง record ค่าเก่า->ใหม่ เหตุผล
-- รัน "หลัง" 0001
-- ============================================================

-- ------------------------------------------------------------
-- ตาราง audit_log — แก้/ลบไม่ได้
-- ------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   uuid,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid references public.profiles(id),  -- ดึงจาก app.current_profile_id
  reason      text,                                  -- ดึงจาก app.audit_reason (เช่น เหตุผลตอน reject)
  changed_at  timestamptz not null default now()     -- เวลา server เสมอ
);

create index if not exists idx_audit_table_record on public.audit_log(table_name, record_id);
create index if not exists idx_audit_changed_at   on public.audit_log(changed_at);
create index if not exists idx_audit_changed_by   on public.audit_log(changed_by);

-- ------------------------------------------------------------
-- ฟังก์ชัน log — SECURITY DEFINER เพื่อให้เขียน audit_log ได้
-- แม้ผู้เรียกถูก RLS จำกัด (กัน bypass)
-- ดึง "ใครทำ" + "เหตุผล" จาก session GUC ที่ฝั่ง server ตั้งก่อนเขียน:
--   set local app.current_profile_id = '<uuid>';
--   set local app.audit_reason       = 'เหตุผล...';
-- ------------------------------------------------------------
create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old       jsonb;
  v_new       jsonb;
  v_record_id uuid;
  v_actor     uuid;
begin
  begin
    v_actor := nullif(current_setting('app.current_profile_id', true), '')::uuid;
  exception when others then
    v_actor := null;
  end;

  if (tg_op = 'DELETE') then
    v_old := to_jsonb(old); v_new := null;        v_record_id := old.id;
  elsif (tg_op = 'UPDATE') then
    v_old := to_jsonb(old); v_new := to_jsonb(new); v_record_id := new.id;
  else -- INSERT
    v_old := null;          v_new := to_jsonb(new); v_record_id := new.id;
  end if;

  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by, reason)
  values (
    tg_table_name, v_record_id, tg_op, v_old, v_new, v_actor,
    nullif(current_setting('app.audit_reason', true), '')
  );

  if (tg_op = 'DELETE') then return old; end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- ผูก audit trigger ทุกตารางหลัก (AFTER = บันทึกค่าหลังผ่าน meta trigger แล้ว)
-- ไม่ผูกกับ audit_log เอง
-- ------------------------------------------------------------
drop trigger if exists trg_audit_profiles            on public.profiles;
drop trigger if exists trg_audit_user_roles          on public.user_roles;
drop trigger if exists trg_audit_products            on public.products;
drop trigger if exists trg_audit_orders              on public.orders;
drop trigger if exists trg_audit_batches             on public.batches;
drop trigger if exists trg_audit_jobs                on public.jobs;
drop trigger if exists trg_audit_production_records  on public.production_records;

create trigger trg_audit_profiles           after insert or update or delete on public.profiles
  for each row execute function public.log_audit();
create trigger trg_audit_user_roles         after insert or update or delete on public.user_roles
  for each row execute function public.log_audit();
create trigger trg_audit_products           after insert or update or delete on public.products
  for each row execute function public.log_audit();
create trigger trg_audit_orders             after insert or update or delete on public.orders
  for each row execute function public.log_audit();
create trigger trg_audit_batches            after insert or update or delete on public.batches
  for each row execute function public.log_audit();
create trigger trg_audit_jobs               after insert or update or delete on public.jobs
  for each row execute function public.log_audit();
create trigger trg_audit_production_records after insert or update or delete on public.production_records
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- กัน audit_log โดน UPDATE/DELETE (append-only จริง)
-- ------------------------------------------------------------
create or replace function public.prevent_audit_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log เป็น append-only — แก้ไข/ลบไม่ได้';
end;
$$;

drop trigger if exists trg_audit_no_change on public.audit_log;
create trigger trg_audit_no_change before update or delete on public.audit_log
  for each row execute function public.prevent_audit_change();

-- ถอนสิทธิ์ update/delete (กันชั้นที่สองนอกเหนือจาก trigger)
revoke update, delete on public.audit_log from anon, authenticated;
