/**
 * ดึง "ทุกแถว" จาก Supabase โดยเลี่ยงเพดาน max-rows ของ PostgREST (ค่าเริ่มต้น 1,000 แถว/ครั้ง)
 *
 * 🚨 ทำไมต้องมี (รีวิว 1 ต.ค. 69):
 *    query ที่ไม่ใส่ range จะได้แถวกลับมาไม่เกิน 1,000 แถว "แบบเงียบ ๆ ไม่มี error"
 *    พองานเกิน 1,000 ใบ บอร์ดงาน (เรียงจากเก่า) จะทำงานใหม่ล่าสุดหาย · หน้าคลัง FG ขาด ฯลฯ
 *
 * วิธีใช้ — ส่งฟังก์ชันที่สร้าง query ตามช่วงแถว (ต้องมี .order() ที่ "ไม่ซ้ำกัน" เสมอ
 * ไม่งั้นแถวอาจซ้ำ/หล่นระหว่างหน้า):
 *
 *   const rows = await fetchAll((from, to) =>
 *     supabase.from("jobs").select("id, job_no").order("job_no").range(from, to),
 *   );
 *
 * error ระหว่างทาง → คืนเท่าที่ได้ + log (แพทเทิร์นเดียวกับ query เดิมที่ใช้ `data ?? []`)
 */

/** ต้อง "ไม่เกิน" max-rows ของ Supabase project (ค่าเริ่มต้น 1,000) */
const PAGE_SIZE = 1000;
/** กันวนไม่รู้จบ (100 หน้า = 100,000 แถว — เกินนี้ควรย้ายไปนับ/กรองใน DB แทน) */
const MAX_PAGES = 100;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

export async function fetchAll<T>(
  page: (from: number, to: number) => PageResult<T>,
  label = "fetchAll",
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`[${label}]`, error.message);
      break;
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
  if (out.length >= PAGE_SIZE * MAX_PAGES)
    console.error(`[${label}] ถึงเพดาน ${MAX_PAGES} หน้าแล้ว — ข้อมูลอาจไม่ครบ`);
  return out;
}
