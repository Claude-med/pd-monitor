import type { NextConfig } from "next";

/**
 * Security headers ทุกหน้า (รีวิว 1 ต.ค. 69)
 *   · X-Frame-Options / frame-ancestors — ห้ามเว็บ "อื่น" เอาแอปไปฝังใน iframe (กันหลอกให้กดปุ่มลงนาม/ลบ)
 *     ใช้ SAMEORIGIN ไม่ใช่ DENY — การปริ้น (lib/print/sheets-to-pdf.ts) สั่งพิมพ์ผ่าน iframe ในหน้าเดียวกัน
 *   · X-Content-Type-Options — ห้ามเบราว์เซอร์เดาชนิดไฟล์เอง
 *   · Referrer-Policy — ไม่ส่ง URL เต็ม (มีเลขงาน) ไปเว็บภายนอก
 *   · Permissions-Policy — แอปไม่ใช้กล้อง/ไมค์/ตำแหน่ง ปิดไว้เลย
 * ⚠️ ยังไม่ใส่ CSP เต็มรูปแบบ — Next ใช้ inline script ต้องทำแบบ nonce ซึ่งกระทบหลายส่วน
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
