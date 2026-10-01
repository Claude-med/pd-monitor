-- ============================================================
-- PD Monitor — รีวิวก่อนทดสอบรอบ 2 (ก้อน 2) / 0106_fg_receive_qty_positive.sql
-- รับเข้าคลัง FG ต้องมีจำนวนมากกว่า 0
--   เดิม receive_fg เช็กแค่ "ห้ามติดลบ" ⇒ รับเข้า 0 ได้ → งานถูกนับว่าเข้าคลังแล้ว (fg_inventory มีแถว)
--   บอร์ดงานจึงซ่อนงานนั้นทิ้ง ทั้งที่ยังไม่มีของเข้าคลังจริง
-- ยกบอดี้ receive_fg จาก 0097 · เปลี่ยนเฉพาะบรรทัดตรวจจำนวน
-- รัน "หลัง" 0105 · รันซ้ำได้
-- ============================================================

create or replace function public.receive_fg(
  p_job_id   uuid,
  p_qty      numeric,
  p_unit     text default null,
  p_location text default null,
  p_lot_no   text default null,
  p_note     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_id      uuid;
  v_status  job_status;
  v_product uuid;
  v_lot     text;
  v_unit    text;
  v_old     public.fg_inventory%rowtype;   -- Part G (0097)
  v_used    numeric;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.can_manage_fg() then
    raise exception 'เฉพาะฝ่ายคลัง/ผู้บริหารรับเข้าคลัง FG ได้';
  end if;

  select j.status, o.product_id, b.lot_no, o.unit
    into v_status, v_product, v_lot, v_unit
  from public.jobs j
  join public.orders o on o.id = j.order_id
  left join public.batches b on b.id = j.batch_id
  where j.id = p_job_id;

  if v_status is null then raise exception 'ไม่พบงานที่เลือก'; end if;
  if v_status <> 'finished_goods' then
    raise exception 'รับเข้าคลังได้เฉพาะงานที่ถึงสถานะ FG แล้ว';
  end if;
  -- 0106 (รีวิว 1 ต.ค. 69): ห้ามรับเข้า 0 — เดิมเช็กแค่ < 0 ⇒ รับเข้า 0 ได้
  --   แล้วงานถูกนับว่า "เข้าคลังแล้ว" หายจากบอร์ดทั้งที่ยังไม่มีของเข้าคลังจริง
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนรับเข้าต้องมากกว่า 0'; end if;

  -- Part G (0097): มีใบจ่ายออกแล้ว → ยอดรับเข้าต้องไม่ต่ำกว่ายอดจ่าย และห้ามเปลี่ยนหน่วย
  select * into v_old from public.fg_inventory where job_id = p_job_id for update;
  if v_old.id is not null then
    v_used := public.fg_dispatched_qty(v_old.id);
    if v_used > 0 then
      if p_qty < v_used then
        raise exception 'ยอดรับเข้าต่ำกว่ายอดที่จ่ายออกไปแล้ว (% %)', v_used, v_old.unit;
      end if;
      if coalesce(nullif(btrim(coalesce(p_unit, '')), ''), v_old.unit) <> v_old.unit then
        raise exception 'เปลี่ยนหน่วยไม่ได้ — มีรายการจ่ายออกเป็นหน่วย "%" แล้ว', v_old.unit;
      end if;
    end if;
  end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'รับเข้าคลัง FG', true);

  insert into public.fg_inventory
    (job_id, product_id, lot_no, qty, unit, location, note, created_by)
  values
    (p_job_id, v_product,
     coalesce(nullif(btrim(coalesce(p_lot_no, '')), ''), v_lot),
     p_qty,
     coalesce(nullif(btrim(coalesce(p_unit, '')), ''), v_unit, 'เม็ด'),
     nullif(btrim(coalesce(p_location, '')), ''),
     nullif(btrim(coalesce(p_note, '')), ''),
     v_profile)
  on conflict (job_id) do update
    set qty = excluded.qty,
        unit = excluded.unit,
        lot_no = excluded.lot_no,
        location = excluded.location,
        note = excluded.note,
        updated_by = v_profile
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.receive_fg(uuid, numeric, text, text, text, text) to authenticated;


-- ============================================================
-- ✅ ตรวจหลัง paste (รันทีละข้อ)
--
-- ข้อ 1 · ด่านจำนวนใหม่อยู่ในฟังก์ชัน และด่านเดิมของ 0097 ยังอยู่
--   select prosrc like '%จำนวนรับเข้าต้องมากกว่า 0%'
--      and prosrc like '%fg_dispatched_qty%'
--     from pg_proc where proname = 'receive_fg';
--   ✅ true   ❌ false = ไฟล์นี้ยังไม่ได้รัน หรือด่านเดิมหาย → แจ้ง Claude
--
-- ข้อ 2 · ไม่มี overload ซ้อน
--   select count(*) from pg_proc where proname = 'receive_fg';
--   ✅ 1   ❌ 2 = มี signature เก่าค้าง → แจ้ง Claude
--
-- ข้อ 3 · (ข้อมูลเก่า) มีงานที่เคยรับเข้า 0 ค้างอยู่ไหม — ไม่ต้องแก้อะไร แค่ดู
--   select j.job_no, f.qty from public.fg_inventory f join public.jobs j on j.id = f.job_id where f.qty = 0;
--   ✅ 0 แถว = ไม่มีของค้าง
--   ℹ️ ถ้ามีแถว = ข้อมูลสมมติที่เคยรับเข้า 0 · ฝ่ายคลังเข้าไปแก้จำนวนให้ถูกในหน้า คลัง / FG ได้
-- ============================================================
