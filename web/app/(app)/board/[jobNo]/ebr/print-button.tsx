"use client";

import { useState } from "react";
import { printPdfBlob, sheetsToPdf } from "@/lib/print/sheets-to-pdf";
import { paginateEbr } from "./paginate";

/**
 * ปุ่มหลัก = จัดหน้าเป็นแผ่น A4 (paginate.ts) → สร้าง PDF → สั่งพิมพ์ไฟล์ PDF
 * เหตุผล: สั่งเครื่องพิมพ์จริงตรงจากหน้าเว็บ Chrome บังคับขอบตามเครื่องพิมพ์ แล้วพิมพ์วันที่/ชื่อแท็บ/URL ติดมา
 *         (@page margin: 0 ได้ผลแค่ตอน "บันทึกเป็น PDF") · พิมพ์จากไฟล์ PDF ไม่มีปัญหานี้ทุกเครื่อง
 */
export function PrintButton({ fileName }: { fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function printPdf() {
    setBusy(true);
    setError(null);
    let cleanup: (() => void) | undefined;
    try {
      await document.fonts?.ready;
      const paged = paginateEbr();
      cleanup = paged.cleanup;
      const blob = await sheetsToPdf(paged.sheets, "portrait", { embedFonts: true });
      printPdfBlob(blob, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้าง PDF ไม่สำเร็จ");
    } finally {
      cleanup?.();
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <span className="text-sm text-destructive">⚠️ {error}</span>}
      {/* กระดาษ Letter (ค่าเริ่มต้นของเครื่องพิมพ์หลายรุ่น) แคบกว่า A4 → ขอบขวาถูกตัด (เจอจริง 1 ต.ค. 69) */}
      <span className="text-xs text-muted-foreground">
        ในหน้าต่างพิมพ์ ตั้ง “ขนาดกระดาษ / Paper size” เป็น A4
      </span>
      <button
        type="button"
        onClick={printPdf}
        disabled={busy}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "กำลังสร้าง PDF…" : "🖨️ พิมพ์ / บันทึก PDF"}
      </button>
    </div>
  );
}
