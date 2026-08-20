import { STATUS_INDEX } from "@/lib/data/job-constants";

/**
 * แถบเตือนเรื่องเลขล็อต (Part C)
 *
 * เดิมไฟล์นี้เป็นฟอร์มกรอกเลขล็อตแยกต่างหาก (0049) — Part C ย้ายช่องกรอกเข้าไปอยู่ใน
 * การ์ด "ข้อมูลงาน" ปุ่มเดียวแล้ว เหลือไว้แค่ "ป้ายเตือน" เพราะไม่มีเลขล็อต = กดเริ่มผลิตไม่ได้
 * (ด่านจริงอยู่ใน advance_job_status · 0049:209-211)
 *
 * ⚠️ ห้ามเอาฟอร์มกลับมาที่นี่ — 2 ที่เขียน batches.lot_no พร้อมกันจะทับกันเอง
 */
export function LotNotice({
  lotNo,
  status,
}: {
  lotNo: string | null;
  status: string;
}) {
  if (lotNo) return null; // มีเลขล็อตแล้ว — การ์ดข้อมูลงานแสดงให้อยู่แล้ว

  const started = (STATUS_INDEX[status] ?? 0) >= STATUS_INDEX.in_production;

  if (started) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50/60 p-4 dark:bg-red-950/20">
        <p className="text-sm font-medium">🔒 งานนี้เริ่มผลิตแล้วแต่ไม่มีเลขล็อต</p>
        <p className="mt-1 text-xs text-muted-foreground">
          ช่องเลขล็อตถูกล็อกตามหลัก GMP — ต้องให้ผู้บริหารแก้พร้อมระบุเหตุผล
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <p className="text-sm font-medium">⚠️ ยังไม่ได้กรอก LOT No. (Batch NO.)</p>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
        ฝ่ายผลิตต้องกรอกเลขล็อตก่อนกด &ldquo;เริ่มผลิต&rdquo; — กดปุ่ม
        &ldquo;✏️ แก้ไขข้อมูล&rdquo; บนการ์ดข้อมูลงานด้านบน · เริ่มผลิตแล้วช่องนี้จะล็อก
      </p>
    </div>
  );
}
