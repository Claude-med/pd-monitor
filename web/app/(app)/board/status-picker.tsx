"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JobSubStatusOption } from "@/lib/data/job-sub-statuses";
import { toMonthInput, fromMonthInput } from "@/lib/data/job-constants";
import { upsertJobSubStatus, deleteJobSubStatus } from "./sub-status-actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * ช่อง Status ของงาน (Part C) — เลือกจากทะเบียน + ช่องค้นหา + ปุ่มจัดการทะเบียน
 *
 * ⚠️ ใช้ input ค้นหาแยก + <select> native ที่ถูกกรอง (แพทเทิร์นเดียวกับหน้าเบิกล็อต
 *    requisitions.tsx) ไม่เขียน dropdown panel เอง — บนมือถือได้ picker ของ OS
 *    และไม่ต้องแก้เรื่อง focus/z-index/คลิกนอกกล่องเอง
 * ⚠️ ห้ามใส่ size={n} — size>1 ทำให้ <select> กลายเป็นกล่องรายการกางค้าง (บทเรียน Part 2.1)
 */
export function StatusPicker({
  options,
  value,
  planMonth,
  onChange,
  disabled = false,
}: {
  options: JobSubStatusOption[];
  /** ชื่อสถานะที่เลือกอยู่ (เก็บเป็น text ใน jobs.sub_status) */
  value: string;
  /** เดือนแผน 'YYYY-MM-01' หรือ null */
  planMonth: string | null;
  onChange: (name: string, planMonth: string | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [manageOpen, setManageOpen] = useState(false);

  const selected = options.find((o) => o.name === value) ?? null;
  const needMonth = selected?.requires_plan_month ?? false;

  // ค่าเดิมของงานที่ถูกลบ/ปิดใช้งานไปแล้ว ต้องคงอยู่ในลิสต์
  // ไม่งั้นเปิดฟอร์มแล้วค่าเด้งว่าง → กดบันทึกทับของเดิมโดยไม่ตั้งใจ
  const retired = value && !selected ? value : null;

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? options.filter(
            (o) =>
              o.name === value ||
              o.name.toLowerCase().includes(q) ||
              (o.description ?? "").toLowerCase().includes(q),
          )
        : options,
    [options, q, value],
  );

  function pick(name: string) {
    const opt = options.find((o) => o.name === name);
    // เปลี่ยนไปสถานะที่ไม่ต้องระบุเดือน → เคลียร์เดือนทิ้ง ไม่ให้ค้างใน DB
    onChange(name, opt?.requires_plan_month ? planMonth : null);
  }

  return (
    <>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled}
            placeholder="🔎 พิมพ์ค้นหาสถานะ"
            className={inputClass}
          />
          <select
            value={value}
            onChange={(e) => pick(e.target.value)}
            disabled={disabled}
            className={inputClass}
          >
            <option value="">— เลือกสถานะ —</option>
            {retired && (
              <option value={retired}>{retired} (เลิกใช้แล้ว)</option>
            )}
            {visible.map((o) => (
              <option key={o.id} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
          {q && (
            <p className="text-[11px] text-muted-foreground">
              พบ {visible.length.toLocaleString("th-TH")} สถานะ (จากทั้งหมด{" "}
              {options.length.toLocaleString("th-TH")})
            </p>
          )}
          {selected?.description && (
            <p className="text-[11px] text-muted-foreground">
              {selected.description}
            </p>
          )}

          {/* สถานะที่ผูกกับเดือนแผน — เช่น "มีแผน" → บันทึกแล้วโชว์เป็น "มีแผน08/26" */}
          {needMonth && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                เดือนที่ลงแผน (MM/YY) <span className="text-destructive">*</span>
              </label>
              <input
                type="month"
                value={toMonthInput(planMonth)}
                disabled={disabled}
                onChange={(e) => onChange(value, fromMonthInput(e.target.value))}
                className={inputClass}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setManageOpen(true)}
          title="จัดการทะเบียนสถานะ"
          className="h-fit whitespace-nowrap rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          ⚙ จัดการ
        </button>
      </div>

      {manageOpen && (
        <StatusManagerModal
          options={options}
          selectedName={value}
          onClearSelected={() => onChange("", null)}
          onClose={() => setManageOpen(false)}
        />
      )}
    </>
  );
}

/** modal จัดการทะเบียน — เพิ่ม / แก้ชื่อ / ลบ (แพทเทิร์นเดียวกับ customer-picker.tsx) */
function StatusManagerModal({
  options,
  selectedName,
  onClearSelected,
  onClose,
}: {
  options: JobSubStatusOption[];
  selectedName: string;
  onClearSelected: () => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newNeedMonth, setNewNeedMonth] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; name: string; jobs: number; message: string } | null>(null);
  const [query, setQuery] = useState("");
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
    setError(null);
  }

  function add() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await upsertJobSubStatus(null, newName, "", newNeedMonth);
      if (res.error) return setError(res.error);
      setNewName("");
      setNewNeedMonth(false);
      setNotice(res.message ?? "เพิ่มสถานะแล้ว");
      router.refresh();
    });
  }

  function saveEdit(id: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      const cur = options.find((o) => o.id === id);
      const res = await upsertJobSubStatus(
        id,
        editName,
        cur?.description ?? "",
        cur?.requires_plan_month ?? false,
      );
      if (res.error) return setError(res.error);
      reset();
      setNotice(res.message ?? "แก้ชื่อสถานะแล้ว");
      router.refresh();
    });
  }

  function remove(id: string, name: string, force: boolean) {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await deleteJobSubStatus(id, force);
      if (res.error) return setError(res.error);
      if (res.action === "blocked") {
        setConfirmId(null);
        setBlocked({ id, name, jobs: res.jobs ?? 0, message: res.message ?? "" });
        return;
      }
      if (name === selectedName) onClearSelected();
      reset();
      setNotice(res.message ?? "ทำรายการแล้ว");
      router.refresh();
    });
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter((o) => o.name.toLowerCase().includes(q))
    : options;

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
          <p className="text-sm font-semibold">
            ทะเบียนสถานะงาน{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (ทุกฝ่ายจัดการได้)
            </span>
          </p>
          <button
            type="button"
            aria-label="ปิด"
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            ✕
          </button>
        </div>

        {blocked ? (
          <div className="space-y-3 rounded-md border border-red-300 bg-red-50/60 p-3 dark:bg-red-950/20">
            <p className="text-sm font-medium">ลบ “{blocked.name}” ไม่ได้</p>
            <p className="text-xs text-muted-foreground">{blocked.message}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(blocked.id, blocked.name, true)}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "กำลังทำ…" : "ยืนยัน — ปิดใช้งานสถานะนี้"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setBlocked(null)}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="ชื่อสถานะใหม่ — เช่น รอตรวจความหนา"
                  className={inputClass}
                />
                <button
                  type="button"
                  disabled={pending || !newName.trim()}
                  onClick={add}
                  className="whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  ＋ เพิ่ม
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={newNeedMonth}
                  onChange={(e) => setNewNeedMonth(e.target.checked)}
                />
                เลือกสถานะนี้แล้วต้องระบุเดือนแผน (เหมือน “มีแผน”)
              </label>
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

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔎 ค้นหาในทะเบียน"
              className={inputClass}
            />

            <ul className="divide-y rounded-md border">
              {visible.map((o) => (
                <li key={o.id} className="p-2">
                  {editingId === o.id ? (
                    <div className="flex gap-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className={inputClass}
                      />
                      <button
                        type="button"
                        disabled={pending || !editName.trim()}
                        onClick={() => saveEdit(o.id)}
                        className="whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        บันทึก
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={reset}
                        className="whitespace-nowrap rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  ) : confirmId === o.id ? (
                    <div className="space-y-2 rounded-md border border-red-300 bg-red-50/60 p-2 dark:bg-red-950/20">
                      <p className="text-xs">
                        ลบ “{o.name}” ออกจากทะเบียน?
                        {o.usage_count > 0 &&
                          ` (มีงานใช้อยู่ ${o.usage_count.toLocaleString("th-TH")} ใบ)`}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => remove(o.id, o.name, false)}
                          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          ลบ
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={reset}
                          className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm">
                          {o.name}
                          {o.requires_plan_month && (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              (+เดือนแผน)
                            </span>
                          )}
                          {o.is_system && (
                            <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              ค่าระบบ
                            </span>
                          )}
                        </p>
                        {o.usage_count > 0 && (
                          <p className="text-[11px] text-muted-foreground">
                            ใช้อยู่ {o.usage_count.toLocaleString("th-TH")} ใบ
                          </p>
                        )}
                      </div>
                      {!o.is_system && (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(o.id);
                              setEditName(o.name);
                              setConfirmId(null);
                            }}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                          >
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmId(o.id);
                              setEditingId(null);
                            }}
                            className="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-accent"
                          >
                            ลบ
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
