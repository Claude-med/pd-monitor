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
import { markRead, markAllRead, dismissMany } from "./actions";

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
  // Part F — เลือกหลายรายการแล้วกดลบ
  //   "ลบ" = ซ่อนเฉพาะของคนที่กด (คนอื่นในฝ่ายที่ได้ใบเดียวกันยังเห็น · 0091)
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
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

  // 🔴 ลบได้เฉพาะรายการ stored — derived (overdue-<uuid> / stuck-<uuid>)
  //    ไม่ใช่แถวจริงในตาราง ส่ง id ไปให้ DB ไม่ได้
  const selectableIds = useMemo(
    () => shown.filter((i) => i.source === "stored").map((i) => i.id),
    [shown],
  );
  const pickedCount = useMemo(
    () => selectableIds.filter((id) => picked.has(id)).length,
    [selectableIds, picked],
  );
  const allPicked =
    selectableIds.length > 0 && pickedCount === selectableIds.length;

  function togglePick(id: string) {
    setConfirming(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setConfirming(false);
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of selectableIds) {
        if (allPicked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

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

  function deletePicked() {
    const ids = selectableIds.filter((id) => picked.has(id));
    if (ids.length === 0) return;
    run(async () => {
      const res = await dismissMany(ids);
      if (!res?.error) {
        setPicked(new Set());
        setConfirming(false);
      }
      return res;
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

      {selectableIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={toggleAll}
              className="size-4 cursor-pointer accent-primary"
            />
            <span>เลือกทั้งหมด ({selectableIds.length})</span>
          </label>

          {pickedCount > 0 &&
            (confirming ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  ลบแล้วจะหายจากกล่องของคุณเท่านั้น
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={deletePicked}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  ยืนยันลบ {pickedCount} รายการ
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                >
                  ยกเลิก
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(true)}
                className="ml-auto rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                🗑️ ลบที่เลือก ({pickedCount})
              </button>
            ))}
        </div>
      )}

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
              picked={picked.has(it.id)}
              onPick={
                it.source === "stored" ? () => togglePick(it.id) : undefined
              }
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
  picked,
  onPick,
  onRead,
}: {
  item: InboxItem;
  pending: boolean;
  picked: boolean;
  /** undefined = ติ๊กไม่ได้ (รายการ derived ไม่ใช่แถวจริงในตาราง) */
  onPick?: () => void;
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
        {onPick && (
          <input
            type="checkbox"
            checked={picked}
            onChange={onPick}
            aria-label={`เลือก ${item.title}`}
            className="size-4 cursor-pointer accent-primary"
          />
        )}
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
