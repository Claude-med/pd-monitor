-- ============================================================
-- PD Monitor — Part C.1 / 0055_fix_job_details_pack_size.sql
--   (1) แก้บั๊ก `malformed array literal: "jobs"` — บันทึกข้อมูลงานไม่ได้เลยตั้งแต่ 0054
--   (2) เปลี่ยนชื่อช่อง "Packing Size" → "Pack Size" ให้ตรงกับที่ทีมเรียกจริง
--
-- 🐞 ต้นเหตุ (0054:308, 330, 344, 375)
--       v_updated := v_updated || 'jobs';
--    `v_updated` เป็น text[] ส่วน 'jobs' เป็น literal ชนิด unknown
--    → Postgres เดา unknown ให้เป็นชนิดเดียวกับฝั่งซ้าย (= text[]) จึงเลือก array_cat
--      แทน array_append → พยายาม parse 'jobs' เป็น array literal (ต้องหน้าตาแบบ '{jobs}')
--      → 22P02 malformed array literal
--    ผลคือ `update jobs` ที่เพิ่งสำเร็จโดน rollback ไปทั้ง transaction
--    = ผู้ใช้กดบันทึกแล้วข้อมูลไม่ลง และไม่เหลือร่องรอยใน audit ด้วย
--    แก้ด้วย array_append() ครบทั้ง 4 จุด (ชัดกว่าการเติม ::text และกันพลาดซ้ำในอนาคต)
--    ⚠️ ต้องแก้ครบทั้ง 4 — แก้แต่จุดแรกจะไปตายต่อที่ 'orders' / 'batches'
--
-- ⚠️ label ของ job_field_rules() ไม่ได้ใช้แค่โชว์บนจอ — ถูกประกอบเป็นข้อความ error
--    และ audit_log.reason ด้วย จึงต้องเปลี่ยนคู่กับ lib/data/job-field-rules.ts เสมอ
--
-- ℹ️ ทั้งไฟล์เป็น `create or replace` ด้วย signature เดิมทั้งคู่
--    → ไม่ต้อง drop · ไม่เกิด overload ซ้อน (PGRST203) · ACL เดิมติดมาด้วย
-- ℹ️ ไม่แตะ schema ตาราง · ไม่แตะ set_job_lot / ด่าน GMP · สิทธิ์รายช่องเท่าเดิมทุกประการ
-- ℹ️ บอดี้ทั้งสองฟังก์ชันคัดลอกจาก 0054 ทั้งก้อน แก้เฉพาะ 4+3 บรรทัดข้างต้น
-- รัน "หลัง" 0001–0054
-- ============================================================

-- ------------------------------------------------------------
-- (1) job_field_rules — เปลี่ยนแค่ label ของ pack_pattern_1..3
-- ------------------------------------------------------------

create or replace function public.job_field_rules()
returns table (key text, label text, perm text, lock_from integer)
language sql
immutable
as $$
  values
    ('sub_status',     'Status',            'both', null::integer),
    ('plan_month',     'เดือนแผน',            'both', null),
    ('due_date',       'กำหนดส่ง',            'plan', null),
    ('customer_id',    'ลูกค้า',              'plan', 6),
    ('cpo_date',       'C.P.O DATE',        'plan', 6),
    ('request_no',     'ใบคำขอ',             'both', 6),
    ('planned_start',  'แผนเริ่ม',            'prod', 6),
    ('planned_end',    'แผนเสร็จ',            'prod', 6),
    ('quantity',       'Batch Size',        'plan', 3),
    ('pack_type',      'รูปแบบบรรจุ',          'plan', 3),
    ('pack_pattern_1', 'Pack Size (1)',      'plan', 3),
    ('pack_pattern_2', 'Pack Size (2)',      'plan', 3),
    ('pack_pattern_3', 'Pack Size (3)',      'plan', 3),
    -- 3 ช่องล่างคุมด้วยด่านของ set_job_lot (0049) ต่างหาก
    -- lock_from = null ตรงนี้ ไม่ได้แปลว่าไม่มีด่าน
    ('lot_no',         'LOT No.',           'prod', null),
    ('mfg_date',       'วันผลิต',             'lot',  null),
    ('exp_date',       'วันหมดอายุ',           'lot',  null)
$$;

revoke execute on function public.job_field_rules() from public;
revoke execute on function public.job_field_rules() from anon;
revoke execute on function public.job_field_rules() from authenticated;

comment on function public.job_field_rules() is
  'ภายใน (revoke จาก public/anon/authenticated แล้ว) — กติกาสิทธิ์+ด่านล็อกรายช่องของ update_job_details (Part C) · ฝั่งแอปมีสำเนาที่ lib/data/job-field-rules.ts';
-- ------------------------------------------------------------
-- (2) update_job_details — แก้บั๊ก v_updated (4 จุด) นอกนั้นเหมือน 0054 เป๊ะ
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
                       'planned_end','pack_type','pack_pattern_1','pack_pattern_2','pack_pattern_3'] then
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

  return jsonb_build_object(
    'ok', true,
    'tables', to_jsonb(v_updated),
    'fields', v_labels,
    'message', 'บันทึกแล้ว: ' || v_labels
  );
end;
$$;

revoke execute on function public.update_job_details(uuid, jsonb, text) from public;
grant execute on function public.update_job_details(uuid, jsonb, text) to authenticated;

comment on function public.update_job_details(uuid, jsonb, text) is
  'แก้ข้อมูลงานจากหน้ารายละเอียด (Part C) — ส่งเฉพาะคีย์ที่แก้จริง · สิทธิ์รายช่องตามฝ่าย + ด่านล็อกตามสถานะ · ผู้บริหารข้ามด่านได้เมื่อระบุเหตุผล · LOT No./วันผลิต/วันหมดอายุ ยังใช้ด่านของ set_job_lot (0049)';

-- ------------------------------------------------------------
-- ตรวจหลังรัน
-- ------------------------------------------------------------
-- (ก) label เปลี่ยนจริง — ต้องได้ 3 แถว "Pack Size (1)(2)(3)"
--     select * from public.job_field_rules() where key like 'pack_pattern%';
--
-- (ข) ไม่มี overload ซ้อน — ต้องได้อย่างละ 1 แถว
--     select oid::regprocedure from pg_proc where proname in ('update_job_details','job_field_rules');
--
-- (ค) บั๊กหายจริง — แก้ Status ของงานที่มีอยู่จริง (ใส่ค่าที่มีในทะเบียน job_sub_statuses)
--     ต้องได้ jsonb ที่มี "ok": true และ "tables": ["jobs"] ไม่ใช่ 22P02
--
-- (ง) ประตูยังปิด — REST ในนาม anon/authenticated เรียก job_field_rules ต้องได้ 42501
