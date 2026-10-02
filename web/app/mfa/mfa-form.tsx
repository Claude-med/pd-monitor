"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MFA_ISSUER } from "@/lib/auth/mfa";

type Enrolled = { factorId: string; qr: string; secret: string };

/**
 * ฟอร์ม MFA — เรียก Supabase Auth จากเบราว์เซอร์ตรง (session อยู่ใน cookie · browser client อัปเดต cookie ให้เอง)
 * ยืนยันสำเร็จ = session ขึ้นเป็น aal2 → โหลดหน้าใหม่ทั้งหน้า ให้ server อ่าน cookie ใหม่
 */
export function MfaForm({
  mode,
  accountLabel,
}: {
  mode: "setup" | "verify";
  accountLabel: string;
}) {
  const [enrolled, setEnrolled] = useState<Enrolled | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // setup ขั้น 1: สร้างรหัสลับใหม่ + QR (กดปุ่มเอง ไม่ทำใน effect — กันสร้างซ้ำตอนรีเฟรช/StrictMode)
  async function startSetup() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // เคยกดเริ่มแล้วไม่ได้ยืนยัน → มีรหัสลับค้าง (unverified) ลบทิ้งก่อน ไม่งั้นสร้างใหม่ไม่ได้
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.factor_type === "totp" && f.status !== "verified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error: err } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      issuer: MFA_ISSUER,
      friendlyName: `${MFA_ISSUER} ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (err || !data) {
      setError(`สร้างรหัสไม่สำเร็จ: ${err?.message ?? "ไม่ทราบสาเหตุ"} — ลองใหม่ หรือแจ้งผู้ดูแลระบบ`);
      return;
    }
    setEnrolled({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("กรอกรหัสตัวเลข 6 หลักจากแอป");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    let factorId = enrolled?.factorId;
    if (!factorId) {
      const { data: list } = await supabase.auth.mfa.listFactors();
      factorId = list?.totp[0]?.id;
    }
    if (!factorId) {
      setBusy(false);
      setError("ไม่พบการตั้งค่า MFA ของบัญชีนี้ — รีเฟรชหน้าแล้วลองใหม่");
      return;
    }
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (err) {
      setBusy(false);
      setCode("");
      setError(
        err.status === 429
          ? "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่"
          : "รหัสไม่ถูกต้องหรือหมดเวลา — รหัสในแอปเปลี่ยนทุก 30 วินาที ใช้รหัสล่าสุด",
      );
      return;
    }
    setDone(true);
    window.location.replace("/");
  }

  const codeForm = (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="mfa-code" className="text-sm font-medium">
        รหัส 6 หลักจากแอป
      </label>
      <input
        id="mfa-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        placeholder="000000"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-ring"
      />
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      <button
        type="submit"
        disabled={busy || done}
        className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {done ? "กำลังเข้าสู่ระบบ…" : busy ? "กำลังตรวจรหัส…" : "ยืนยัน"}
      </button>
    </form>
  );

  if (mode === "verify") return codeForm;

  if (!enrolled) {
    return (
      <div className="space-y-4 text-sm">
        <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>
            ติดตั้งแอป <b className="text-foreground">Google Authenticator</b> หรือ{" "}
            <b className="text-foreground">Microsoft Authenticator</b> ในมือถือ (ฟรี)
          </li>
          <li>กดปุ่มด้านล่าง ระบบจะแสดง QR code</li>
          <li>เปิดแอป → กด + → สแกน QR → กรอกรหัส 6 หลักที่แอปแสดง</li>
        </ol>
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{error}</p>
        )}
        <button
          type="button"
          onClick={startSetup}
          disabled={busy}
          className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "กำลังสร้าง QR…" : "เริ่มตั้งค่า"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        {/* QR เป็น SVG data URI จาก Supabase — next/image ไม่จำเป็น */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={enrolled.qr}
          alt="QR code สำหรับแอป Authenticator"
          width={200}
          height={200}
          className="rounded-md border bg-white p-2"
        />
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">สแกนไม่ได้? พิมพ์รหัสลับในแอปแทน</summary>
        <p className="mt-2">
          บัญชี: <b className="text-foreground">{accountLabel}</b>
        </p>
        <p className="mt-1 break-all font-mono text-foreground">{enrolled.secret}</p>
      </details>
      {codeForm}
    </div>
  );
}
