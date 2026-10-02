"use client";

import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { login, type LoginState } from "@/app/actions/auth";

// ล็อกปุ่มเข้าสู่ระบบฝั่งเบราว์เซอร์ เมื่อกรอกรหัสผิด 5 ครั้งภายใน 1 นาที → พัก 1 นาที แล้วรีเซ็ตตัวนับ
// ⚠️ เป็นแค่ด่าน UX (กันกดรัว) ไม่ใช่ด่านความปลอดภัย — ด่านจริงคือ rate limit ของ Supabase Auth
// เก็บใน localStorage → รีเฟรชหน้าแล้วยังล็อกอยู่ · นับต่อเบราว์เซอร์ (ไม่แยกอีเมล)
const FAIL_KEY = "pdm.loginFails";
const FAIL_EVENT = "pdm-login-fails";
const MAX_FAILS = 5;
const WINDOW_MS = 60_000;
const LOCK_MS = 60_000;
const LOCK_MESSAGE = "ใส่รหัสผิดบ่อยเกินไป โปรดรอ 1 นาทีแล้วลองใหม่";

type FailData = { fails: number[]; lockUntil: number };

function readFails(): FailData {
  try {
    const d = JSON.parse(localStorage.getItem(FAIL_KEY) ?? "null");
    if (d && Array.isArray(d.fails) && typeof d.lockUntil === "number") return d;
  } catch {}
  return { fails: [], lockUntil: 0 };
}

function writeFails(d: FailData | null) {
  try {
    if (d) localStorage.setItem(FAIL_KEY, JSON.stringify(d));
    else localStorage.removeItem(FAIL_KEY);
  } catch {}
  window.dispatchEvent(new Event(FAIL_EVENT));
}

// อ่านเวลาปลดล็อกจาก localStorage แบบ external store (server = 0 · แท็บอื่นเปลี่ยนก็อัปเดต)
function subscribeLock(cb: () => void) {
  window.addEventListener(FAIL_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(FAIL_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function LoginForm() {
  const [redirecting, setRedirecting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lockUntil = useSyncExternalStore(
    subscribeLock,
    () => readFails().lockUntil,
    () => 0,
  );

  // ครอบ server action: สำเร็จ = ล้างตัวนับแล้วเข้าระบบ · รหัสผิด = นับ 1 ครั้ง (ครบ 5 ใน 1 นาที = ล็อก)
  const [state, action, pending] = useActionState<LoginState, FormData>(
    async (prev, formData) => {
      const result = await login(prev, formData);
      const t = Date.now();
      if (result?.ok) {
        writeFails(null);
        setRedirecting(true);
        window.location.replace("/");
      } else if (result?.invalid) {
        const fails = [...readFails().fails.filter((f) => t - f < WINDOW_MS), t];
        writeFails(
          fails.length >= MAX_FAILS
            ? { fails: [], lockUntil: t + LOCK_MS }
            : { fails, lockUntil: 0 },
        );
        setNow(t);
      }
      return result;
    },
    undefined,
  );

  // นับถอยหลังทุกวินาที · ครบเวลา = ปลดล็อก + รีเซ็ตตัวนับ
  useEffect(() => {
    if (!lockUntil) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockUntil) writeFails(null);
    }, 1000);
    return () => clearInterval(id);
  }, [lockUntil]);

  const locked = lockUntil > now;
  const secondsLeft = Math.max(0, Math.ceil((lockUntil - now) / 1000));
  const error = locked ? LOCK_MESSAGE : state?.error;

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (locked) e.preventDefault();
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          อีเมล
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@pdmonitor.app"
          // คงค่าอีเมลไว้เมื่อ login ไม่สำเร็จ (React 19 reset ฟอร์มกลับไปที่ defaultValue นี้)
          defaultValue={state?.email ?? ""}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || redirecting || locked}
        className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending || redirecting
          ? "กำลังเข้าสู่ระบบ…"
          : locked
            ? `ลองใหม่ได้ใน ${secondsLeft} วินาที`
            : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
