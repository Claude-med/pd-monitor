"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  KIND_META,
  KIND_FILTER_ORDER,
  type InboxItem,
  type InboxKind,
} from "@/lib/data/notification-constants";
import { fmtDateTime, displayJobNo } from "@/lib/format";
import { markRead, markAllRead } from "./actions";

/** ตัวกรองบนสุด: ทั้งหมด / ยังไม่อ่าน / รายชนิด */
type Filter = "all" | "unread" | InboxKind;

export function InboxView({
  items,
  hasUnread,
  hasMore,
  nextLimit,
}: {
  items: InboxItem[];
  hasUnread: boolean;
  hasMore: boolean;
  nextLimit: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const router = useRouter();

  // ชิปชนิดสร้างจาก KIND_META ตามลำดับกลาง — โชว์เฉพาะชนิดที่ "มีอยู่จริงในกล่องตอนนี้"
  // (ผู้บริหารเห็นทุกแถวจะได้ชิปเยอะ · พนักงานฝ่ายเดียวจะได้ไม่กี่ชิป)
  const kindCounts = useMemo(() => {
    const m = new Map<InboxKind, number>();
    for (const it of items) m.set(it.kind, (m.get(it.kind) ?? 0) + 1);
    return m;
  }, [items]);

  const unreadCount = useMemo(
    () => items.filter((i) => i.source === "stored" && !i.read).length,
    [items],
  );

  const shown = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread")
      return items.filter((i) => i.source === "stored" && !i.read);
    return items.filter((i) => i.kind === filter);
  }, [items, filter]);

  function run(fn: () => Promise<{ error?: string }>) {
    start(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError(null);
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
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          ทั้งหมด ({items.length})
        </Chip>
        {unreadCount > 0 && (
          <Chip
            active={filter === "unread"}
            onClick={() => setFilter("unread")}
          >
            ยังไม่อ่าน ({unreadCount})
          </Chip>
        )}
        {KIND_FILTER_ORDER.filter((k) => kindCounts.has(k)).map((k) => (
          <Chip
            key={k}
            active={filter === k}
            onClick={() => setFilter(k)}
            color={KIND_META[k].color}
          >
            {KIND_META[k].icon} {KIND_META[k].label} ({kindCounts.get(k)})
          </Chip>
        ))}
        {hasUnread && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(markAllRead)}
            className="ml-auto rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            ทำเครื่องหมายอ่านทั้งหมด
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          ไม่มีรายการในตัวกรองนี้
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((it) => (
            <InboxRow
              key={it.id}
              item={it}
              pending={pending}
              onRead={() => run(() => markRead(it.id))}
            />
          ))}
        </ul>
      )}

      {hasMore && filter === "all" && (
        <div className="flex justify-center">
          <Link
            href={`/inbox?n=${nextLimit}`}
            className="rounded-md border px-4 py-1.5 text-sm hover:bg-accent"
          >
            โหลดเพิ่ม
          </Link>
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active && color ? { borderColor: color } : undefined}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active ? "bg-accent font-medium" : "hover:bg-accent/50"
      }`}
    >
      {children}
    </button>
  );
}

function InboxRow({
  item,
  pending,
  onRead,
}: {
  item: InboxItem;
  pending: boolean;
  onRead: () => void;
}) {
  const meta = KIND_META[item.kind];
  const unread = item.source === "stored" && !item.read;

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
        {item.created_at && <span>{fmtDateTime(item.created_at)}</span>}
        {item.job_no && (
          <Link
            href={`/board/${encodeURIComponent(item.job_no)}`}
            className="text-primary hover:underline"
          >
            ไปที่งาน {displayJobNo(item.job_no)} →
          </Link>
        )}
        {unread && (
          <button
            type="button"
            disabled={pending}
            onClick={onRead}
            className="ml-auto rounded border px-2 py-0.5 hover:bg-accent disabled:opacity-50"
          >
            อ่านแล้ว
          </button>
        )}
      </div>
    </li>
  );
}
