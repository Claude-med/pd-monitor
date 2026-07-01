"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KIND_META, type InboxItem } from "@/lib/data/notification-constants";
import { fmtDateTime } from "@/lib/format";
import { markRead, markAllRead } from "./actions";

export function InboxView({
  items,
  hasUnread,
}: {
  items: InboxItem[];
  hasUnread: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function allRead() {
    start(async () => {
      await markAllRead();
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        ไม่มีการแจ้งเตือน
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {hasUnread && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={allRead}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            ทำเครื่องหมายอ่านทั้งหมด
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {items.map((it) => (
          <InboxRow key={it.id} item={it} />
        ))}
      </ul>
    </div>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const meta = KIND_META[item.kind];
  const unread = item.source === "stored" && !item.read;

  function read() {
    start(async () => {
      await markRead(item.id);
      router.refresh();
    });
  }

  return (
    <li
      className={`rounded-lg border border-l-4 p-3 text-sm ${
        unread ? "bg-accent/40" : "bg-card"
      }`}
      style={{ borderLeftColor: meta?.color ?? "#64748b" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span>{meta?.icon}</span>
        <span className="font-medium">{item.title}</span>
        {unread && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
            ใหม่
          </span>
        )}
        {item.source === "derived" && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            อัตโนมัติ
          </span>
        )}
      </div>
      {item.body && <p className="mt-1 text-muted-foreground">{item.body}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {item.created_at && (
          <span>{fmtDateTime(item.created_at)}</span>
        )}
        {item.job_no && (
          <Link
            href={`/board/${encodeURIComponent(item.job_no)}`}
            className="text-primary hover:underline"
          >
            ไปที่งาน {item.job_no} →
          </Link>
        )}
        {unread && (
          <button
            type="button"
            disabled={pending}
            onClick={read}
            className="ml-auto rounded border px-2 py-0.5 hover:bg-accent disabled:opacity-50"
          >
            อ่านแล้ว
          </button>
        )}
      </div>
    </li>
  );
}
