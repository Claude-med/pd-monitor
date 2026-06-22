import type { MetadataRoute } from "next";

/** PWA manifest — ทำให้ติดตั้งลงหน้าจอมือถือ/แท็บเล็ตได้ (recommendations C1) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PD Monitor — ระบบติดตามการผลิตยา",
    short_name: "PD Monitor",
    description:
      "ระบบติดตาม Pending Order และการผลิตของโรงงานยา — ให้ทุกฝ่ายเห็นสถานะตรงกัน",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    lang: "th",
    dir: "ltr",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
