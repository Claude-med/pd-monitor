import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">PD Monitor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ระบบติดตามการผลิตยา — เข้าสู่ระบบเพื่อใช้งาน
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          หากเข้าระบบไม่ได้ ติดต่อผู้ดูแลระบบเพื่อขอบัญชีผู้ใช้
        </p>
      </div>
    </main>
  );
}
