"use client";

import { useActionState } from "react";
import {
  changePassword,
  type ChangePasswordState,
} from "@/app/change-password/actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<
    ChangePasswordState,
    FormData
  >(changePassword, undefined);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          รหัสผ่านใหม่
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="อย่างน้อย 8 ตัวอักษร"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm" className="text-sm font-medium">
          ยืนยันรหัสผ่านใหม่
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="พิมพ์ซ้ำอีกครั้ง"
          className={inputClass}
        />
      </div>

      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "กำลังบันทึก…" : "ตั้งรหัสผ่านใหม่"}
      </button>
    </form>
  );
}
