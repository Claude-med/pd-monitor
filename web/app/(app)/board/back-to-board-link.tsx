"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

// เก็บลิงก์บอร์ดล่าสุด (พร้อมตัวกรอง) ใน sessionStorage = อยู่เฉพาะแท็บนี้ ปิดแท็บแล้วหาย
const KEY = "pdm.boardUrl";

/** board-view เรียกทุกครั้งที่ตัวกรองเปลี่ยน */
export function saveBoardUrl(url: string) {
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    // โหมดส่วนตัว/บล็อก storage → ปุ่มกลับไป /board เฉย ๆ
  }
}

function readBoardUrl() {
  try {
    const saved = sessionStorage.getItem(KEY);
    // รับเฉพาะลิงก์ของบอร์ดเท่านั้น กันค่าแปลก ๆ ใน storage
    if (saved && /^\/board(\?|$)/.test(saved)) return saved;
  } catch {}
  return "/board";
}

/** ปุ่ม "← กลับบอร์ดงาน" — พากลับไปบอร์ดพร้อมตัวกรองชุดที่เลือกไว้ล่าสุด */
export function BackToBoardLink({ className }: { className?: string }) {
  // sessionStorage ไม่เปลี่ยนระหว่างอยู่หน้างาน → subscribe เปล่า · server = "/board"
  const href = useSyncExternalStore(
    () => () => {},
    readBoardUrl,
    () => "/board",
  );
  return (
    <Link href={href} className={className}>
      ← กลับบอร์ดงาน
    </Link>
  );
}
