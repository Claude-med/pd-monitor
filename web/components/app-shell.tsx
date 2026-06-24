"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { ROLE_LABELS, visibleNav } from "@/lib/nav";
import type { Profile } from "@/lib/auth/dal";

export function AppShell({
  profile,
  children,
  unreadCount = 0,
}: {
  profile: Profile;
  children: React.ReactNode;
  unreadCount?: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const nav = visibleNav(profile.roles);

  // requirement ข้อ 10: เลือกเมนูแล้วปิดเมนูมือถืออัตโนมัติ
  const closeMenu = () => setMenuOpen(false);

  const navLinks = (
    <nav className="space-y-1">
      {nav.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.ready ? item.href : "#"}
            aria-disabled={!item.ready}
            onClick={(e) => {
              if (!item.ready) e.preventDefault();
              closeMenu();
            }}
            className={[
              "flex items-center justify-between rounded-md px-3 py-2.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
              item.ready ? "" : "cursor-default opacity-60",
            ].join(" ")}
          >
            <span>{item.label}</span>
            {item.href === "/inbox" && unreadCount > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
            {!item.ready && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                เร็วๆ นี้
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarInner = (
    <div className="flex h-full flex-col">
      <div className="px-3 py-4">
        <p className="text-lg font-bold tracking-tight">PD Monitor</p>
        <p className="text-xs text-muted-foreground">ระบบติดตามการผลิตยา</p>
      </div>

      <div className="flex-1 overflow-y-auto px-3">{navLinks}</div>

      <div className="border-t px-3 py-3">
        <p className="truncate text-sm font-medium">{profile.full_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {profile.department ?? "—"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {profile.roles.length === 0 ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              ยังไม่กำหนดสิทธิ์
            </span>
          ) : (
            profile.roles.map((r) => (
              <span
                key={r}
                className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
              >
                {ROLE_LABELS[r]}
              </span>
            ))
          )}
        </div>
        <form action={logout} className="mt-3">
          <button
            type="submit"
            className="w-full rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            ออกจากระบบ
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full">
      {/* Sidebar — desktop */}
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:block">
        {sidebarInner}
      </aside>

      {/* เนื้อหา */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar — mobile */}
        <header className="flex items-center gap-3 border-b bg-background px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="เปิดเมนู"
            className="rounded-md border p-2"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="font-semibold">PD Monitor</span>
        </header>

        {/* Drawer — mobile */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={closeMenu}
              aria-hidden
            />
            <div className="absolute left-0 top-0 h-full w-72 max-w-[80%] border-r bg-sidebar shadow-xl">
              <div className="flex justify-end p-2">
                <button
                  type="button"
                  onClick={closeMenu}
                  aria-label="ปิดเมนู"
                  className="rounded-md border p-2"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              {sidebarInner}
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
