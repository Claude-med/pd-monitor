-- ============================================================
-- PD Monitor — D11 / 0021_packaging.sql  (A4 ก้อน 2: รูปแบบบรรจุ)
-- เพิ่มข้อมูลการบรรจุที่ตาราง products:
--   pack_type    = รูปแบบบรรจุ (Blister/Strip/ซอง/ขวด/กระปุก/อื่นๆ)
--   pack_pattern = รายละเอียดแผง/บรรจุ เช่น "แผง 50×10's" (50 แผง × 10 เม็ด)
-- เขียนผ่าน RPC security definer (manager/admin) ตามแพตเทิร์น create_product (0011)
-- รัน "หลัง" 0001–0020
-- ============================================================

alter table public.products add column if not exists pack_type    text;
alter table public.products add column if not exists pack_pattern text;

-- products มี trigger set_row_meta + log_audit อยู่แล้ว (0001/0002) → ไม่ต้องเพิ่ม

-- ------------------------------------------------------------
-- update_product_packaging — แก้ข้อมูลรูปแบบบรรจุของยา
-- ------------------------------------------------------------
create or replace function public.update_product_packaging(
  p_product_id  uuid,
  p_pack_type   text default null,
  p_pack_pattern text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_id      uuid;
  v_code    text;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then raise exception 'ยังไม่ได้เข้าสู่ระบบ'; end if;
  if not public.has_role('manager') then
    raise exception 'เฉพาะผู้บริหารแก้ข้อมูลบรรจุได้';
  end if;

  select code into v_code from public.products where id = p_product_id;
  if v_code is null then raise exception 'ไม่พบยา/ผลิตภัณฑ์ที่เลือก'; end if;

  perform set_config('app.current_profile_id', v_profile::text, true);
  perform set_config('app.audit_reason', 'แก้รูปแบบบรรจุ ' || v_code, true);

  update public.products
     set pack_type    = nullif(btrim(coalesce(p_pack_type, '')), ''),
         pack_pattern = nullif(btrim(coalesce(p_pack_pattern, '')), ''),
         updated_by   = v_profile
   where id = p_product_id
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.update_product_packaging(uuid, text, text)
  to authenticated;
