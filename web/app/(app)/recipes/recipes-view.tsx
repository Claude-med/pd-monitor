"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductWithRoute } from "@/lib/data/recipes";
import type { Station } from "@/lib/data/stations";
import { STATIONS, STATION_LABEL } from "@/lib/data/station-constants";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_SHORT,
  PRODUCT_TYPE_COLOR,
  PRODUCT_UNITS,
} from "@/lib/data/product-constants";
import {
  upsertProduct,
  setProductActive,
  upsertStation,
  setStationActive,
  setProductRoute,
} from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

let rowSeq = 1;

export function RecipesView({
  products,
  stations,
  canManageProducts,
  canManageStations,
}: {
  products: ProductWithRoute[];
  stations: Station[];
  canManageProducts: boolean;
  canManageStations: boolean;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  const inactiveCount = products.filter((p) => !p.is_active).length;
  const visible = showInactive ? products : products.filter((p) => p.is_active);

  return (
    <div className="space-y-4">
      {canManageStations && <StationMasterPanel stations={stations} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          ผลิตภัณฑ์ {visible.length} รายการ
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {inactiveCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="h-4 w-4"
              />
              แสดงที่ปิดใช้งานแล้ว ({inactiveCount})
            </label>
          )}
          {canManageProducts && (
            <button
              type="button"
              onClick={() => setAdding((s) => !s)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              {adding ? "ปิด" : "＋ เพิ่มผลิตภัณฑ์"}
            </button>
          )}
        </div>
      </div>

      {canManageProducts && adding && (
        <div className="rounded-xl border bg-card p-4">
          <ProductForm onDone={() => setAdding(false)} />
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          ยังไม่มีผลิตภัณฑ์ในระบบ
          {canManageProducts ? " — กด “＋ เพิ่มผลิตภัณฑ์” ด้านบน" : ""}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              stations={stations}
              canManageProducts={canManageProducts}
              canManageStations={canManageStations}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const STATION_GROUP_LABEL: Record<string, string> = STATION_LABEL;

/** แผงจัดการสถานีย่อย (master) — เห็นเฉพาะผู้บริหาร */
function StationMasterPanel({ stations }: { stations: Station[] }) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const inactiveCount = stations.filter((s) => !s.is_active).length;
  const visible = showInactive ? stations : stations.filter((s) => s.is_active);

  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold">
          ⚙️ ตั้งค่าสถานีการผลิต (master) · {visible.length} สถานี
        </span>
        <span className="text-sm text-muted-foreground">{open ? "ซ่อน" : "เปิด"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t p-5">
          <p className="text-xs text-muted-foreground">
            สถานีย่อยจริงในกระบวนการ · แต่ละสถานีจัดเข้า 1 ใน 4 กลุ่มหลัก (เตรียม/ผสม/ตอก/บรรจุ)
            เพื่อให้แดชบอร์ดสรุปได้เหมือนเดิม
          </p>

          <div className="flex flex-wrap items-center gap-3">
            {addOpen ? null : (
              <button
                type="button"
                onClick={() => {
                  setAddOpen(true);
                  setEditId(null);
                }}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
              >
                ＋ เพิ่มสถานี
              </button>
            )}
            {inactiveCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="h-4 w-4"
                />
                แสดงที่ปิดใช้งานแล้ว ({inactiveCount})
              </label>
            )}
          </div>

          {addOpen && (
            <div className="rounded-md border bg-muted/30 p-3">
              <StationForm
                onDone={() => setAddOpen(false)}
                nextSeq={(stations.at(-1)?.seq ?? 0) + 10}
              />
            </div>
          )}

          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">ลำดับ</th>
                  <th className="px-2 py-1.5 font-medium">รหัส</th>
                  <th className="px-2 py-1.5 font-medium">ชื่อสถานี</th>
                  <th className="px-2 py-1.5 font-medium">กลุ่มหลัก</th>
                  <th className="px-2 py-1.5 font-medium">ใช้งาน</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <StationRow
                    key={s.id}
                    station={s}
                    editing={editId === s.id}
                    onToggle={() => setEditId((id) => (id === s.id ? null : s.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            * ปุ่ม “ลบ” = ปิดใช้งาน — สถานีที่เคยใช้ผลิตจะยังอยู่ในประวัติงานเดิมเสมอ (GMP)
          </p>
        </div>
      )}
    </div>
  );
}

function StationRow({
  station,
  editing,
  onToggle,
}: {
  station: Station;
  editing: boolean;
  onToggle: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function toggleActive() {
    setError(null);
    start(async () => {
      const res = await setStationActive(station.id, !station.is_active);
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(res.error ?? "เปลี่ยนสถานะไม่สำเร็จ");
    });
  }

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="px-2 py-2 tabular-nums text-muted-foreground">{station.seq}</td>
        <td className="px-2 py-2 font-medium">{station.code}</td>
        <td className="px-2 py-2">{station.name}</td>
        <td className="px-2 py-2 text-muted-foreground">
          {STATION_GROUP_LABEL[station.station_group] ?? station.station_group}
        </td>
        <td className="px-2 py-2">
          {station.is_active ? (
            <span className="text-emerald-600 dark:text-emerald-400">ใช้งาน</span>
          ) : (
            <span className="text-muted-foreground">ปิด</span>
          )}
        </td>
        <td className="px-2 py-2">
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              {editing ? "ปิด" : "แก้"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={toggleActive}
              className={`rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50 ${
                station.is_active ? "text-destructive" : ""
              }`}
            >
              {pending ? "…" : station.is_active ? "ลบ" : "กู้คืน"}
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={6} className="px-2 pb-2">
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          </td>
        </tr>
      )}
      {editing && (
        <tr>
          <td colSpan={6} className="px-2 pb-3">
            <div className="rounded-md border bg-muted/30 p-3">
              <StationForm station={station} onDone={onToggle} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StationForm({
  station,
  nextSeq,
  onDone,
}: {
  station?: Station;
  nextSeq?: number;
  onDone: () => void;
}) {
  const [v, setV] = useState<{
    id: string | null;
    code: string;
    name: string;
    station_group: string;
    seq: string;
    is_active: boolean;
  }>({
    id: station?.id ?? null,
    code: station?.code ?? "",
    name: station?.name ?? "",
    station_group: station?.station_group ?? "mixing",
    seq: String(station?.seq ?? nextSeq ?? 100),
    is_active: station?.is_active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    start(async () => {
      const res = await upsertStation(v);
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
            placeholder="เช่น ST-BAND"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ชื่อสถานี *</label>
          <input
            value={v.name}
            onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))}
            placeholder="เช่น คาดแคปซูล"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>กลุ่มหลัก (rollup)</label>
          <select
            value={v.station_group}
            onChange={(e) => setV((c) => ({ ...c, station_group: e.target.value }))}
            className={inputClass}
          >
            {STATIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>ลำดับ</label>
            <input
              type="number"
              step="1"
              value={v.seq}
              onChange={(e) => setV((c) => ({ ...c, seq: e.target.value }))}
              className={inputClass}
            />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={v.is_active}
              onChange={(e) => setV((c) => ({ ...c, is_active: e.target.checked }))}
              className="h-4 w-4"
            />
            ใช้งาน
          </label>
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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : v.id ? "บันทึกการแก้ไข" : "เพิ่มสถานี"}
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

function ProductCard({
  product,
  stations,
  canManageProducts,
  canManageStations,
}: {
  product: ProductWithRoute;
  stations: Station[];
  canManageProducts: boolean;
  canManageStations: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function toggleActive() {
    setError(null);
    start(async () => {
      const res = await setProductActive(product.id, !product.is_active);
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(res.error ?? "เปลี่ยนสถานะไม่สำเร็จ");
    });
  }

  return (
    <div
      className={`rounded-xl border bg-card p-4 ${product.is_active ? "" : "opacity-60"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: PRODUCT_TYPE_COLOR[product.type] ?? "#64748b" }}
            >
              {PRODUCT_TYPE_SHORT[product.type] ?? product.type}
            </span>
            <span className="font-medium">{product.code}</span>
            <span className="truncate text-sm text-muted-foreground">
              {product.name}
            </span>
            {!product.is_active && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                ปิดใช้งาน
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            หน่วย: {product.unit || "—"}
            {product.dosage_form ? <> · ชนิด: {product.dosage_form}</> : null}
            {product.reg_no ? <> · REG NO. {product.reg_no}</> : null}
          </p>
        </div>
        {canManageProducts && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing((s) => !s)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              {editing ? "ปิด" : "แก้ไข"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={toggleActive}
              className={`rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50 ${
                product.is_active ? "text-destructive" : ""
              }`}
            >
              {pending ? "…" : product.is_active ? "ลบ" : "กู้คืน"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {canManageProducts && editing && (
        <div className="mt-3 border-t pt-3">
          <ProductForm product={product} onDone={() => setEditing(false)} />
        </div>
      )}

      <RouteSection
        product={product}
        stations={stations}
        canManage={canManageStations}
      />
    </div>
  );
}

function ProductForm({
  product,
  onDone,
}: {
  product?: ProductWithRoute;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    id: product?.id ?? null,
    code: product?.code ?? "",
    name: product?.name ?? "",
    type: product?.type ?? "fg",
    unit: product?.unit ?? "TAB",
    reg_no: product?.reg_no ?? "",
    dosage_form: product?.dosage_form ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // ข้อมูลเดิม (เช่นที่ย้ายมาจากวัตถุดิบ) อาจมีหน่วยนอกลิสต์มาตรฐาน — ต้องไม่ล้างทิ้งเงียบๆ
  const unitOptions = PRODUCT_UNITS.includes(
    v.unit as (typeof PRODUCT_UNITS)[number],
  )
    ? [...PRODUCT_UNITS]
    : [...PRODUCT_UNITS, v.unit].filter(Boolean);

  function submit() {
    setError(null);
    start(async () => {
      const res = await upsertProduct(v);
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
            placeholder="เช่น UM-FE005"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ชื่อผลิตภัณฑ์ *</label>
          <input
            value={v.name}
            onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))}
            placeholder="เช่น FEBRATE-200"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ประเภท *</label>
          <select
            value={v.type}
            onChange={(e) => setV((c) => ({ ...c, type: e.target.value }))}
            className={inputClass}
          >
            {PRODUCT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>หน่วย</label>
          <select
            value={v.unit}
            onChange={(e) => setV((c) => ({ ...c, unit: e.target.value }))}
            className={inputClass}
          >
            {unitOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>REG NO.</label>
          <input
            value={v.reg_no}
            onChange={(e) => setV((c) => ({ ...c, reg_no: e.target.value }))}
            placeholder="เช่น 1A 119/59"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ชนิด</label>
          <input
            value={v.dosage_form}
            onChange={(e) => setV((c) => ({ ...c, dosage_form: e.target.value }))}
            placeholder="เช่น TAB / CAP / F/C / CRM"
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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : v.id ? "บันทึกการแก้ไข" : "เพิ่มผลิตภัณฑ์"}
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

const GROUP_COLOR: Record<string, string> = Object.fromEntries(
  STATIONS.map((s) => [s.key, s.color]),
);

/** ส่วน "ขั้นตอนการผลิต (Route)" ของผลิตภัณฑ์แต่ละตัว */
function RouteSection({
  product,
  stations,
  canManage,
}: {
  product: ProductWithRoute;
  stations: Station[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">🛠️ ขั้นตอนการผลิต (Route)</span>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing((s) => !s)}
            className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
          >
            {editing ? "ปิด" : "แก้ขั้นตอน"}
          </button>
        )}
      </div>

      {editing && canManage ? (
        <div className="mt-3">
          <RouteEditor
            product={product}
            stations={stations}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : product.route.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {product.route.map((step, i) => (
            <span key={step.id} className="flex items-center gap-1.5">
              <span
                className="rounded px-2 py-1 text-xs font-medium text-white"
                style={{ backgroundColor: GROUP_COLOR[step.station_group] ?? "#64748b" }}
                title={STATION_GROUP_LABEL[step.station_group] ?? ""}
              >
                {i + 1}. {step.station_name}
              </span>
              {i < product.route.length - 1 && (
                <span className="text-muted-foreground">→</span>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          ยังไม่ได้กำหนดลำดับสถานี
          {canManage ? " — กด “แก้ขั้นตอน”" : ""}
        </p>
      )}
    </div>
  );
}

type RouteRow = { key: string; station_id: string; note: string };

function RouteEditor({
  product,
  stations,
  onDone,
}: {
  product: ProductWithRoute;
  stations: Station[];
  onDone: () => void;
}) {
  const activeStations = stations.filter((s) => s.is_active);
  const [rows, setRows] = useState<RouteRow[]>(
    product.route.length > 0
      ? product.route.map((st) => ({
          key: `e${st.id}`,
          station_id: st.station_id,
          note: st.note ?? "",
        }))
      : [{ key: `r${rowSeq++}`, station_id: "", note: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function setRow(key: string, patch: Partial<RouteRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function move(idx: number, dir: -1 | 1) {
    setRows((rs) => {
      const next = [...rs];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return rs;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await setProductRoute(
        product.id,
        rows.map((r) => ({ station_id: r.station_id, note: r.note })),
      );
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
      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div
            key={r.key}
            className="grid grid-cols-1 gap-2 rounded-md border bg-background p-2 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end"
          >
            <div className="flex gap-1 sm:flex-col">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-30"
                title="เลื่อนขึ้น"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === rows.length - 1}
                className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-30"
                title="เลื่อนลง"
              >
                ▼
              </button>
            </div>
            <div>
              <label className={labelClass}>สถานี (ลำดับ {idx + 1})</label>
              <select
                value={r.station_id}
                onChange={(e) => setRow(r.key, { station_id: e.target.value })}
                className={inputClass}
              >
                <option value="">— เลือกสถานี —</option>
                {activeStations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({STATION_GROUP_LABEL[s.station_group] ?? s.station_group})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>หมายเหตุ</label>
              <input
                value={r.note}
                onChange={(e) => setRow(r.key, { note: e.target.value })}
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(r.key)}
              className="rounded-md border px-2 py-2 text-xs text-destructive hover:bg-accent"
              title="ลบสถานีนี้"
            >
              ลบ
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          setRows((rs) => [...rs, { key: `r${rowSeq++}`, station_id: "", note: "" }])
        }
        className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
      >
        ＋ เพิ่มสถานี
      </button>

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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก…" : "บันทึกลำดับสถานี"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          ยกเลิก
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        * ลำดับบนลงล่าง = ลำดับการผลิต · บันทึกแล้วจะแทนที่ลำดับเดิมทั้งหมด (แถวที่ไม่เลือกสถานีจะถูกข้าม)
      </p>
    </div>
  );
}
