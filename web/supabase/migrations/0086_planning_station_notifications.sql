-- ============================================================
-- PD Monitor — Part Notification / 0086_planning_station_notifications.sql
--   ก้อน 3 "วางแผน · สถานี · ข้อมูลไม่ครบ" — requirement ที่เหลือทั้งหมดของหน้า Notion
--
--   (1) create_production_jobs → 🆕 งานใหม่เข้าระบบ            → planner (ไม่แจ้งคนสร้างเอง)
--   (2) delete_job             → 📅 งานถูกยกเลิก               → planner (ไม่แจ้งคนกดลบ)
--   (3) update_job_details     → 📅 แผนถูกเลื่อน                → planner (ไม่แจ้งคนแก้เอง)
--   (4) add_production_record  → ⏳ รอหัวหน้าอนุมัติ + 🏭 งานเข้าสถานี
--                                + 📦 พร้อมเข้าสถานีแพ็ค + 📋 ข้อมูลไม่ครบ
-- รัน "หลัง" 0085 · ไม่มี enum ใหม่ · ไม่เปลี่ยน signature ของ RPC ที่แอปเรียก · รันซ้ำได้
--
-- 🔑 3 เรื่องที่ requirement เขียนไว้ แต่ "ระบบไม่มีของแบบนั้นอยู่จริง" — ตีความแล้วดังนี้
--
--   ก. "Job ถูกยกเลิก"  → ระบบไม่มี job_status = 'cancelled' และไม่มี RPC ยกเลิกงาน
--      มีแต่ delete_job (0035) ⇒ ถือว่า "ยกเลิก = ลบงาน"
--   ข. "เลื่อนแผน"      → คือการแก้ plan_month / planned_start / planned_end
--      ผ่าน update_job_details (0071:524) ⇒ ยิงเฉพาะเมื่อค่าเปลี่ยนจริง
--   ค. "ไม่มีเวลาเริ่ม/เวลาสิ้นสุด" → production_records ไม่มีคอลัมน์นี้เลย
--      มีแต่ กะ (morning/night) · ช่วง (ปกติ/OT) · จำนวนนาที · และ "ผู้ปฏิบัติงาน" เก็บเป็น
--      ตัวเลข headcount ไม่ใช่รายชื่อ ⇒ ผู้ใช้ยืนยันให้ "เช็กจากช่องที่มีอยู่จริง"
--
-- 🔑 "งานเข้าสถานี" / "พร้อมเข้าแพ็ค" เอามาจากไหน
--    ไม่มีคอลัมน์ "สถานีปัจจุบัน" บน jobs และไม่มีค่า enum "แพ็ค" ใน job_status โดยตั้งใจ (0081:14-18)
--    ⇒ ใช้นิยามเดียวกับแดชบอร์ด Pending Order: ดูจากบันทึกผลผลิตที่ไม่ถูกตีกลับ + ธง stations.is_packing
--       (0081:166-194) — ไม่ต้องเพิ่มสถานะใหม่ ไม่มีใครต้องกดปุ่มเพิ่ม
--
-- 🚨 ยกบอดี้ล่าสุดมา "ทั้งก้อน" แล้ว diff เทียบทุกตัว (ธรรมเนียมโปรเจค)
--    create_production_jobs ← 0071:354-480 · update_job_details ← 0071:524-820
--    delete_job             ← 0035:13-58   · add_production_record ← 0063:108-284
-- ============================================================

