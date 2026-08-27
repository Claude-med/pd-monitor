import Link from "next/link";
import {
  QC_STATUS_META,
  type RecordQcStatus,
} from "@/lib/data/production-constants";

/**
 * คอลัมน์สถานะ QC ของแถวบันทึกผลผลิต (Part C.3 ก้อน 5)
 *
 * ไม่เก็บเป็นคอลัมน์ใน DB โดยตั้งใจ — คำนวณจาก inprocess_checks ที่ผูกกับแถวนั้น
 * (production_record_id) ถ้าเก็บซ้ำจะมี 2 แหล่งความจริงที่ต้องคอย sync แล้วตกยุคเงียบ ๆ
 *
 * ปุ่ม "QC" โผล่เฉพาะตอนยังรอตรวจ — ลิงก์พา QC ไปที่ฟอร์มตรวจระหว่างผลิต
 * พร้อมล็อกไว้แล้วว่าจะตรวจแถวไหน (`?qc=<recordId>`)
 */
export function RecordQcCell({
  status,
  jobNo,
  stepId,
  recordId,
  canCheck,
}: {
  status: RecordQcStatus;
  jobNo: string;
  stepId: string | null;
  recordId: string;
  canCheck: boolean;
}) {
  const meta = QC_STATUS_META[status];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        className="whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium text-white"
        style={{ backgroundColor: meta.color }}
      >
        {meta.label}
      </span>
      {status === "waiting" && canCheck && stepId && (
        <Link
          href={`/board/${encodeURIComponent(jobNo)}?step=${stepId}&qc=${recordId}#inprocess`}
          className="whitespace-nowrap rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
        >
          🔬 QC
        </Link>
      )}
    </span>
  );
}
