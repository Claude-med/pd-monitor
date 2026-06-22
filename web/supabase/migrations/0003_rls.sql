-- ============================================================
-- PD Monitor — D2 / 0003_rls.sql
-- เปิด RLS ทุกตาราง (default-deny) ตั้งแต่ D2 (B1)
-- D2 = baseline: ผู้ใช้ที่ login แล้ว (authenticated) "อ่าน" ได้
--      ส่วนการ "เขียน" ทำผ่าน server (secret key bypass RLS, server-first B3)
-- D3 = ใส่ helper has_role() + policy แยกตาม role ทับของชุดนี้
-- รัน "หลัง" 0001 และ 0002
-- ============================================================

-- เปิด RLS ทุกตาราง
alter table public.profiles            enable row level security;
alter table public.user_roles          enable row level security;
alter table public.products            enable row level security;
alter table public.orders              enable row level security;
alter table public.batches             enable row level security;
alter table public.jobs                enable row level security;
alter table public.production_records  enable row level security;
alter table public.audit_log           enable row level security;

-- ------------------------------------------------------------
-- baseline read policy: authenticated อ่านได้ทุกตาราง
-- (จะถูกแทนที่ด้วย policy ตาม role ใน D3)
-- ไม่มี policy insert/update/delete ให้ client = เขียนจาก client ไม่ได้
-- การเขียนจริงไปผ่าน Server Actions ที่ใช้ secret key (ข้าม RLS)
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_roles','products','orders','batches','jobs','production_records'
  ] loop
    execute format('drop policy if exists read_authenticated on public.%I;', t);
    execute format(
      'create policy read_authenticated on public.%I for select to authenticated using (true);', t
    );
  end loop;
end $$;

-- audit_log: อ่านได้เฉพาะ authenticated (D3 จะจำกัดเหลือ manager/qa)
-- ไม่มี policy เขียน → client เขียนตรงไม่ได้ (insert เกิดผ่าน trigger security definer เท่านั้น)
drop policy if exists read_authenticated on public.audit_log;
create policy read_authenticated on public.audit_log for select to authenticated using (true);
