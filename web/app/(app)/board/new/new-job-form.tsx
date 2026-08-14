"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductOption } from "@/lib/data/products";
import { PACK_TYPES } from "@/lib/data/packaging-constants";
import { createJob, type NewJobValues } from "./actions";

const MAX_PACKS = 3;

const EMPTY: NewJobValues = {
  job_no: "",
  customer: "",
  product_id: "",
  quantity: "",
  unit: "เม็ด",
  due_date: "",
  planned_start: "",
  planned_end: "",
  lot_no: "",
  pack_type: "",
  pack_patterns: [""],
};

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function NewJobForm({ products }: { products: ProductOption[] }) {
  const [v, setV] = useState<NewJobValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof NewJobValues>(k: K, val: NewJobValues[K]) {
    setV((cur) => ({ ...cur, [k]: val }));
  }

  /** เลือกยา → เติมหน่วยจากทะเบียนผลิตภัณฑ์ให้อัตโนมัติ (แก้ทับได้) */
  function selectProduct(id: string) {
    const p = products.find((x) => x.id === id);
    setV((cur) => ({
      ...cur,
      product_id: id,
      unit: p?.unit ? p.unit : cur.unit,
    }));
  }

  function setPack(idx: number, val: string) {
    setV((cur) => ({
      ...cur,
      pack_patterns: cur.pack_patterns.map((p, i) => (i === idx ? val : p)),
    }));
  }
  function addPack() {
    setV((cur) =>
      cur.pack_patterns.length >= MAX_PACKS
        ? cur
        : { ...cur, pack_patterns: [...cur.pack_patterns, ""] },
    );
  }
  function removePack(idx: number) {
    setV((cur) =>
      cur.pack_patterns.length <= 1
        ? cur
        : { ...cur, pack_patterns: cur.pack_patterns.filter((_, i) => i !== idx) },
    );
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await createJob(v);
      if (res?.ok && res.jobNo) {
        router.push(`/board/${encodeURIComponent(res.jobNo)}`);
        return;
      }
      setError(res?.error ?? "สร้างงานไม่สำเร็จ");
    });
  }

  return (
    <div className="space-y-5 rounded-xl border bg-card p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* เลขงาน */}
        <div>
          <label className={labelClass}>เลขงาน (Job No)</label>
          <input
            value={v.job_no}
            onChange={(e) => set("job_no", e.target.value)}
            placeholder="เว้นว่าง = ออกเลขอัตโนมัติ"
            className={inputClass}
          />
        </div>

        {/* ลูกค้า */}
        <div>
          <label className={labelClass}>ลูกค้า *</label>
          <input
            value={v.customer}
            onChange={(e) => set("customer", e.target.value)}
            placeholder="ชื่อลูกค้า / หน่วยงาน"
            className={inputClass}
          />
        </div>

        {/* ผลิตภัณฑ์ */}
        <div className="sm:col-span-2">
          <label className={labelClass}>ผลิตภัณฑ์ (ยา) *</label>
          <select
            value={v.product_id}
            onChange={(e) => selectProduct(e.target.value)}
            className={inputClass}
          >
            <option value="">— เลือกยา —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
                {p.dosage_form ? ` (${p.dosage_form})` : ""}
              </option>
            ))}
          </select>
          {products.length === 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              ยังไม่มียาในระบบ — เพิ่มที่เมนู “ผลิตภัณฑ์ / ขั้นตอนการผลิต” ก่อน
            </p>
          )}
        </div>

        {/* จำนวน + หน่วย */}
        <div>
          <label className={labelClass}>จำนวน *</label>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={v.quantity}
            onChange={(e) => set("quantity", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>หน่วย</label>
          <input
            value={v.unit}
            onChange={(e) => set("unit", e.target.value)}
            placeholder="เม็ด / แคปซูล / ขวด"
            className={inputClass}
          />
        </div>

        {/* รูปแบบบรรจุ + ขนาดบรรจุ (สูงสุด 3) */}
        <div className="sm:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>รูปแบบบรรจุ</label>
              <select
                value={v.pack_type}
                onChange={(e) => set("pack_type", e.target.value)}
                className={inputClass}
              >
                <option value="">— เลือกรูปแบบ —</option>
                {PACK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label className={labelClass}>
              Packing Size (ขนาดบรรจุ · สูงสุด {MAX_PACKS} ขนาด)
            </label>
            {v.pack_patterns.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={p}
                  onChange={(e) => setPack(i, e.target.value)}
                  placeholder={`ขนาดบรรจุ (${i + 1}) — เช่น 666 x 30 x 10's`}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => removePack(i)}
                  disabled={v.pack_patterns.length <= 1}
                  className="shrink-0 rounded-md border px-3 py-2 text-xs text-destructive hover:bg-accent disabled:opacity-30"
                  title="ลบขนาดนี้"
                >
                  ลบ
                </button>
              </div>
            ))}
            {v.pack_patterns.length < MAX_PACKS && (
              <button
                type="button"
                onClick={addPack}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
              >
                ＋ เพิ่มขนาดบรรจุ
              </button>
            )}
            <p className="text-xs text-muted-foreground">
              * ยาตัวเดียวกันแต่ละล็อตบรรจุคนละแบบได้ — จึงกรอกที่งานผลิต ไม่ใช่ที่ทะเบียนยา
            </p>
          </div>
        </div>

        {/* กำหนดส่ง */}
        <div>
          <label className={labelClass}>กำหนดส่ง (due date)</label>
          <input
            type="date"
            value={v.due_date}
            onChange={(e) => set("due_date", e.target.value)}
            className={inputClass}
          />
        </div>
        {/* ล็อต (ออปชัน) */}
        <div>
          <label className={labelClass}>เลขล็อต (Lot) — ถ้ามี</label>
          <input
            value={v.lot_no}
            onChange={(e) => set("lot_no", e.target.value)}
            placeholder="ผูกล็อตตอนนี้ หรือเว้นไว้ใส่ทีหลัง"
            className={inputClass}
          />
        </div>

        {/* แผนเริ่ม–เสร็จ */}
        <div>
          <label className={labelClass}>แผนเริ่มผลิต</label>
          <input
            type="date"
            value={v.planned_start}
            onChange={(e) => set("planned_start", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>แผนเสร็จ</label>
          <input
            type="date"
            value={v.planned_end}
            onChange={(e) => set("planned_end", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังสร้าง…" : "สร้างงานผลิต"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/board")}
          className="rounded-md border px-5 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        งานใหม่จะเริ่มที่สถานะ <b>รอแจ้งผลิต</b> — แล้วค่อยเดินสถานะตามขั้นในหน้างาน
      </p>
    </div>
  );
}
