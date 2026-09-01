import Link from "next/link";
import { getJobs } from "@/lib/data/jobs";
import { listCompanies } from "@/lib/data/companies";
import { listJobSubStatuses } from "@/lib/data/job-sub-statuses";
import { PrintTableView } from "./print-table-view";

export const metadata = { title: "ปริ้นตารางบอร์ดงาน — PD Monitor" };

/**
 * ปริ้นตารางบอร์ดงาน F.PLN.10 (Part D4)
 *
 * เข้าจากปุ่มบนบอร์ดงานเท่านั้น — ไม่ใส่ NAV_ITEMS ตามแพทเทิร์นเดิมของ /board/new และ /board/print-notice
 * ⚠️ ต่างจาก /board/print-notice ตรงที่ **ไม่มีด่าน role** — ตารางบอร์ดงานคือข้อมูลที่ทุกฝ่าย
 *    เห็นบนบอร์ดอยู่แล้ว (ผลิต/QC/QA/คลัง) แค่พิมพ์ลงกระดาษ ไม่ใช่เอกสารสั่งการของฝ่ายวางแผน
 *
 * getJobs() ดึงช่องที่ตารางต้องใช้ครบอยู่แล้ว (lot_no · cpo_date · product_code · dosage_form ·
 * pack_pattern 1-3 · request_no · due_date · sub_status · plan_month) → กรอง/เลือกทำฝั่ง client ทั้งหมด
 *
 * 🚨 ไม่กรอง fg_received ออกเหมือนบอร์ด — งานที่เข้าคลังแล้วยังต้องอยู่ในตารางย้อนหลัง
 */
export default async function PrintTablePage() {
  const [jobs, companies, subStatuses] = await Promise.all([
    getJobs(),
    listCompanies(),
    listJobSubStatuses(),
  ]);

  return (
    <div className="pt-page space-y-5">
      <div className="no-print">
        <Link
          href="/board"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับบอร์ดงาน
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          ปริ้นตารางบอร์ดงาน
        </h1>
        <p className="text-sm text-muted-foreground">
          F.PLN.10 — เลือกรูปแบบตาราง กรองงาน แล้วติ๊กใบที่จะพิมพ์ · ออกได้ทั้งกระดาษ / PDF / Excel
        </p>
      </div>

      <PrintTableView
        jobs={jobs}
        companies={companies}
        subStatuses={subStatuses}
      />
    </div>
  );
}
