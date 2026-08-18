"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerOption } from "@/lib/data/customers";
import { upsertCustomer, deleteCustomer } from "./customer-actions";

/** ช่องเลือกลูกค้า + ปุ่มจัดการทะเบียน (Part 3) — ส่งค่าออกเป็น customer_id */

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/** ลูกค้าที่ลบไม่ได้เพราะยังมีงานผูกอยู่ — ต้องเลือกปลายทางให้ก่อน */
type Blocked = {
  id: string;
  name: string;
  orders: number;
  jobs: number;
  message: string;
};

export function CustomerPicker({
  customers,
  value,
  onChange,
}: {
  customers: CustomerOption[];
  /** customer_id ที่เลือกอยู่ */
  value: string;
  onChange: (customerId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          <option value="">— เลือกลูกค้า —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="จัดการทะเบียนลูกค้า"
          className="whitespace-nowrap rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          ⚙ จัดการ
        </button>
      </div>

      {customers.length === 0 && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          ยังไม่มีลูกค้าในทะเบียน — กด “⚙ จัดการ” เพื่อเพิ่ม
        </p>
      )}

      {open && (
        <CustomerManagerModal
          customers={customers}
          selectedId={value}
          onClearSelected={() => onChange("")}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CustomerManagerModal({
  customers,
  selectedId,
  onClearSelected,
  onClose,
}: {
  customers: CustomerOption[];
  selectedId: string;
  onClearSelected: () => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // ล็อกไม่ให้หน้าเลื่อนใต้ modal ตอนเปิด (คืนค่าเมื่อปิด/unmount)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function reset() {
    setEditingId(null);
    setEditName("");
    setConfirmId(null);
    setBlocked(null);
    setReassignTo("");
    setError(null);
  }

  function add() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await upsertCustomer(null, newName);
      if (res.error) return setError(res.error);
      setNewName("");
      setNotice("เพิ่มลูกค้าแล้ว");
      router.refresh();
    });
  }

  function saveEdit(id: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await upsertCustomer(id, editName);
      if (res.error) return setError(res.error);
      // ค่าที่เลือกในฟอร์มเป็น id จึงไม่ต้องแก้ — แค่ชื่อที่แสดงเปลี่ยน
      reset();
      setNotice("แก้ชื่อลูกค้าแล้ว (ใบสั่งผลิตที่ผูกอยู่อัปเดตตามให้อัตโนมัติ)");
      router.refresh();
    });
  }

  function remove(id: string, name: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await deleteCustomer(id);
      if (res.error) return setError(res.error);
      if (res.action === "blocked") {
        setConfirmId(null);
        setBlocked({
          id,
          name,
          orders: res.orders ?? 0,
          jobs: res.jobs ?? 0,
          message: res.message ?? "",
        });
        return;
      }
      if (id === selectedId) onClearSelected();
      reset();
      setNotice(res.message ?? "ลบลูกค้าแล้ว");
      router.refresh();
    });
  }

  function reassignAndRemove() {
    if (!blocked || !reassignTo) return;
    setError(null);
    start(async () => {
      const res = await deleteCustomer(blocked.id, reassignTo);
      if (res.error) return setError(res.error);
      if (blocked.id === selectedId) onClearSelected();
      reset();
      setNotice(res.message ?? "ย้ายงานแล้วลบลูกค้าเรียบร้อย");
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border bg-card p-5 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold">ทะเบียนลูกค้า / หน่วยงาน</p>
          <button
            type="button"
            aria-label="ปิด"
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            ✕
          </button>
        </div>

        {/* ---------- สเต็ป "ย้ายงานก่อนลบ" ---------- */}
        {blocked ? (
          <div className="space-y-3 rounded-md border border-red-300 bg-red-50/60 p-3 dark:bg-red-950/20">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              ลบ “{blocked.name}” ไม่ได้
            </p>
            <p className="text-xs text-red-700 dark:text-red-400">
              {blocked.message}
            </p>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                ย้ายงานทั้งหมดไปที่ลูกค้า (จำเป็น)
              </label>
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className={inputClass}
              >
                <option value="">— เลือกลูกค้าปลายทาง —</option>
                {customers
                  .filter((c) => c.id !== blocked.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending || !reassignTo}
                onClick={reassignAndRemove}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "กำลังย้าย…" : "ย้ายงานทั้งหมดแล้วลบ"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={reset}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ---------- เพิ่มลูกค้าใหม่ ---------- */}
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ชื่อลูกค้า / หน่วยงานใหม่"
                className={inputClass}
              />
              <button
                type="button"
                disabled={pending || !newName.trim()}
                onClick={add}
                className="whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                ＋ เพิ่ม
              </button>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                {notice}
              </p>
            )}

            {/* ---------- รายการ ---------- */}
            {customers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                ยังไม่มีลูกค้าในทะเบียน
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {customers.map((c) => (
                  <li key={c.id} className="p-2">
                    {editingId === c.id ? (
                      <div className="flex gap-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className={inputClass}
                        />
                        <button
                          type="button"
                          disabled={pending || !editName.trim()}
                          onClick={() => saveEdit(c.id)}
                          className="whitespace-nowrap rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                        >
                          บันทึก
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={reset}
                          className="whitespace-nowrap rounded-md border px-3 py-2 text-xs hover:bg-accent"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : confirmId === c.id ? (
                      <div className="space-y-2 rounded-md border border-red-300 bg-red-50/60 p-2 dark:bg-red-950/20">
                        <p className="text-xs text-red-800 dark:text-red-300">
                          ยืนยันลบ “{c.name}”?
                          {c.usage_count > 0 &&
                            ` — มีใบสั่งผลิต ${c.usage_count} ใบผูกอยู่ ระบบจะให้เลือกลูกค้าใหม่ก่อน`}
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => remove(c.id, c.name)}
                            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {pending ? "กำลังลบ…" : "ยืนยันลบ"}
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={reset}
                            className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm">
                          {c.name}
                          {c.usage_count > 0 && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({c.usage_count} ใบสั่งผลิต)
                            </span>
                          )}
                        </span>
                        <span className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              reset();
                              setEditingId(c.id);
                              setEditName(c.name);
                            }}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                          >
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              reset();
                              setConfirmId(c.id);
                            }}
                            className="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-accent"
                          >
                            ลบ
                          </button>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
