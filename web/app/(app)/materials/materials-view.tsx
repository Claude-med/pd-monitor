"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MATERIAL_TYPES,
  MATERIAL_TYPE_LABEL,
  MATERIAL_LOT_STATUSES,
  MATERIAL_LOT_STATUS_LABEL,
  MATERIAL_LOT_STATUS_COLOR,
  USABLE_LOT_STATUSES,
  type MaterialLotStatus,
} from "@/lib/data/material-constants";
import { daysUntil } from "@/lib/data/machine-constants";
import type { MaterialWithLots, MaterialLot } from "@/lib/data/materials";
import { upsertMaterial, upsertMaterialLot } from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

function LotStatusBadge({ status }: { status: string }) {
  return (
    <span
      className="rounded px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: MATERIAL_LOT_STATUS_COLOR[status] ?? "#64748b" }}
    >
      {MATERIAL_LOT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function ExpiryBadge({ date }: { date: string | null }) {
  const d = daysUntil(date);
  if (d === null) return null;
  if (d < 0)
    return (
      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
        หมดอายุแล้ว {Math.abs(d)} วัน
      </span>
    );
  if (d <= 30)
    return (
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
        ใกล้หมดอายุ (อีก {d} วัน)
      </span>
    );
  return null;
}

export function MaterialsView({
  materials,
  canManage,
}: {
  materials: MaterialWithLots[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editMatId, setEditMatId] = useState<string | null>(null);
  const [addLotFor, setAddLotFor] = useState<string | null>(null);
  const [editLotId, setEditLotId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="rounded-xl border bg-card">
          <button
            type="button"
            onClick={() => setAdding((s) => !s)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <span className="font-semibold">＋ เพิ่มวัตถุดิบ/บรรจุภัณฑ์</span>
            <span className="text-sm text-muted-foreground">{adding ? "ซ่อน" : "เปิด"}</span>
          </button>
          {adding && (
            <div className="border-t p-5">
              <MaterialForm onDone={() => setAdding(false)} />
            </div>
          )}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        วัตถุดิบทั้งหมด {materials.length} รายการ
      </p>

      {materials.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          ยังไม่มีวัตถุดิบในระบบ
          {canManage ? " — กด “＋ เพิ่มวัตถุดิบ/บรรจุภัณฑ์” ด้านบน" : ""}
        </p>
      ) : (
        <div className="space-y-3">
          {materials.map((m) => {
            const usable = m.lots
              .filter((l) => USABLE_LOT_STATUSES.has(l.status as MaterialLotStatus))
              .reduce((s, l) => s + Number(l.qty_on_hand), 0);
            return (
              <div key={m.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.code}</span>
                      <span className="truncate text-sm text-muted-foreground">{m.name}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                        {MATERIAL_TYPE_LABEL[m.type] ?? m.type}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      พร้อมใช้รวม {usable.toLocaleString("th-TH")} {m.unit} · {m.lots.length} ล็อต
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditMatId((id) => (id === m.id ? null : m.id));
                          setAddLotFor(null);
                        }}
                        className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                      >
                        {editMatId === m.id ? "ปิด" : "แก้ข้อมูล"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddLotFor((id) => (id === m.id ? null : m.id));
                          setEditMatId(null);
                          setEditLotId(null);
                        }}
                        className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                      >
                        {addLotFor === m.id ? "ปิด" : "＋ เพิ่มล็อต"}
                      </button>
                    </div>
                  )}
                </div>

                {canManage && editMatId === m.id && (
                  <div className="mt-3 border-t pt-3">
                    <MaterialForm
                      initial={{
                        id: m.id,
                        code: m.code,
                        name: m.name,
                        type: m.type,
                        unit: m.unit,
                      }}
                      onDone={() => setEditMatId(null)}
                    />
                  </div>
                )}

                {canManage && addLotFor === m.id && (
                  <div className="mt-3 border-t pt-3">
                    <LotForm
                      materialId={m.id}
                      unit={m.unit}
                      onDone={() => setAddLotFor(null)}
                    />
                  </div>
                )}

                {/* ตารางล็อต */}
                {m.lots.length > 0 && (
                  <div className="-mx-2 mt-3 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-2 py-1.5 font-medium">ล็อต</th>
                          <th className="px-2 py-1.5 text-right font-medium">คงเหลือ</th>
                          <th className="px-2 py-1.5 font-medium">สถานะ</th>
                          <th className="px-2 py-1.5 font-medium">วันหมดอายุ</th>
                          {canManage && <th className="px-2 py-1.5" />}
                        </tr>
                      </thead>
                      <tbody>
                        {m.lots.map((lot) => (
                          <LotRow
                            key={lot.id}
                            lot={lot}
                            unit={m.unit}
                            materialId={m.id}
                            canManage={canManage}
                            editing={editLotId === lot.id}
                            onToggle={() =>
                              setEditLotId((id) => (id === lot.id ? null : lot.id))
                            }
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LotRow({
  lot,
  unit,
  materialId,
  canManage,
  editing,
  onToggle,
}: {
  lot: MaterialLot;
  unit: string;
  materialId: string;
  canManage: boolean;
  editing: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b last:border-0 align-top">
        <td className="px-2 py-2 font-medium">{lot.lot_no}</td>
        <td className="px-2 py-2 text-right tabular-nums">
          {Number(lot.qty_on_hand).toLocaleString("th-TH")} {unit}
        </td>
        <td className="px-2 py-2">
          <LotStatusBadge status={lot.status} />
        </td>
        <td className="whitespace-nowrap px-2 py-2">
          <div className="flex flex-col gap-1">
            <span>{lot.expiry_date ?? "—"}</span>
            <ExpiryBadge date={lot.expiry_date} />
          </div>
        </td>
        {canManage && (
          <td className="px-2 py-2 text-right">
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              {editing ? "ปิด" : "แก้"}
            </button>
          </td>
        )}
      </tr>
      {canManage && editing && (
        <tr>
          <td colSpan={5} className="px-2 pb-3">
            <div className="rounded-md border bg-muted/30 p-3">
              <LotForm
                materialId={materialId}
                unit={unit}
                initial={{
                  id: lot.id,
                  material_id: materialId,
                  lot_no: lot.lot_no,
                  qty: String(lot.qty_on_hand),
                  status: lot.status,
                  received_date: lot.received_date ?? "",
                  expiry_date: lot.expiry_date ?? "",
                  note: lot.note ?? "",
                }}
                onDone={onToggle}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

type MaterialFormValues = {
  id: string | null;
  code: string;
  name: string;
  type: string;
  unit: string;
};

function MaterialForm({
  initial,
  onDone,
}: {
  initial?: MaterialFormValues;
  onDone: () => void;
}) {
  const [v, setV] = useState<MaterialFormValues>(
    initial ?? { id: null, code: "", name: "", type: "rm", unit: "kg" },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    start(async () => {
      const res = await upsertMaterial(v);
      if (res.ok) {
        router.refresh();
        onDone();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>รหัส (code) *</label>
          <input
            value={v.code}
            onChange={(e) => setV((c) => ({ ...c, code: e.target.value }))}
            placeholder="เช่น RM-001"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ชื่อ *</label>
          <input
            value={v.name}
            onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))}
            placeholder="เช่น แป้งข้าวโพด"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ประเภท</label>
          <select
            value={v.type}
            onChange={(e) => setV((c) => ({ ...c, type: e.target.value }))}
            className={inputClass}
          >
            {MATERIAL_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>หน่วย</label>
          <input
            value={v.unit}
            onChange={(e) => setV((c) => ({ ...c, unit: e.target.value }))}
            placeholder="kg / ชิ้น / ม้วน"
            className={inputClass}
          />
        </div>
      </div>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : v.id ? "บันทึกการแก้ไข" : "เพิ่มวัตถุดิบ"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

type LotFormValues = {
  id: string | null;
  material_id: string;
  lot_no: string;
  qty: string;
  status: string;
  received_date: string;
  expiry_date: string;
  note: string;
};

function LotForm({
  materialId,
  unit,
  initial,
  onDone,
}: {
  materialId: string;
  unit: string;
  initial?: LotFormValues;
  onDone: () => void;
}) {
  const [v, setV] = useState<LotFormValues>(
    initial ?? {
      id: null,
      material_id: materialId,
      lot_no: "",
      qty: "",
      status: "quarantine",
      received_date: "",
      expiry_date: "",
      note: "",
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function set<K extends keyof LotFormValues>(k: K, val: string) {
    setV((c) => ({ ...c, [k]: val }));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await upsertMaterialLot({ ...v, material_id: materialId });
      if (res.ok) {
        router.refresh();
        onDone();
        return;
      }
      setError(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>เลขล็อต (lot) *</label>
          <input
            value={v.lot_no}
            onChange={(e) => set("lot_no", e.target.value)}
            placeholder="เช่น L2569-001"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>คงเหลือ ({unit}) *</label>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={v.qty}
            onChange={(e) => set("qty", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>สถานะ QC</label>
          <select
            value={v.status}
            onChange={(e) => set("status", e.target.value)}
            className={inputClass}
          >
            {MATERIAL_LOT_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>วันรับเข้า</label>
          <input
            type="date"
            value={v.received_date}
            onChange={(e) => set("received_date", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>วันหมดอายุ</label>
          <input
            type="date"
            value={v.expiry_date}
            onChange={(e) => set("expiry_date", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>หมายเหตุ</label>
          <input
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : v.id ? "บันทึกการแก้ไข" : "เพิ่มล็อต"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
