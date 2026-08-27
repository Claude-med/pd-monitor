"use client";

/**
 * Error boundary ชั้นนอกสุด — จับเฉพาะกรณีที่ root layout เองพัง (Part C.4 ก้อน 1)
 * ไฟล์นี้แทนที่ root layout ตอนทำงาน จึงต้องมี <html>/<body> ของตัวเอง
 * และ export metadata ไม่ได้ (เป็น Client Component) → ใช้ <title> ของ React แทน
 *
 * เคสทั่วไปจะถูกจับโดย app/(app)/error.tsx ก่อน ตัวนี้เป็นตาข่ายสุดท้าย
 * จึงไม่พึ่ง globals.css/ตัวแปรธีม — เขียน style ตรงๆ กันกรณีที่ CSS โหลดไม่ขึ้นด้วย
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
        }}
      >
        <title>เกิดข้อผิดพลาด — PD Monitor</title>
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <div style={{ fontSize: "2.25rem" }}>⚠️</div>
          <h1 style={{ fontSize: "1.25rem", margin: "0.75rem 0" }}>
            ระบบขัดข้อง
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#64748b", lineHeight: 1.6 }}>
            เปิดแอปไม่สำเร็จ ลองโหลดใหม่อีกครั้ง
            ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิง
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#64748b",
                fontFamily: "monospace",
              }}
            >
              รหัสอ้างอิง: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              borderRadius: "0.375rem",
              border: "1px solid #cbd5e1",
              background: "#0f172a",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            ลองใหม่
          </button>
        </div>
      </body>
    </html>
  );
}
