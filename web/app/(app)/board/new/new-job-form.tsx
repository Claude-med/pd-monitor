"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductOption } from "@/lib/data/products";
import type { CustomerOption } from "@/lib/data/customers";
import { PACK_TYPES } from "@/lib/data/packaging-constants";
import { MAX_JOBS_PER_CREATE } from "@/lib/data/job-constants";
import { CustomerPicker } from "./customer-picker";
import { createJobs, type NewJobValues } from "./actions";

const MAX_PACKS = 3;

const EMPTY: NewJobValues = {
  customer_id: "",
  product_id: "",
  quantity: "",
  unit: "เม็ด",
  due_date: "",
  request_no: "",
  cpo_date: "",
  sub_status: "",
  pack_type: "",
  pack_patterns: [""],
  count: "1",
};

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function NewJobForm({
  products,
  customers,
}: {
  products: ProductOption[];
  customers: CustomerOption[];
}) {
  const [v, setV] = useState<NewJobValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof NewJobValues>(k: K, val: NewJobValues[K]) {
    setV((cur) => ({ ...cur, [k]: val }));
  }

  // Part 2.1: ยาที่ยังไม่ได้ตั้งขั้นตอนการผลิต สร้างงานไม่ได้
  // (ด่านจริงอยู่ที่ DB — ตรงนี้แค่กันไม่ให้ผู้ใช้กรอกทั้งฟอร์มแล้วเจอ error ตอนท้าย)
  const picked = products.find((p) => p.id === v.product_id);
  const missingRoute = !!picked && !picked.has_route;

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
      const res = await createJobs(v);
      const nos = res?.jobNos ?? [];
      if (res?.ok && nos.length > 0) {
        // ใบเดียว → เข้าหน้างานเลย · หลายใบ → สรุปให้ดูก่อนว่าได้เลขอะไรบ้าง
        if (nos.length === 1) {
          router.push(`/board/${encodeURIComponent(nos[0])}`);
          return;
        }
        setCreated(nos);
        return;
      }
      setError(res?.error ?? "สร้างงานไม่สำเร็จ");
    });
  }

  /** ---------- สรุปหลังสร้างหลายใบ ---------- */
  if (created) {
    return (
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <p className="text-sm font-semibold">
          ✅ สร้างงานผลิตแล้ว {created.length} ใบ
        </p>
        <p className="text-sm">
          เลขงาน{" "}
          <b>
            {created[0]} – {created[created.length - 1]}
          </b>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {created.map((no) => (
            <button
              key={no}
              type="button"
              onClick={() => router.push(`/board/${encodeURIComponent(no)}`)}
              className="rounded-md border px-2 py-1 font-mono text-xs hover:bg-accent"
            >
              {no}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => router.push("/board")}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            ไปที่บอร์ดงาน
          </button>
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              setV(EMPTY);
            }}
            className="rounded-md border px-5 py-2 text-sm hover:bg-accent"
          >
            สร้างชุดใหม่อีก
          </button>
        </div>
      </div>
    );
  }

  const count = Number(v.count || "1");
  const countInvalid =
    !Number.isInteger(count) || count < 1 || count > MAX_JOBS_PER_CREATE;

  return (
    <div className="space-y-5 rounded-xl border bg-card p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* JOB NO. — Part 3: ระบบออกเลขให้เอง กรอกเองไม่ได้ */}
        <div>
          <label className={labelClass}>JOB NO.</label>
          <div className="rounded-md border border-dashed border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            ระบบออกเลขให้อัตโนมัติ (69xxxx)
          </div>
        </div>

        {/* ลูกค้า — เลือกจากทะเบียน ไม่พิมพ์อิสระแล้ว */}
        <div>
          <label className={labelClass}>ลูกค้า / หน่วยงาน *</label>
          <CustomerPicker
            customers={customers}
            value={v.customer_id}
            onChange={(id) => set("customer_id", id)}
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
                {p.has_route ? "" : "  ⚠️ ยังไม่ได้ตั้งขั้นตอนการผลิต"}
              </option>
            ))}
          </select>
          {products.length === 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              ยังไม่มียาในระบบ — เพิ่มที่เมนู “ผลิตภัณฑ์ / ขั้นตอนการผลิต” ก่อน
            </p>
          )}
          {missingRoute && (
            <p className="mt-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              ⚠️ <strong>{picked?.code}</strong> ยังไม่ได้ตั้งขั้นตอนการผลิต — สร้างงานไม่ได้
              <br />
              ไปตั้งที่เมนู “ผลิตภัณฑ์ / ขั้นตอนการผลิต” ก่อน ไม่งั้นงานนี้จะบันทึกผลผลิตและตรวจ
              in-process QC ไม่ได้
            </p>
          )}
        </div>

        {/* Batch size + หน่วย */}
        <div>
          <label className={labelClass}>Batch size *</label>
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

        {/* ใบคำขอ + C.P.O DATE */}
        <div>
          <label className={labelClass}>ใบคำขอ</label>
          <input
            value={v.request_no}
            onChange={(e) => set("request_no", e.target.value)}
            placeholder="เลขที่ใบสั่งผลิตจากลูกค้า"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>C.P.O DATE</label>
          <input
            type="date"
            value={v.cpo_date}
            onChange={(e) => set("cpo_date", e.target.value)}
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

        {/* กำหนดส่ง + Status */}
        <div>
          <label className={labelClass}>กำหนดส่ง (due date)</label>
          <input
            type="date"
            value={v.due_date}
            onChange={(e) => set("due_date", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <input
            value={v.sub_status}
            onChange={(e) => set("sub_status", e.target.value)}
            placeholder="เช่น รอวัตถุดิบ / UNPLAN"
            className={inputClass}
          />
        </div>

        {/* จำนวนใบที่จะสร้าง */}
        <div className="sm:col-span-2">
          <label className={labelClass}>จำนวนใบที่จะสร้าง</label>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            max={MAX_JOBS_PER_CREATE}
            value={v.count}
            onChange={(e) => set("count", e.target.value)}
            className={`${inputClass} sm:max-w-[12rem]`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            ทุกใบใช้ข้อมูลชุดเดียวกัน (Batch size · ยา · รูปแบบบรรจุ) และได้เลขงานไล่ต่อกัน —
            สูงสุด {MAX_JOBS_PER_CREATE} ใบต่อครั้ง
          </p>
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
          disabled={pending || missingRoute || countInvalid}
          onClick={submit}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? "กำลังสร้าง…"
            : count > 1
              ? `สร้างงานผลิต ${count} ใบ`
              : "สร้างงานผลิต"}
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
        งานใหม่จะเริ่มที่สถานะ <b>รอแจ้งผลิต</b> — แล้วค่อยเดินสถานะตามขั้นในหน้างาน ·
        เลขล็อต (LOT No.) ให้ฝ่ายผลิตกรอกในหน้างานก่อนเริ่มผลิต
      </p>
    </div>
  );
}
