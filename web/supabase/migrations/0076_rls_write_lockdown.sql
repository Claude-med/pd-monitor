-- ============================================================
-- PD Monitor — ระบบสิทธิ์ (Part E) / 0076_rls_write_lockdown.sql
-- 🔴 ปิดช่องโหว่: RLS เปิดให้ client เขียน 5 ตารางหลักตรง ๆ ข้ามด่าน GMP ทั้งหมด
--   (1) drop write_products / write_orders / write_batches
--   (2) drop write_jobs / write_production_records
-- รัน "หลัง" 0075
--
-- 🚨 ที่มาของช่องโหว่:
--    0003_rls.sql:22-24 เขียนเจตนาไว้ชัดว่า "ไม่มี policy insert/update/delete ให้ client
--    = เขียนจาก client ไม่ได้ · การเขียนจริงไปผ่าน Server Actions"
--    แต่ 0004_auth_roles.sql:126-165 และ 0005_fix_auth_roles_meta.sql:121-160
--    กลับสร้าง policy `for all to authenticated` ขึ้นมา แล้ว "ไม่เคยถูกย้อนเลย" ตลอด 0006–0075
--
--    ผลจริง: ผู้ใช้ที่ล็อกอินและถือ role production/qc/qa/manager เปิด devtools แล้วยิง
--      PATCH /rest/v1/jobs?id=eq.<uuid>   { "status": "finished_goods" }
--    ด้วย publishable key + JWT ของตัวเอง → เปลี่ยนสถานะงานได้ทันที โดยข้าม:
--      · ลำดับสถานะ (state machine ใน advance_job_status)
--      · ด่านเลขล็อต (0062:379) · ด่าน in-process QC ครบ (0062:389)
--      · ด่าน Incident เปิดค้าง (0062:399) · e-signature + ตาราง approvals (0008)
--      · app.audit_reason → audit_log ได้แถวที่ไม่มีเหตุผล/ผู้ทำที่ถูกต้อง
--    เช่นเดียวกัน production ใส่/ลบ production_records ตรงได้ ข้าม add_production_record
--    ทั้งด่านสถานะ in_production · ด่าน Line Clearance · ด่านเครื่องตรงสถานี · idempotency
--
-- ✅ ตรวจแล้วว่าลบทิ้งได้ปลอดภัย:
--    ไล่ .insert( / .update( / .delete( / .upsert( ทั้ง web/app และ web/lib —
--    ไม่มีที่ไหนเขียน 5 ตารางนี้ตรง ๆ เลยสักจุด (ที่เจอเป็น Set.delete() ใน print-view ล้วน)
--    ทุกเส้นทางเขียนวิ่งผ่าน RPC security definer ซึ่งข้าม RLS อยู่แล้ว
--
-- ℹ️ policy อ่าน (read_authenticated) คงไว้เหมือนเดิมทุกตาราง — แค่ปิดฝั่ง "เขียน"
--    หลังไฟล์นี้ 5 ตารางนี้จะเป็น RPC-only เหมือนตารางรุ่นหลัง (0053 ขึ้นไป) ที่ทำถูกอยู่แล้ว
-- ============================================================

-- ------------------------------------------------------------
-- 1) ตารางข้อมูลหลัก — products / orders / batches
--    เขียนผ่าน: create_product · create_production_jobs · set_job_lot · update_job_details ฯลฯ
-- ------------------------------------------------------------
drop policy if exists write_products on public.products;
drop policy if exists write_orders   on public.orders;
drop policy if exists write_batches  on public.batches;

-- ------------------------------------------------------------
-- 2) ตารางที่ผูกกับด่าน GMP โดยตรง — jobs / production_records
--    เขียนผ่าน: advance_job_status · sign_job_decision · add_production_record ฯลฯ
-- ------------------------------------------------------------
drop policy if exists write_jobs               on public.jobs;
drop policy if exists write_production_records on public.production_records;

-- ------------------------------------------------------------
-- ตรวจผลหลัง paste — ต้องเหลือแต่ policy ชื่อ read_* เท่านั้น (cmd = SELECT)
-- ------------------------------------------------------------
-- select tablename, policyname, cmd
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('products','orders','batches','jobs','production_records')
--  order by tablename, policyname;
