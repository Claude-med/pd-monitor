"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * ฟังการเปลี่ยนแปลงของตารางที่ระบุผ่าน Supabase Realtime
 * เมื่อมีคนอื่นเพิ่ม/แก้/ลบข้อมูล → สั่ง router.refresh() ดึงข้อมูลใหม่จาก server
 * คงสถาปัตยกรรม server-first: client แค่สั่ง revalidate ไม่ได้ถือ state ข้อมูลเอง
 * RLS ยังบังคับ — ผู้ใช้รับเฉพาะ event ของแถวที่ตัวเองมีสิทธิ์อ่าน
 */
export function RealtimeRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  // join เป็น string เดียวเพื่อให้ effect deps คงที่ (กัน re-subscribe ทุก render)
  const key = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    const list = key.split(",");
    let timer: ReturnType<typeof setTimeout> | null = null;

    // debounce กัน event ยิงถี่ (เช่น insert หลายแถวรวดเดียว) ไม่ให้ refresh ซ้ำ
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };

    const channel = supabase.channel(`realtime:${key}`);
    for (const table of list) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh,
      );
    }
    channel.subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [router, key]);

  // ป้าย "อัปเดตสด" เล็กๆ มุมจอ — โผล่เฉพาะตอนเชื่อมต่อสำเร็จ
  if (!live) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-40 flex items-center gap-1.5 rounded-full border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      อัปเดตสด
    </div>
  );
}
