-- ============================================================
-- PD Monitor — 0035_delete_job.sql  (ข้อ 2: ลบงานในบอร์ด)
--   ลบงานได้เฉพาะ manager/admin · ตารางลูกทั้งหมดผูก job_id 'on delete cascade'
--   → ลบตามอัตโนมัติ (production_records/approvals/material_requisitions/line_clearances/
--     fg_inventory/deviations/deviation_comments/notifications/job_routes/inprocess_checks/
--     qa_samples/edit_requests) · audit_log = append-only เก็บประวัติการลบไว้
--   ลบ order/batch ที่กำพร้าตามไปด้วย (สร้างมาคู่กับงานตอน create_job_with_order)
-- ⚠️ หมายเหตุ: ใบเบิกที่จ่ายแล้ว (issued) ตัดสต็อกไปแล้ว การลบงานจะ "ไม่คืนสต็อก" ให้อัตโนมัติ
--   (กรณีลบงานที่สร้างผิด มักยังไม่ได้จ่ายวัตถุดิบ) — ถ้าต้องคืนสต็อกให้ปรับที่เมนูวัตถุดิบเอง
-- รัน "หลัง" 0001–0034
-- ============================================================

create or replace function public.delete_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_job_no  text;
  v_order   uuid;
  v_batch   uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not (public.has_role('manager') or public.has_role('admin')) then
    raise exception 'เฉพาะผู้บริหาร/ผู้ดูแลระบบลบงานได้';
  end if;

  select job_no, order_id, batch_id into v_job_no, v_order, v_batch
    from public.jobs where id = p_job_id for update;
  if v_job_no is null then raise exception 'ไม่พบงานที่จะลบ'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'ลบงาน ' || v_job_no, true);

  -- ลบงาน → ตารางลูก on delete cascade ลบตาม (trigger audit ของแต่ละตารางยังทำงาน)
  delete from public.jobs where id = p_job_id;

  -- ลบ batch ที่กำพร้า (ไม่มีงานอื่นใช้)
  if v_batch is not null
     and not exists (select 1 from public.jobs where batch_id = v_batch) then
    delete from public.batches where id = v_batch;
  end if;

  -- ลบ order ที่กำพร้า (ไม่มีงาน/แบตช์อื่นใช้)
  if v_order is not null
     and not exists (select 1 from public.jobs    where order_id = v_order)
     and not exists (select 1 from public.batches where order_id = v_order) then
    delete from public.orders where id = v_order;
  end if;
end;
$$;

grant execute on function public.delete_job(uuid) to authenticated;