-- ------------------------------------------------------------
-- (1) create_production_jobs — บอดี้ 0071:354-480 · เพิ่ม 🆕 แจ้งฝ่ายวางแผน
-- ------------------------------------------------------------
create or replace function public.create_production_jobs(
  p_customer_id    uuid,
  p_product_id     uuid,
  p_quantity       numeric,
  p_unit           text,
  p_due_date       date,
  p_request_no     text    default null,
  p_cpo_date       date    default null,
  p_sub_status     text    default null,
  p_pack_type      text    default null,
  p_pack_pattern_1 text    default null,
  p_pack_pattern_2 text    default null,
  p_pack_pattern_3 text    default null,
  p_count          integer default 1,
  p_company_id     uuid    default null,
  p_note           text    default null
)
returns text[]
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile  uuid;
  v_customer text;
  v_company  text;
  v_code     text;
  v_unit     text;
  v_request  text;
  v_sub      text;
  v_note     text;
  v_nos      text[];
  v_job_no   text;
  v_order    uuid;
  v_job      uuid;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'ยังไม่ได้เข้าสู่ระบบ';
  end if;
  if not public.can_plan_jobs() then
    raise exception 'เฉพาะฝ่ายวางแผน/ผู้บริหารสร้างงานผลิตได้';
  end if;

  -- ---------- validate ----------
  if p_company_id is null then raise exception 'กรุณาเลือกบริษัท'; end if;
  select name into v_company from public.companies where id = p_company_id and is_active;
  if v_company is null then raise exception 'ไม่พบบริษัทที่เลือก หรือบริษัทถูกปิดใช้งาน'; end if;

  if p_customer_id is null then raise exception 'กรุณาเลือกลูกค้า'; end if;
  select name into v_customer from public.customers where id = p_customer_id;
  if v_customer is null then raise exception 'ไม่พบลูกค้าที่เลือก'; end if;

  if p_product_id is null then raise exception 'กรุณาเลือกผลิตภัณฑ์'; end if;
  select code into v_code from public.products where id = p_product_id;
  if v_code is null then raise exception 'ไม่พบผลิตภัณฑ์ที่เลือก'; end if;

  -- ด่าน GMP (0045) — ห้ามถอด: ไม่มีขั้นตอนการผลิต = บันทึกผลผลิต/ตรวจ in-process ไม่ได้
  if not public.product_has_route(p_product_id) then
    raise exception
      'ผลิตภัณฑ์ % ยังไม่ได้ตั้งขั้นตอนการผลิต — ไปตั้งที่หน้า "ผลิตภัณฑ์ / ขั้นตอนการผลิต" ก่อนสร้างงาน', v_code;
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Batch size ต้องมากกว่า 0';
  end if;

  if p_count is null or p_count < 1 then
    raise exception 'จำนวนใบที่จะสร้างต้องอย่างน้อย 1 ใบ';
  end if;
  if p_count > 50 then
    raise exception 'สร้างได้สูงสุด 50 ใบต่อครั้ง (ขอมา % ใบ)', p_count;
  end if;

  v_unit    := coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'เม็ด');
  v_request := nullif(btrim(coalesce(p_request_no, '')), '');
  v_sub     := nullif(btrim(coalesce(p_sub_status, '')), '');
  v_note    := nullif(btrim(coalesce(p_note, '')), '');

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason',
    'สร้างงานผลิต ' || p_count || ' ใบ · ' || v_company || ' · ' || v_code || ' · ลูกค้า ' || v_customer
    || coalesce(' · ใบคำขอ ' || v_request, ''), true);

  -- ---------- จองเลขงานทั้งชุด (แยกตามบริษัท) ----------
  v_nos := public.next_job_nos(p_company_id, p_count);

  foreach v_job_no in array v_nos loop
    insert into public.orders
      (order_no, customer, customer_id, product_id, quantity, unit, due_date, created_by)
    values
      ('ORD-' || v_job_no, v_customer, p_customer_id, p_product_id,
       p_quantity, v_unit, p_due_date, v_profile)
    returning id into v_order;

    insert into public.jobs
      (job_no, order_id, batch_id, status,
       request_no, cpo_date, sub_status,
       pack_type, pack_pattern_1, pack_pattern_2, pack_pattern_3,
       company_id, company, note, created_by)
    values
      (v_job_no, v_order, null, 'pending_announce',
       v_request, p_cpo_date, v_sub,
       nullif(btrim(coalesce(p_pack_type, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_1, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_2, '')), ''),
       nullif(btrim(coalesce(p_pack_pattern_3, '')), ''),
       p_company_id, v_company, v_note,
       v_profile)
    returning id into v_job;

    -- snapshot ขั้นตอนการผลิตตาม GMP — กรองสถานีที่ปิดใช้งานออก (0045)
    insert into public.job_routes (job_id, station_id, step_no, note, created_by)
    select v_job, pr.station_id, pr.step_no, pr.note, v_profile
      from public.product_routes pr
      join public.stations s on s.id = pr.station_id
     where pr.product_id = p_product_id
       and s.is_active;
  end loop;

  -- 0086: ฝ่ายวางแผนต้องรู้ว่ามีงานใหม่เข้าระบบ
  --   role 'planner' ไม่เคยได้รับแจ้งเตือนสักใบตั้งแต่ระบบเกิด — งานเกิดที่ pending_announce
  --   แล้วรอให้คนเปิดหน้าเว็บมาเจอเอง
  --   ยิง "ใบสรุปใบเดียวต่อการสร้าง 1 ครั้ง" ไม่ใช่ใบละงาน (สร้างได้ทีละ 50 ใบ · 0048)
  --   skip_creator = true → ตรงตาม requirement "Job ใหม่เข้าระบบ ถ้าเป็นคนสร้างเองไม่ต้องแจ้ง"
  --   ผูก job_no ของใบแรกไว้ให้กดลิงก์ไปดูได้ แต่ job_id = null เพราะใบนี้พูดถึงงานทั้งชุด
  perform public.create_notification(
    'job_new',
    case when p_count > 1
         then 'มีงานใหม่เข้าระบบ ' || p_count || ' ใบ'
         else 'มีงานใหม่เข้าระบบ — ' || v_nos[1] end,
    v_company || ' · ' || v_code || ' · ลูกค้า ' || v_customer
      || case when p_count > 1 then ' · เลขงาน ' || v_nos[1] || ' – ' || v_nos[p_count] else '' end,
    null::uuid, v_nos[1], 'planner'::app_role, null::job_status, null::uuid, true);

  return v_nos;
end;
$fn$;

grant execute on function public.create_production_jobs(
  uuid, uuid, numeric, text, date, text, date, text, text, text, text, text, integer, uuid, text
) to authenticated;

