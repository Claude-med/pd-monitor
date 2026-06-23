"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductOption } from "@/lib/data/products";
import { createJob, createProduct, type NewJobValues } from "./actions";

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
};

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function NewJobForm({ products: initial }: { products: ProductOption[] }) {
  const [products, setProducts] = useState<ProductOption[]>(initial);
  const [v, setV] = useState<NewJobValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // เพิ่มยาใหม่ (inline)
  const [addProd, setAddProd] = useState(false);
  const [np, setNp] = useState({ code: "", name: "", dosage_form: "", standard_time_hours: "" });
  const [prodErr, setProdErr] = useState<string | null>(null);
  const [prodPending, startProd] = useTransition();

  function set<K extends keyof NewJobValues>(k: K, val: string) {
    setV((cur) => ({ ...cur, [k]: val }));
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

  function submitProduct() {
    setProdErr(null);
    startProd(async () => {
      const res = await createProduct(np);
      if (res?.ok && res.id) {
        const added: ProductOption = {
          id: res.id,
          code: np.code.trim(),
          name: np.name.trim(),
          dosage_form: np.dosage_form.trim() || null,
        };
        setProducts((cur) => [...cur, added]);
        set("product_id", res.id); // เลือกยาที่เพิ่งเพิ่มให้เลย
        setNp({ code: "", name: "", dosage_form: "", standard_time_hours: "" });
        setAddProd(false);
        return;
      }
      setProdErr(res?.error ?? "เพิ่มผลิตภัณฑ์ไม่สำเร็จ");
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
          <div className="flex gap-2">
            <select
              value={v.product_id}
              onChange={(e) => set("product_id", e.target.value)}
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
            <button
              type="button"
              onClick={() => setAddProd((s) => !s)}
              className="shrink-0 rounded-md border px-3 py-2 text-sm hover:bg-accent"
            >
              {addProd ? "ยกเลิก" : "＋ เพิ่มยาใหม่"}
            </button>
          </div>

          {addProd && (
            <div className="mt-2 space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>รหัสยา (code) *</label>
                  <input
                    value={np.code}
                    onChange={(e) => setNp((c) => ({ ...c, code: e.target.value }))}
                    placeholder="เช่น PRD-004"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>ชื่อยา *</label>
                  <input
                    value={np.name}
                    onChange={(e) => setNp((c) => ({ ...c, name: e.target.value }))}
                    placeholder="เช่น ไอบูโพรเฟน 400 มก."
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>รูปแบบ</label>
                  <input
                    value={np.dosage_form}
                    onChange={(e) => setNp((c) => ({ ...c, dosage_form: e.target.value }))}
                    placeholder="เม็ด / แคปซูล / ครีม"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>เวลามาตรฐาน (ชม.)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={np.standard_time_hours}
                    onChange={(e) =>
                      setNp((c) => ({ ...c, standard_time_hours: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
              </div>
              {prodErr && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {prodErr}
                </p>
              )}
              <button
                type="button"
                disabled={prodPending}
                onClick={submitProduct}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {prodPending ? "กำลังเพิ่ม…" : "บันทึกยาใหม่"}
              </button>
            </div>
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
