export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl text-center">
        <span className="inline-block rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground">
          เฟส 1 — โครงแอปพร้อมแล้ว
        </span>

        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
          PD Monitor
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          ระบบติดตาม Pending Order และการผลิตของโรงงานยา
        </p>

        <p className="mx-auto mt-6 max-w-md text-sm text-muted-foreground">
          แอปจริง (Next.js + Supabase) ตั้งต้นเรียบร้อย — ขั้นถัดไปจะเพิ่มฐานข้อมูล
          ระบบล็อกอิน และหน้าจอใช้งานจริง ตาม roadmap ทีละเฟส
        </p>

        <p className="mt-10 text-xs text-muted-foreground">
          Next.js · Tailwind · shadcn/ui · Supabase
        </p>
      </div>
    </main>
  );
}