-- ------------------------------------------------------------
-- (2) delete_job — บอดี้ 0035:13-58 · เพิ่ม 📅 "งานถูกยกเลิก" (ยิงก่อน delete + ไม่ผูก job_id)
-- ------------------------------------------------------------
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

  -- 0086: แจ้งฝ่ายวางแผนว่างานถูกยกเลิก (ระบบไม่มีสถานะ 'cancelled' — "ยกเลิกงาน" = ลบงาน)
  --
  -- 🚨 ต้องยิง "ก่อน" delete และต้องส่ง p_job_id = null เด็ดขาด
  --    notifications.job_id เป็น on delete cascade (0026:18) ⇒ ถ้าผูก job_id ไว้
  --    แจ้งเตือนใบนี้จะถูกลบทิ้งพร้อมงานในบรรทัดถัดไปทันที (ไม่มีใครได้เห็นเลย)
  --    job_no เก็บแยกเป็น text อยู่แล้วด้วยเหตุผลนี้พอดี (0026:19 "เก็บไว้ทำลิงก์ กันงานถูกลบ")
  --    skip_creator = true → ผู้บริหารที่กดลบเองไม่ต้องได้ใบแจ้งของตัวเอง
  perform public.create_notification(
    'job_plan',
    'งาน ' || v_job_no || ' ถูกยกเลิก (ลบออกจากระบบ)',
    'ข้อมูลทั้งหมดของงานนี้ถูกลบแล้ว — ดูร่องรอยได้ที่หน้าประวัติ/Audit',
    null::uuid, v_job_no, 'planner'::app_role, null::job_status, null::uuid, true);

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

comment on function public.delete_job(uuid) is
  'ลบงาน (ผู้บริหาร/แอดมิน) — ตารางลูก cascade ตาม · 0086 แจ้งฝ่ายวางแผนว่างานถูกยกเลิก (ใบแจ้งไม่ผูก job_id เพื่อไม่ให้ถูก cascade ลบตาม)';

