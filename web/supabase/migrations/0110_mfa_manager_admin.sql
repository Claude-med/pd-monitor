-- ============================================================
-- PD Monitor — ยืนยันตัวตน 2 ชั้น (MFA) สำหรับผู้บริหาร/ผู้ดูแลระบบ / 0110_mfa_manager_admin.sql
--
-- 🎯 role manager / admin มีผลในฐานข้อมูล "เฉพาะ" session ที่ยืนยันรหัส 6 หลักแล้ว (JWT aal = aal2)
--    session ที่ใส่แค่รหัสผ่าน (aal1) → ฐานข้อมูลมองเหมือนไม่มี role manager/admin
--    ⇒ รหัสผ่านผู้บริหารหลุด แต่ไม่มีมือถือ = ยิง RPC ตรงด้วยสิทธิ์ผู้บริหารไม่ได้
--
-- 🔧 แก้ helper 2 ตัวที่ตัดสิน role ทั้งระบบ (ยกบอดี้ 0107 · เพิ่มเงื่อนไขเดียว)
--    · has_role()       — ใช้ทุก RPC/RLS ที่เช็กสิทธิ์ (admin ผ่านทุก role)
--    · has_exact_role() — ใช้กับด่านที่ต้องเป็น role นั้นตรง ๆ
--    is_any_lead / current_head_depts ไม่เกี่ยว (นับเฉพาะ role หัวหน้า *_lead)
--    ตรวจแล้ว: ไม่มีฟังก์ชันอื่นที่อ่าน user_roles ของ "ผู้ใช้ปัจจุบัน" ตรง ๆ (0092/0082 อ่าน role ของคนอื่น)
--
-- ℹ️ คู่กับฝั่งแอป: lib/auth/mfa.ts · getProfile() ตัด role เดียวกันออก · (app)/layout.tsx เด้งไป /mfa
--    คนอื่นทุก role ไม่กระทบ
-- 🚨 ลำดับ: push โค้ดแอป (มีหน้า /mfa) ขึ้นเว็บ "ก่อน" แล้วค่อย paste ไฟล์นี้
--    ถ้า paste ก่อน ผู้บริหารจะไม่มีสิทธิ์ในฐานข้อมูล แต่ยังไม่มีหน้าให้ตั้ง MFA
-- รัน "หลัง" 0109 · รันซ้ำได้
-- ============================================================

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
       and p.is_active
       and p.deleted_at is null
       and not p.must_change_password             -- 0107
       and (ur.role::text not in ('manager', 'admin')
            or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2')   -- 0110
       and (
            ur.role = _role                           -- มี role นั้นตรง ๆ
         or ur.role::text = 'admin'                   -- admin ผ่านทุก role (0013)
         or ur.role::text = _role::text || '_lead'    -- หัวหน้าฝ่าย ผ่านสิทธิ์ของฝ่ายตัวเอง (0078)
       )
  );
$$;

create or replace function public.has_exact_role(_role app_role)
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
       and p.is_active
       and p.deleted_at is null
       and not p.must_change_password             -- 0107
       and (ur.role::text not in ('manager', 'admin')
            or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2')   -- 0110
       and ur.role = _role
  );
$$;


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ)
--
-- ข้อ 1 · helper ทั้ง 2 ตัวมีเงื่อนไข aal2 แล้ว และด่านเดิม (ระงับบัญชี · ตั้งรหัสใหม่) ยังอยู่
--   select proname,
--          prosrc like '%aal2%' and prosrc like '%must_change_password%' and prosrc like '%is_active%' as ok
--     from pg_proc
--    where proname in ('has_role','has_exact_role')
--    order by proname;
--   ✅ 2 แถว ok = true ทั้งคู่   ❌ มี false = ไฟล์รันไม่ครบ → paste ใหม่ทั้งไฟล์
--
-- ข้อ 2 · ใน SQL Editor (ไม่มีผู้ใช้ล็อกอิน) helper ต้องตอบ false เหมือนเดิม — ไม่ได้เปิดช่องเพิ่ม
--   select public.has_role('manager') as manager, public.has_role('production') as production;
--   ✅ false · false   ❌ มี true = แจ้ง Claude ทันที
--
-- ข้อ 3 · (ดูเฉย ๆ) บัญชีที่จะถูกบังคับตั้ง MFA ตอนล็อกอินครั้งถัดไป
--   select p.full_name, p.email, string_agg(ur.role::text, ', ') as roles
--     from public.profiles p join public.user_roles ur on ur.profile_id = p.id
--    where ur.role::text in ('manager', 'admin') and p.deleted_at is null
--    group by p.full_name, p.email order by p.full_name;
--   ℹ️ ได้กี่แถวก็ได้ — ทุกบัญชีในรายการต้องมีแอป Authenticator ในมือถือ
-- ============================================================
