"use client";

export function PrintButton() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/* Chrome/Edge ซ่อนหัว/ท้ายของเบราว์เซอร์ให้เองแล้ว (@page margin: 0) — ข้อความนี้เผื่อ Firefox */}
      <span className="text-xs text-muted-foreground">
        ถ้ายังเห็นวันที่/ลิงก์ติดมา ให้ปิด “หัวกระดาษและท้ายกระดาษ” ในหน้าต่างพิมพ์
      </span>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        🖨️ พิมพ์ / บันทึก PDF
      </button>
    </div>
  );
}