-- ------------------------------------------------------------
-- (3) update_job_details — บอดี้ 0071:524-820 · เพิ่ม 📅 "แผนถูกเลื่อน" เมื่อวันแผนเปลี่ยนจริง
-- ------------------------------------------------------------
create or replace function public.update_job_details(
  p_job_id uuid,
  p_fields jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_seq constant text[] := array[
    'pending_announce', 'planned', 'in_production', 'qc', 'qa', 'finished_goods'
  ];
  v_profile   uuid;
  v_job       record;
  v_idx       integer;
  v_can_plan  boolean;
  v_can_prod  boolean;
  v_is_mgr    boolean;
  v_reason    text;
  v_bad       text;
  v_updated   text[] := '{}';
  v_sub       text;
  v_month     date;
  v_needs_mth boolean;
  v_qty       numeric;
  v_start     date;
  v_end       date;
  v_cust      uuid;
  v_lot       text;
  v_mfg       date;
  v_exp       date;
  v_labels    text;
  v_status_th text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if p_fields is null or p_fields = '{}'::jsonb then
    raise exception 'ไม่มีข้อมูลที่จะบันทึก';
  end if;

  select j.id, j.job_no, j.status, j.batch_id, j.order_id, j.sub_status, j.plan_month,
         j.planned_start, j.planned_end,
         o.quantity, o.due_date,
         b.lot_no, b.manufacture_date, b.expiry_date
    into v_job
    from public.jobs j
    join public.orders o on o.id = j.order_id
    left join public.batches b on b.id = j.batch_id
   where j.id = p_job_id
   for update of j;

  if v_job.id is null then raise exception 'ไม่พบงานที่เลือก'; end if;

  v_idx      := array_position(v_order_seq, v_job.status::text);
  v_can_plan := public.can_plan_jobs();
  v_can_prod := public.can_set_job_lot();
  v_is_mgr   := public.has_role('manager');
  v_status_th := case v_job.status::text
                   when 'pending_announce' then 'รอแจ้งผลิต'
                   when 'planned'          then 'มีแผนแล้ว'
                   when 'in_production'    then 'กำลังผลิต'
                   when 'qc'               then 'QC'
                   when 'qa'               then 'QA'
                   when 'finished_goods'   then 'FG (เข้าคลัง)'
                   else v_job.status::text end;
  v_reason   := nullif(btrim(coalesce(p_reason, '')), '');

  -- (ก) คีย์ที่ไม่รู้จัก = บั๊กฝั่งแอป ต้องดังทันที ไม่ปล่อยผ่านเงียบ
  select string_agg(k, ', ') into v_bad
    from jsonb_object_keys(p_fields) k
   where k not in (select r.key from public.job_field_rules() r);
  if v_bad is not null then
    raise exception 'ช่องที่ไม่รู้จัก: %', v_bad;
  end if;

  -- (ข) สิทธิ์ตามฝ่าย
  select string_agg(r.label, ' · ') into v_bad
    from jsonb_object_keys(p_fields) k
    join public.job_field_rules() r on r.key = k
   where not (
     case r.perm
       when 'plan' then v_can_plan
       when 'prod' then v_can_prod
       when 'both' then v_can_plan or v_can_prod
       when 'lot'  then v_can_prod or v_can_plan   -- วันผลิต/วันหมดอายุ: ฝ่ายวางแผนแก้ได้ถ้ามีล็อตแล้ว
       else false
     end
   );
  if v_bad is not null then
    raise exception 'ไม่มีสิทธิ์แก้ช่อง: %', v_bad;
  end if;

  -- (ค) ด่านล็อกตามสถานะ — ผู้บริหารข้ามได้ถ้าระบุเหตุผล
  select string_agg(r.label, ' · ') into v_bad
    from jsonb_object_keys(p_fields) k
    join public.job_field_rules() r on r.key = k
   where r.lock_from is not null and v_idx >= r.lock_from;
  if v_bad is not null then
    if not v_is_mgr then
      raise exception 'งาน % อยู่ในขั้น "%" แล้ว แก้ช่องนี้ไม่ได้: % (ต้องให้ผู้บริหารแก้พร้อมระบุเหตุผล)',
        v_job.job_no, v_status_th, v_bad;
    end if;
    if v_reason is null then
      raise exception 'การแก้ช่องที่ถูกล็อก (%) ต้องระบุเหตุผลกำกับไว้ในประวัติ', v_bad;
    end if;
  end if;

  -- ---------- Status + เดือนแผน ----------
  if p_fields ? 'sub_status' or p_fields ? 'plan_month' then
    v_sub := coalesce(
      case when p_fields ? 'sub_status'
           then nullif(btrim(coalesce(p_fields->>'sub_status', '')), '') end,
      v_job.sub_status);
    v_month := case when p_fields ? 'plan_month'
                    then nullif(btrim(coalesce(p_fields->>'plan_month', '')), '')::date
                    else v_job.plan_month end;

    if v_sub is not null then
      select s.requires_plan_month into v_needs_mth
        from public.job_sub_statuses s
       where lower(btrim(s.name)) = lower(btrim(v_sub))
         and s.is_active;
      if v_needs_mth is null then
        raise exception 'สถานะ "%" ไม่มีในทะเบียน (กดปุ่มจัดการเพื่อเพิ่มก่อน)', v_sub;
      end if;
      if v_needs_mth then
        if v_month is null then
          raise exception 'สถานะ "%" ต้องระบุเดือนที่ลงแผนด้วย', v_sub;
        end if;
        v_month := date_trunc('month', v_month)::date;   -- normalize เป็นวันที่ 1 เสมอ
      else
        v_month := null;   -- เปลี่ยนไปสถานะที่ไม่ผูกเดือน → ห้ามให้เดือนเก่าค้าง
      end if;
    else
      v_month := null;
    end if;
  end if;

  -- ---------- validate ค่าที่มีกติกาใน DB อยู่แล้ว (ดักเองเพื่อให้ได้ข้อความไทย) ----------
  if p_fields ? 'quantity' then
    v_qty := nullif(btrim(coalesce(p_fields->>'quantity', '')), '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Batch Size ต้องมากกว่า 0';
    end if;
  end if;

  if p_fields ? 'planned_start' or p_fields ? 'planned_end' then
    v_start := case when p_fields ? 'planned_start'
                    then nullif(btrim(coalesce(p_fields->>'planned_start', '')), '')::date
                    else v_job.planned_start end;
    v_end   := case when p_fields ? 'planned_end'
                    then nullif(btrim(coalesce(p_fields->>'planned_end', '')), '')::date
                    else v_job.planned_end end;
    if v_start is not null and v_end is not null and v_end < v_start then
      raise exception 'วันเสร็จตามแผนต้องไม่ก่อนวันเริ่ม';
    end if;
  end if;

  if p_fields ? 'customer_id' then
    v_cust := nullif(btrim(coalesce(p_fields->>'customer_id', '')), '')::uuid;
    if v_cust is null then raise exception 'กรุณาเลือกลูกค้า'; end if;
    if not exists (select 1 from public.customers where id = v_cust) then
      raise exception 'ไม่พบลูกค้าที่เลือกในทะเบียน';
    end if;
  end if;

  -- ---------- เก็บชื่อช่องที่แก้ ไว้เขียนลง audit ----------
  select string_agg(r.label, ' · ' order by r.label) into v_labels
    from jsonb_object_keys(p_fields) k
    join public.job_field_rules() r on r.key = k;
  v_labels := coalesce(v_labels, '-');

  perform set_config('app.current_profile_id', v_profile::text, true);

  -- ---------- jobs ----------
  if p_fields ?| array['sub_status','plan_month','cpo_date','request_no','planned_start',
                       'planned_end','pack_type','pack_pattern_1','pack_pattern_2','pack_pattern_3',
                       'note'] then
    perform set_config('app.audit_reason',
      'แก้ข้อมูลงาน ' || v_job.job_no || ': ' || v_labels ||
      coalesce(' — เหตุผล: ' || v_reason, ''), true);

    update public.jobs
       set sub_status = case when p_fields ? 'sub_status' then v_sub else sub_status end,
           plan_month = case when p_fields ? 'sub_status' or p_fields ? 'plan_month'
                             then v_month else plan_month end,
           cpo_date   = case when p_fields ? 'cpo_date'
                             then nullif(btrim(coalesce(p_fields->>'cpo_date', '')), '')::date
                             else cpo_date end,
           request_no = case when p_fields ? 'request_no'
                             then nullif(btrim(coalesce(p_fields->>'request_no', '')), '')
                             else request_no end,
           planned_start = case when p_fields ? 'planned_start' then v_start else planned_start end,
           planned_end   = case when p_fields ? 'planned_end'   then v_end   else planned_end end,
           pack_type  = case when p_fields ? 'pack_type'
                             then nullif(btrim(coalesce(p_fields->>'pack_type', '')), '')
                             else pack_type end,
           pack_pattern_1 = case when p_fields ? 'pack_pattern_1'
                                 then nullif(btrim(coalesce(p_fields->>'pack_pattern_1', '')), '')
                                 else pack_pattern_1 end,
           pack_pattern_2 = case when p_fields ? 'pack_pattern_2'
                                 then nullif(btrim(coalesce(p_fields->>'pack_pattern_2', '')), '')
                                 else pack_pattern_2 end,
           pack_pattern_3 = case when p_fields ? 'pack_pattern_3'
                                 then nullif(btrim(coalesce(p_fields->>'pack_pattern_3', '')), '')
                                 else pack_pattern_3 end,
           -- หมายเหตุ (Part D · 0071) — ช่องอิสระของงาน · บริษัท POUND ใช้เป็นหลัก
           note       = case when p_fields ? 'note'
                             then nullif(btrim(coalesce(p_fields->>'note', '')), '')
                             else note end,
           updated_by = v_profile
     where id = p_job_id;

    v_updated := array_append(v_updated, 'jobs');
  end if;

  -- ---------- orders ----------
  if p_fields ?| array['quantity','due_date','customer_id'] then
    perform set_config('app.audit_reason',
      'แก้ข้อมูลงาน ' || v_job.job_no || ': ' || v_labels ||
      coalesce(' — เหตุผล: ' || v_reason, ''), true);

    update public.orders
       set quantity = case when p_fields ? 'quantity' then v_qty else quantity end,
           due_date = case when p_fields ? 'due_date'
                           then nullif(btrim(coalesce(p_fields->>'due_date', '')), '')::date
                           else due_date end,
           -- ลูกค้า: เขียน snapshot ชื่อคู่ FK เสมอ (หลัก ALCOA เดียวกับ 0047)
           customer_id = case when p_fields ? 'customer_id' then v_cust else customer_id end,
           customer    = case when p_fields ? 'customer_id'
                              then (select name from public.customers where id = v_cust)
                              else customer end,
           updated_by  = v_profile
     where id = v_job.order_id;

    v_updated := array_append(v_updated, 'orders');
  end if;

  -- ---------- batches (LOT No. / วันผลิต / วันหมดอายุ) ----------
  if p_fields ? 'lot_no' then
    -- มีเลขล็อตมาด้วย → ส่งต่อให้ set_job_lot ของเดิมทั้งชุด (ด่าน GMP 0049 ทำงานเต็ม)
    v_lot := nullif(btrim(coalesce(p_fields->>'lot_no', '')), '');
    v_mfg := case when p_fields ? 'mfg_date'
                  then nullif(btrim(coalesce(p_fields->>'mfg_date', '')), '')::date
                  else v_job.manufacture_date end;
    v_exp := case when p_fields ? 'exp_date'
                  then nullif(btrim(coalesce(p_fields->>'exp_date', '')), '')::date
                  else v_job.expiry_date end;
    perform public.set_job_lot(p_job_id, v_lot, v_mfg, v_exp);
    v_updated := array_append(v_updated, 'batches');

  elsif p_fields ?| array['mfg_date','exp_date'] then
    -- แก้เฉพาะวัน (ฝ่ายวางแผนทำได้) — ต้องมีล็อตอยู่ก่อน เพราะ batches.lot_no เป็น not null
    if v_job.batch_id is null then
      raise exception 'ยังไม่มีเลขล็อตของงานนี้ — รอฝ่ายผลิตกรอก LOT No. ก่อนถึงจะใส่วันผลิต/วันหมดอายุได้';
    end if;
    if v_idx > 2 then
      raise exception 'งาน % เริ่มผลิตแล้ว — วันผลิต/วันหมดอายุถูกล็อกตามหลัก GMP', v_job.job_no;
    end if;

    v_mfg := case when p_fields ? 'mfg_date'
                  then nullif(btrim(coalesce(p_fields->>'mfg_date', '')), '')::date
                  else v_job.manufacture_date end;
    v_exp := case when p_fields ? 'exp_date'
                  then nullif(btrim(coalesce(p_fields->>'exp_date', '')), '')::date
                  else v_job.expiry_date end;
    if v_mfg is not null and v_exp is not null and v_exp <= v_mfg then
      raise exception 'วันหมดอายุต้องหลังวันผลิต';
    end if;

    perform set_config('app.audit_reason',
      'แก้ข้อมูลงาน ' || v_job.job_no || ': ' || v_labels ||
      coalesce(' — เหตุผล: ' || v_reason, ''), true);

    update public.batches
       set manufacture_date = v_mfg,
           expiry_date      = v_exp,
           updated_by       = v_profile
     where id = v_job.batch_id;

    v_updated := array_append(v_updated, 'batches');
  end if;

  -- 0086: "เลื่อนแผน" — ฝ่ายวางแผนต้องรู้เมื่อวันแผนของงานขยับ
  --   เทียบค่าใหม่กับค่าเดิมใน v_job (อ่านไว้ตั้งแต่ต้นฟังก์ชัน) และเช็ก p_fields ? '...' ด้วย
  --   เพราะ v_month/v_start/v_end จะถูกคำนวณเฉพาะเมื่อฟิลด์นั้นถูกส่งมาจริง
  --   skip_creator = true → คนที่แก้เองไม่ต้องได้ใบแจ้งของตัวเอง
  if (p_fields ? 'plan_month'    and v_month is distinct from v_job.plan_month)
     or (p_fields ? 'planned_start' and v_start is distinct from v_job.planned_start)
     or (p_fields ? 'planned_end'   and v_end   is distinct from v_job.planned_end) then
    perform public.create_notification(
      'job_plan',
      'แผนของงาน ' || v_job.job_no || ' ถูกเลื่อน/แก้ไข',
      v_labels || coalesce(' — เหตุผล: ' || v_reason, ''),
      p_job_id, v_job.job_no, 'planner'::app_role, null::job_status, null::uuid, true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'tables', to_jsonb(v_updated),
    'fields', v_labels,
    'message', 'บันทึกแล้ว: ' || v_labels
  );
end;
$$;

revoke execute on function public.update_job_details(uuid, jsonb, text) from public;
grant  execute on function public.update_job_details(uuid, jsonb, text) to authenticated;

comment on function public.update_job_details(uuid, jsonb, text) is
  'แก้ข้อมูลงานตามสิทธิ์ + ด่านล็อกรายฟิลด์ — 0086 แจ้งฝ่ายวางแผนเมื่อเดือนแผน/แผนเริ่ม/แผนเสร็จเปลี่ยน';

-- ------------------------------------------------------------
-- (4) add_production_record — บอดี้ 0063:108-284 · เพิ่มแจ้งเตือน 4 แบบในที่เดียว
-- ------------------------------------------------------------
create or replace function public.add_production_record(
  p_job_id       uuid,
  p_job_route_id uuid,
  p_input        numeric,
  p_output       numeric,
  p_loss         numeric     default 0,
  p_minutes      numeric     default null,
  p_record_date  date        default current_date,
  p_note         text        default null,
  p_client_id    uuid        default null,
  p_machine_id   uuid        default null,
  p_headcount    integer     default null,
  p_shift        work_shift  default null,
  p_period       work_period default null,
  p_input_unit   text        default null,
  p_output_unit  text        default null,
  p_loss_unit    text        default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile    uuid;
  v_status     job_status;
  v_loss       numeric := coalesce(p_loss, 0);
  v_id         uuid;
  v_mc         record;
  v_station_id uuid;
  v_st_name    text;
  v_route_job  uuid;
  v_mc_count   int;
  -- 0086
  v_job_no     text;
  v_step       integer;
  v_is_pack    boolean;
  v_new        boolean;
  v_prev       int;
  v_pack_step  integer;
  v_missing    text[] := '{}';
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;

  if not (public.has_role('production')
          or public.has_role('production_lead')
          or public.has_role('manager')) then
    raise exception 'สิทธิ์ของคุณบันทึกผลผลิตไม่ได้ (เฉพาะฝ่ายผลิต/ผู้บริหาร)';
  end if;

  -- idempotency
  if p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  select status into v_status from public.jobs where id = p_job_id for update;
  if v_status is null then raise exception 'ไม่พบงานนี้'; end if;
  if v_status <> 'in_production' then
    raise exception 'บันทึกผลผลิตได้เฉพาะงานที่กำลังผลิตอยู่ (สถานะปัจจุบัน: %)', v_status;
  end if;

  -- ขั้นตอน → สถานี (station_id มาจาก route ไม่ให้ผู้ใช้เลือกเองแล้ว)
  if p_job_route_id is null then raise exception 'กรุณาเลือกขั้นตอนการผลิต'; end if;
  select jr.job_id, jr.station_id, s.name, jr.step_no, s.is_packing
    into v_route_job, v_station_id, v_st_name, v_step, v_is_pack
    from public.job_routes jr
    join public.stations s on s.id = jr.station_id
   where jr.id = p_job_route_id;
  if v_station_id is null then raise exception 'ไม่พบขั้นตอนการผลิตที่เลือก'; end if;
  if v_route_job <> p_job_id then
    raise exception 'ขั้นตอนการผลิตนี้ไม่ใช่ของงานที่เลือก';
  end if;

  -- เครื่องจักร (ถ้าระบุ)
  if p_machine_id is not null then
    select id, code, status, is_active into v_mc
      from public.machines where id = p_machine_id;
    if v_mc.id is null then raise exception 'ไม่พบเครื่องจักรที่เลือก'; end if;
    if not v_mc.is_active then raise exception 'เครื่อง % ถูกปิดใช้งานแล้ว เลือกไม่ได้', v_mc.code; end if;
    if v_mc.status in ('maintenance', 'calibration_due') then
      raise exception 'เครื่อง % อยู่สถานะซ่อม/ถึงกำหนดสอบเทียบ — เริ่มงานบนเครื่องนี้ไม่ได้', v_mc.code;
    end if;
    if not exists (
      select 1 from public.job_route_machines
       where job_route_id = p_job_route_id and machine_id = p_machine_id
    ) then
      raise exception 'เครื่อง % ไม่ได้ถูกเลือกไว้ในขั้นตอนนี้', v_mc.code;
    end if;
  end if;

  -- ---------- GATE Line Clearance (0062) — กั้นรายสถานี/เครื่อง ----------
  select count(*) into v_mc_count
    from public.job_route_machines where job_route_id = p_job_route_id;

  -- ไม่มีเครื่องผูกไว้เลย = ทำ LC ไม่ได้ → ไม่กั้น (กันล็อกตายจนบันทึกอะไรไม่ได้)
  if v_mc_count > 0 then
    if p_machine_id is not null then
      if not public.line_clearance_passed(p_job_route_id, p_machine_id) then
        raise exception
          'บันทึกผลผลิตไม่ได้ — เครื่อง % ที่สถานี "%" ยังไม่ผ่าน Line Clearance (ต้องมีหัวหน้าฝ่ายผลิตยืนยัน)',
          v_mc.code, v_st_name;
      end if;
    elsif not exists (
      select 1
        from public.job_route_machines jrm
       where jrm.job_route_id = p_job_route_id
         and public.line_clearance_passed(p_job_route_id, jrm.machine_id)
    ) then
      raise exception
        'บันทึกผลผลิตไม่ได้ — สถานี "%" ยังไม่มีเครื่องไหนผ่าน Line Clearance เลย', v_st_name;
    end if;
  end if;

  -- validation
  if p_input is null or p_input < 0 then
    raise exception 'ยอดที่ต้องการจำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if p_output is null or p_output < 0 then
    raise exception 'ยอดผลิตได้ (output) จำเป็นต้องกรอกและห้ามติดลบ';
  end if;
  if v_loss < 0 then raise exception 'ของเสีย (loss) ห้ามติดลบ'; end if;
  if p_minutes is not null and (p_minutes < 0 or p_minutes > 1440) then
    raise exception 'นาทีทำงานต้องอยู่ระหว่าง 0–1440 (24 ชั่วโมง)';
  end if;
  if p_headcount is not null and p_headcount < 1 then
    raise exception 'จำนวนคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
  end if;
  if p_output > p_input then
    raise exception 'ยอดผลิตได้ (%) มากกว่ายอดที่ต้องการ (%) ไม่ได้', p_output, p_input;
  end if;
  if (p_output + v_loss) > p_input then
    raise exception 'ผลิตได้ + ของเสีย (%) มากกว่ายอดที่ต้องการ (%) ไม่ได้', (p_output + v_loss), p_input;
  end if;
  if p_record_date > current_date then
    raise exception 'วันที่บันทึกเป็นวันในอนาคตไม่ได้';
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'บันทึกผลผลิต ' || v_st_name, true);

  insert into public.production_records
    (job_id, job_route_id, station_id, record_date,
     input_qty, output_qty, loss_qty, minutes,
     input_unit, output_unit, loss_unit, shift, work_period,
     operator_id, note, created_by, client_id, machine_id, headcount)
  values
    (p_job_id, p_job_route_id, v_station_id, p_record_date,
     p_input, p_output, v_loss, p_minutes,
     nullif(btrim(coalesce(p_input_unit, '')), ''),
     nullif(btrim(coalesce(p_output_unit, '')), ''),
     nullif(btrim(coalesce(p_loss_unit, '')), ''),
     p_shift, p_period,
     v_profile, nullif(btrim(coalesce(p_note, '')), ''), v_profile, p_client_id,
     p_machine_id, p_headcount)
  on conflict (client_id) do nothing
  returning id into v_id;

  -- v_id เป็น null = ชนกับ client_id เดิม (ยิงซ้ำจากหน้าจอ) ⇒ ไม่ใช่แถวใหม่ ห้ามแจ้งเตือนซ้ำ
  v_new := v_id is not null;
  if v_id is null and p_client_id is not null then
    select id into v_id from public.production_records where client_id = p_client_id;
  end if;

  if v_new then
    select job_no into v_job_no from public.jobs where id = p_job_id;

    -- ---------- (ก) ⏳ รอหัวหน้าฝ่ายผลิตอนุมัติ (0080 ตั้งให้เป็นผู้อนุมัติตัวจริง) ----------
    --   skip_creator = true — คนบันทึกอนุมัติของตัวเองไม่ได้อยู่แล้ว (0080:126-129)
    perform public.create_notification(
      'approval_request',
      'บันทึกผลผลิต ' || to_char(p_record_date, 'DD/MM/YYYY') || ' งาน '
        || coalesce(v_job_no, '') || ' รอหัวหน้าอนุมัติ',
      'สถานี ' || v_st_name || ' · ผลิตได้ ' || p_output
        || coalesce(' ' || nullif(btrim(coalesce(p_output_unit, '')), ''), ''),
      p_job_id, v_job_no, 'production_lead'::app_role, null::job_status, null::uuid, true);

    -- ---------- (ข) 🏭 งานเข้าสถานี ----------
    --   ระบบไม่มีคอลัมน์ "สถานีปัจจุบัน" และไม่มีสถานะ "แพ็ค" ใน job_status (เหตุผล 0081:14-18)
    --   ⇒ ใช้นิยามเดียวกับแดชบอร์ด: ดูจากบันทึกผลผลิตที่ไม่ถูกตีกลับ (0081:166-171)
    --   "เข้าสถานี" = บันทึกใบแรกของขั้นตอนนั้น (ก่อนหน้านี้ยังไม่มีใบไหนเลย)
    select count(*) into v_prev
      from public.production_records
     where job_route_id = p_job_route_id and status <> 'rejected' and id <> v_id;

    if v_prev = 0 then
      -- 🚨 สถานีบรรจุไม่ต้องแจ้ง — ทีมระบุชัดใน requirement ว่า "ไม่ต้องแจ้งเตือน: งานเข้าสถานีบรรจุ"
      --    (ของที่ต้องแจ้งของฝั่งบรรจุคือ "พร้อมเข้าสถานีแพ็ค" ในข้อ (ค) ซึ่งมาก่อนหน้า 1 ขั้น)
      if not coalesce(v_is_pack, false) then
        perform public.create_notification(
          'station',
          'งาน ' || coalesce(v_job_no, '') || ' เข้าสถานี ' || v_st_name || ' แล้ว',
          'ขั้นตอนที่ ' || v_step,
          p_job_id, v_job_no, 'production'::app_role, null::job_status, null::uuid, true);
      end if;

      -- ---------- (ค) 📦 พร้อมเข้าสถานีแพ็ค ----------
      --   ยิงเมื่อขั้นตอนที่เพิ่งเริ่มบันทึก คือขั้น "ก่อนหน้าสถานีแพ็คตัวแรก" ของ route งานนี้
      --   (อยู่ในบล็อก v_prev = 0 ⇒ ยิงครั้งเดียวตอนเข้าขั้นนั้น ไม่ยิงซ้ำทุกใบ)
      select min(jr.step_no) into v_pack_step
        from public.job_routes jr
        join public.stations s on s.id = jr.station_id
       where jr.job_id = p_job_id and s.is_packing;

      if v_pack_step is not null
         and v_step = (select max(jr2.step_no) from public.job_routes jr2
                        where jr2.job_id = p_job_id and jr2.step_no < v_pack_step) then
        perform public.create_notification(
          'station',
          'งาน ' || coalesce(v_job_no, '') || ' ใกล้พร้อมเข้าสถานีแพ็ค',
          'กำลังทำขั้นตอนสุดท้ายก่อนบรรจุ (' || v_st_name || ')',
          p_job_id, v_job_no, 'production'::app_role, null::job_status, null::uuid, true);
      end if;
    end if;

    -- ---------- (ง) 📋 ข้อมูลสำคัญหาย ----------
    --   ระบบไม่มีคอลัมน์ "เวลาเริ่ม/เวลาสิ้นสุด" — เก็บเป็น กะ + ช่วง + จำนวนนาที แทน
    --   และ "ผู้ปฏิบัติงาน" เก็บเป็นตัวเลข headcount (จำนวนคน) ไม่ใช่รายชื่อ
    --   ⇒ เช็กจากช่องที่มีอยู่จริงตามที่ตกลงกับผู้ใช้
    --   ยอดผลิตได้ (output) บังคับกรอกใน validation ด้านบนอยู่แล้ว จึงไม่มีทางหาย
    --   ⚠️ เช็กเครื่องจักรเฉพาะขั้นตอนที่ "มีเครื่องผูกไว้" (v_mc_count > 0)
    --      ไม่งั้นขั้นตอนที่ไม่ใช้เครื่องจะโดนเตือนทุกใบ
    --   skip_creator = false — คนกรอกคือคนที่ต้องกลับมาเติมให้ครบ
    if v_mc_count > 0 and p_machine_id is null then
      v_missing := array_append(v_missing, 'เครื่องจักร');
    end if;
    if p_headcount is null then v_missing := array_append(v_missing, 'จำนวนผู้ปฏิบัติงาน'); end if;
    if p_minutes   is null then v_missing := array_append(v_missing, 'เวลาที่ใช้ (นาที)');    end if;
    if p_shift     is null then v_missing := array_append(v_missing, 'กะ');                  end if;
    if p_period    is null then v_missing := array_append(v_missing, 'ช่วงเวลา (ปกติ/OT)');   end if;

    if array_length(v_missing, 1) > 0 then
      perform public.create_notification(
        'missing_data',
        'บันทึกผลผลิต ' || to_char(p_record_date, 'DD/MM/YYYY') || ' งาน '
          || coalesce(v_job_no, '') || ' กรอกไม่ครบ',
        'สถานี ' || v_st_name || ' · ยังไม่ได้ระบุ: ' || array_to_string(v_missing, ', '),
        p_job_id, v_job_no, 'production'::app_role, null::job_status, null::uuid, false);
    end if;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) from public;
revoke execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) from anon;
grant execute on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) to authenticated;

comment on function public.add_production_record(
  uuid, uuid, numeric, numeric, numeric, numeric, date, text, uuid, uuid, integer,
  work_shift, work_period, text, text, text
) is
  'บันทึกผลผลิตรายวัน (ฝ่ายผลิต) — รับขั้นตอน (job_route_id) · นาที · กะ/ช่วงเวลา/หน่วยรายช่อง · ด่าน Line Clearance + เครื่องจักร · 0086 แจ้ง ⏳ หัวหน้า + 🏭 เข้าสถานี + 📋 ข้อมูลไม่ครบ';

-- ============================================================
-- ✅ ตรวจหลัง paste (รันใน SQL Editor)
--   select proname, position('create_notification' in prosrc) > 0 as has_notify
--     from pg_proc
--    where proname in ('create_production_jobs','delete_job','update_job_details','add_production_record')
--    order by proname;                    -- ต้องได้ true ครบ 4 แถว
--
--   -- ใบ "งานถูกยกเลิก" ต้องไม่ผูก job_id ไม่งั้นถูก cascade ลบตามงาน
--   select position('null::uuid, v_job_no' in prosrc) > 0 as delete_job_uses_null_job_id
--     from pg_proc where proname = 'delete_job';    -- ต้องได้ true
-- ============================================================
