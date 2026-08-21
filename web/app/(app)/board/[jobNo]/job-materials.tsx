"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MATERIAL_ITEM_TYPES,
  type MaterialItemType,
} from "@/lib/data/job-material-constants";
import type { JobMaterialRow } from "@/lib/data/job-materials";
import { JobMaterialCard } from "@/components/job-material-card";
import {
  upsertJobMaterial,
  deleteJobMaterial,
} from "@/lib/actions/job-materials";

/**
 * "เบิกวัตถุดิบ/บรรจุภัณฑ์" บนหน้ารายละเอียดงาน (Part C.2)
 *
 * แทนระบบเบิกเดิมที่ผูกล็อตในคลังแล้วตัดสต็อก — ของใหม่เป็นบันทึกหน้างานล้วน
 *   ฝ่ายผลิต : เพิ่ม / แก้ / ลบ  (สถานะกดไม่ได้)
 *   ฝ่ายคลัง : กดสถานะ พร้อม/ไม่พร้อม อย่างเดียว
 */

type FormState = {
  itemName: string;
  itemType: MaterialItemType;
  qty: string;
  qtyUnit: string;
  note: string;
};

const EMPTY_FORM: FormState = {
  itemName: "",
  itemType: "RM",
  qty: "",
  qtyUnit: "",
  note: "",
};

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

function MaterialForm({
  initial,
  submitLabel,
  warnReset,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  submitLabel: string;
  warnReset: boolean;
  pending: boolean;
  onSubmit: (v: FormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={labelCls}>ชื่อวัตถุดิบ/บรรจุภัณฑ์ *</label>
          <input
            value={form.itemName}
            onChange={(e) => set("itemName", e.target.value)}
            placeholder="เช่น แป้งข้าวโพด · ขวด HDPE 100 ml"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>ประเภท *</label>
          <select
            value={form.itemType}
            onChange={(e) => set("itemType", e.target.value as MaterialItemType)}
            className={inputCls}
          >
            {MATERIAL_ITEM_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>จำนวนที่เบิก</label>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={form.qty}
            onChange={(e) => set("qty", e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>หน่วย</label>
          <input
            value={form.qtyUnit}
            onChange={(e) => set("qtyUnit", e.target.value)}
            placeholder="kg · ม้วน · ใบ"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>หมายเหตุ</label>
          <input
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        จำนวน/หน่วยเว้นว่างได้ ถ้ายังไม่ระบุ (เช่น “แป้ง — ตามสูตร”)
      </p>

      {warnReset && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          ฝ่ายคลังกด “พร้อม” ให้รายการนี้แล้ว — ถ้าแก้ชื่อ/ประเภท/จำนวน/หน่วย
          สถานะจะกลับเป็น “ไม่พร้อม” ให้ฝ่ายคลังตรวจใหม่ (แก้เฉพาะหมายเหตุไม่เปลี่ยนสถานะ)
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onSubmit(form)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ปิด
        </button>
      </div>
    </div>
  );
}

export function JobMaterials({
  jobId,
  jobNo,
  items,
  canEdit,
  canSetStatus,
}: {
  jobId: string;
  jobNo: string;
  items: JobMaterialRow[];
  canEdit: boolean;
  canSetStatus: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // key บังคับให้ฟอร์มเพิ่มรีเซ็ตค่าในช่องหลังบันทึกสำเร็จ (ฟอร์มถือ state ของตัวเอง)
  const [formKey, setFormKey] = useState(0);
  const [pending, start] = useTransition();
  const router = useRouter();

  const notReady = items.filter((i) => i.status === "not_ready").length;

  function save(v: FormState, id: string | null) {
    setError(null);
    setOkMsg(null);
    start(async () => {
      const res = await upsertJobMaterial({
        id,
        jobId,
        jobNo,
        itemName: v.itemName,
        itemType: v.itemType,
        qty: v.qty,
        qtyUnit: v.qtyUnit,
        note: v.note,
      });
      if (res.error) return setError(res.error);
      if (id) {
        setEditId(null);
      } else {
        // คนลงรายการมักพิมพ์ติดกันหลายรายการ — คงฟอร์มเปิดไว้ ล้างแค่ช่องกรอก
        setFormKey((k) => k + 1);
        setOkMsg("✓ เพิ่มแล้ว — พิมพ์รายการถัดไปได้เลย");
      }
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      const res = await deleteJobMaterial(id, jobNo);
      if (res.error) return setError(res.error);
      setConfirmId(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">เบิกวัตถุดิบ/บรรจุภัณฑ์</h2>
        <span className="text-xs text-muted-foreground">
          {items.length} รายการ
          {notReady > 0 ? ` · ไม่พร้อม ${notReady}` : ""}
        </span>
      </div>

      {notReady > 0 && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          ⚠️ ยังมีวัตถุดิบ/บรรจุภัณฑ์ไม่พร้อม {notReady} รายการ —
          ระบบไม่ได้กั้นการเดินสถานะงาน แต่ควรเคลียร์กับฝ่ายคลังก่อนเริ่มผลิต
        </div>
      )}

      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) =>
            editId === item.id ? (
              <MaterialForm
                key={item.id}
                initial={{
                  itemName: item.item_name,
                  itemType: item.item_type,
                  qty: item.qty == null ? "" : String(item.qty),
                  qtyUnit: item.qty_unit ?? "",
                  note: item.note ?? "",
                }}
                submitLabel="บันทึกการแก้ไข"
                warnReset={item.status === "ready"}
                pending={pending}
                onSubmit={(v) => save(v, item.id)}
                onCancel={() => setEditId(null)}
              />
            ) : (
              <JobMaterialCard
                key={item.id}
                item={item}
                jobNo={jobNo}
                canSetStatus={canSetStatus}
                actions={
                  canEdit ? (
                    confirmId === item.id ? (
                      <>
                        <span className="text-xs text-destructive">
                          {item.status === "ready"
                            ? "ฝ่ายคลังกด “พร้อม” แล้ว — ยืนยันลบ?"
                            : "ยืนยันลบรายการนี้?"}
                        </span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => remove(item.id)}
                          className="rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          ลบเลย
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                        >
                          ยกเลิก
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setConfirmId(null);
                            setEditId(item.id);
                          }}
                          className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                        >
                          ✏️ แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(item.id)}
                          className="rounded-md border px-2.5 py-1 text-xs text-destructive hover:bg-accent"
                        >
                          🗑 ลบ
                        </button>
                      </>
                    )
                  ) : undefined
                }
              />
            ),
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีรายการเบิกวัตถุดิบ/บรรจุภัณฑ์
          {canEdit ? " — กด ＋ ด้านล่างเพื่อเริ่มลงรายการ" : ""}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {canEdit && (
        <div className="mt-4">
          {adding ? (
            <div className="space-y-2">
              <MaterialForm
                key={formKey}
                initial={EMPTY_FORM}
                submitLabel="เพิ่มรายการ"
                warnReset={false}
                pending={pending}
                onSubmit={(v) => save(v, null)}
                onCancel={() => {
                  setOkMsg(null);
                  setAdding(false);
                }}
              />
              {okMsg && (
                <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                  {okMsg}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOkMsg(null);
                setAdding(true);
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              ＋ เพิ่มรายการเบิก
            </button>
          )}
        </div>
      )}

      {!canEdit && !canSetStatus && items.length > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          ดูอย่างเดียว — ฝ่ายผลิตเป็นคนลงรายการ · ฝ่ายคลังเป็นคนกดสถานะความพร้อม
        </p>
      )}
    </div>
  );
}
