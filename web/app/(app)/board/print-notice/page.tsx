import Link from "next/link";
import { getProfile } from "@/lib/auth/dal";
import { canPlanJobs } from "@/lib/data/role-access";
import { getJobs } from "@/lib/data/jobs";
import { listCompanies } from "@/lib/data/companies";
import { PrintNoticeView } from "./print-notice-view";

export const metadata = { title: "ปริ้นใบแจ้งผลิต — PD Monitor" };

/**
 * ปริ้นใบแจ้งผลิต F.PLN.01 (Part D)
 *
 * เข้าจากปุ่มบนบอร์ดงานเท่านั้น — ไม่ใส่ NAV_ITEMS ตามแพทเทิร์นเดิมของ /board/new และ /board/[jobNo]/ebr
 * สิทธิ์ = ฝ่ายวางแผน/ผู้บริหาร (canPlanJobs) เท่ากับปุ่ม "สร้างงานใหม่" — ใบนี้เป็นเอกสารของฝ่ายวางแผน
 *
 * getJobs() ดึงช่องที่ใบต้องใช้ครบอยู่แล้ว (reg_no · appearance · pack_pattern 1-3 · request_no · note)
 * → กรอง/เลือกทำฝั่ง client ทั้งหมด แบบเดียวกับบอร์ดงาน
 */
export default async function PrintNoticePage() {
  const profile = await getProfile();
  const canPrint = canPlanJobs(profile?.roles ?? []);
  const [jobs, companies] = canPrint
    ? await Promise.all([getJobs(), listCompanies()])
    : [[], []];

  return (
    <div className="pn-page space-y-5">
      <div className="no-print">
        <Link
          href="/board"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับบอร์ดงาน
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">ปริ้นใบแจ้งผลิต</h1>
        <p className="text-sm text-muted-foreground">
          F.PLN.01 — เลือกบริษัท แล้วติ๊กงานที่จะพิมพ์ · กระดาษ A4 ใบละ 2 Job ฉีกครึ่งได้
        </p>
      </div>

      {canPrint ? (
        <PrintNoticeView jobs={jobs} companies={companies} />
      ) : (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          เฉพาะฝ่ายวางแผน/ผู้บริหารปริ้นใบแจ้งผลิตได้ — บัญชีของคุณไม่มีสิทธิ์นี้
        </p>
      )}
    </div>
  );
}
