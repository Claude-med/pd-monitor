"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ProductWithRecipes,
  Recipe,
  MaterialOption,
} from "@/lib/data/recipes";
import type { Station } from "@/lib/data/stations";
import { STATIONS, STATION_LABEL } from "@/lib/data/station-constants";
import { PACK_TYPES } from "@/lib/data/packaging-constants";
import {
  upsertRecipe,
  setRecipeItems,
  updatePackaging,
  upsertStation,
  setProductRoute,
} from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function RecipesView({
  products,
  materials,
  stations,
  canManage,
}: {
  products: ProductWithRecipes[];
  materials: MaterialOption[];
  stations: Station[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-4">
      {canManage && <StationMasterPanel stations={stations} />}

      <p className="text-sm text-muted-foreground">
        ยา/ผลิตภัณฑ์ {products.length} รายการ
      </p>

      {products.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          ยังไม่มียา/ผลิตภัณฑ์ในระบบ — สร้างได้ตอน “＋ สร้างงานใหม่” บนบอร์ดงาน
        </p>
      ) : (
        <div className="space-y-3">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              materials={materials}
              stations={stations}
              canManage={canManage}
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

  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold">
          ⚙️ ตั้งค่าสถานีการผลิต (master) · {stations.length} สถานี
        </span>
        <span className="text-sm text-muted-foreground">{open ? "ซ่อน" : "เปิด"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t p-5">
          <p className="text-xs text-muted-foreground">
            สถานีย่อยจริงในกระบวนการ · แต่ละสถานีจัดเข้า 1 ใน 4 กลุ่มหลัก (เตรียม/ผสม/ตอก/บรรจุ)
            เพื่อให้แดชบอร์ดสรุปได้เหมือนเดิม
          </p>

          {addOpen ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <StationForm
                onDone={() => setAddOpen(false)}
                nextSeq={(stations.at(-1)?.seq ?? 0) + 1}
              />
            </div>
          ) : (
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

          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
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
                {stations.map((s) => (
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
        <td className="px-2 py-2 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            {editing ? "ปิด" : "แก้"}
          </button>
        </td>
      </tr>
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
            placeholder="เช่น ST-MILL"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>ชื่อสถานี *</label>
          <input
            value={v.name}
            onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))}
            placeholder="เช่น บด"
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
  materials,
  stations,
  canManage,
}: {
  product: ProductWithRecipes;
  materials: MaterialOption[];
  stations: Station[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);
  const [editPack, setEditPack] = useState(false);

  const packLabel = [product.pack_type, product.pack_pattern]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{product.code}</span>
            <span className="truncate text-sm text-muted-foreground">
              {product.name}
            </span>
            {product.dosage_form && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                {product.dosage_form}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {product.recipes.length} สูตร
            {packLabel ? (
              <> · บรรจุ: {packLabel}</>
            ) : (
              <> · ยังไม่ระบุรูปแบบบรรจุ</>
            )}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setEditPack((s) => !s);
                setAdding(false);
                setEditHeaderId(null);
              }}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              {editPack ? "ปิด" : "แก้บรรจุ"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding((s) => !s);
                setEditPack(false);
                setEditHeaderId(null);
              }}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              {adding ? "ปิด" : "＋ เพิ่มสูตร"}
            </button>
          </div>
        )}
      </div>

      {canManage && editPack && (
        <div className="mt-3 border-t pt-3">
          <PackagingForm product={product} onDone={() => setEditPack(false)} />
        </div>
      )}

      {canManage && adding && (
        <div className="mt-3 border-t pt-3">
          <RecipeHeaderForm
            productId={product.id}
            onDone={() => setAdding(false)}
          />
        </div>
      )}

      {product.recipes.length > 0 && (
        <div className="mt-3 space-y-3 border-t pt-3">
          {product.recipes.map((r) => (
            <RecipeBlock
              key={r.id}
              recipe={r}
              productId={product.id}
              materials={materials}
              canManage={canManage}
              editingHeader={editHeaderId === r.id}
              onToggleHeader={() =>
                setEditHeaderId((id) => (id === r.id ? null : r.id))
              }
            />
          ))}
        </div>
      )}

      <RouteSection
        product={product}
        stations={stations}
        canManage={canManage}
      />
    </div>
  );
}

const GROUP_COLOR: Record<string, string> = Object.fromEntries(
  STATIONS.map((s) => [s.key, s.color]),
);

/** ส่วน "ขั้นตอนการผลิต (Route)" ของยาแต่ละตัว */
function RouteSection({
  product,
  stations,
  canManage,
}: {
  product: ProductWithRecipes;
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
  product: ProductWithRecipes;
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

function PackagingForm({
  product,
  onDone,
}: {
  product: ProductWithRecipes;
  onDone: () => void;
}) {
  const [packType, setPackType] = useState(product.pack_type ?? "");
  const [packPattern, setPackPattern] = useState(product.pack_pattern ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    start(async () => {
      const res = await updatePackaging({
        product_id: product.id,
        pack_type: packType,
        pack_pattern: packPattern,
      });
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
          <label className={labelClass}>รูปแบบบรรจุ</label>
          <select
            value={packType}
            onChange={(e) => setPackType(e.target.value)}
            className={inputClass}
          >
            <option value="">— ไม่ระบุ —</option>
            {PACK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>รายละเอียดแผง/บรรจุ</label>
          <input
            value={packPattern}
            onChange={(e) => setPackPattern(e.target.value)}
            placeholder="เช่น แผง 50×10's (50 แผง × 10 เม็ด)"
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
          {pending ? "กำลังบันทึก…" : "บันทึกรูปแบบบรรจุ"}
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

function RecipeBlock({
  recipe,
  productId,
  materials,
  canManage,
  editingHeader,
  onToggleHeader,
}: {
  recipe: Recipe;
  productId: string;
  materials: MaterialOption[];
  canManage: boolean;
  editingHeader: boolean;
  onToggleHeader: () => void;
}) {
  const [editingBom, setEditingBom] = useState(false);

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{recipe.name}</span>
          {!recipe.is_active && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              เลิกใช้
            </span>
          )}
          {recipe.batch_size !== null && (
            <span className="text-xs text-muted-foreground">
              แบตช์ {recipe.batch_size.toLocaleString("th-TH")} {recipe.batch_unit}
            </span>
          )}
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onToggleHeader}
              className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
            >
              {editingHeader ? "ปิด" : "แก้หัวสูตร"}
            </button>
            <button
              type="button"
              onClick={() => setEditingBom((s) => !s)}
              className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
            >
              {editingBom ? "ปิด" : "แก้รายการวัตถุดิบ"}
            </button>
          </div>
        )}
      </div>

      {recipe.note && (
        <p className="mt-1 text-xs text-muted-foreground">{recipe.note}</p>
      )}

      {canManage && editingHeader && (
        <div className="mt-3 border-t pt-3">
          <RecipeHeaderForm
            productId={productId}
            initial={recipe}
            onDone={onToggleHeader}
          />
        </div>
      )}

      {/* รายการวัตถุดิบ (BOM) */}
      {editingBom && canManage ? (
        <div className="mt-3 border-t pt-3">
          <BomEditor
            recipe={recipe}
            materials={materials}
            onDone={() => setEditingBom(false)}
          />
        </div>
      ) : recipe.items.length > 0 ? (
        <div className="-mx-1 mt-3 overflow-x-auto">
          <table className="w-full min-w-[460px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">วัตถุดิบ</th>
                <th className="px-2 py-1.5 text-right font-medium">จำนวน/แบตช์</th>
                <th className="px-2 py-1.5 font-medium">หน่วย</th>
                <th className="px-2 py-1.5 font-medium">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {recipe.items.map((it) => (
                <tr key={it.id} className="border-b last:border-0">
                  <td className="px-2 py-2">
                    <span className="font-medium">{it.material_code}</span>{" "}
                    <span className="text-muted-foreground">{it.material_name}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {it.qty.toLocaleString("th-TH")}
                  </td>
                  <td className="px-2 py-2">{it.unit ?? "—"}</td>
                  <td className="px-2 py-2 text-muted-foreground">{it.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          ยังไม่มีรายการวัตถุดิบในสูตรนี้
          {canManage ? " — กด “แก้รายการวัตถุดิบ”" : ""}
        </p>
      )}
    </div>
  );
}

type HeaderValues = {
  id: string | null;
  name: string;
  batch_size: string;
  batch_unit: string;
  is_active: boolean;
  note: string;
};

function RecipeHeaderForm({
  productId,
  initial,
  onDone,
}: {
  productId: string;
  initial?: Recipe;
  onDone: () => void;
}) {
  const [v, setV] = useState<HeaderValues>(
    initial
      ? {
          id: initial.id,
          name: initial.name,
          batch_size: initial.batch_size === null ? "" : String(initial.batch_size),
          batch_unit: initial.batch_unit,
          is_active: initial.is_active,
          note: initial.note ?? "",
        }
      : {
          id: null,
          name: "สูตรมาตรฐาน",
          batch_size: "",
          batch_unit: "เม็ด",
          is_active: true,
          note: "",
        },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    start(async () => {
      const res = await upsertRecipe({ ...v, product_id: productId });
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
          <label className={labelClass}>ชื่อ/เวอร์ชันสูตร</label>
          <input
            value={v.name}
            onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))}
            placeholder="เช่น สูตรมาตรฐาน v1"
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>ขนาดแบตช์</label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={v.batch_size}
              onChange={(e) => setV((c) => ({ ...c, batch_size: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>หน่วย</label>
            <input
              value={v.batch_unit}
              onChange={(e) => setV((c) => ({ ...c, batch_unit: e.target.value }))}
              placeholder="เม็ด / kg"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>หมายเหตุ</label>
          <input
            value={v.note}
            onChange={(e) => setV((c) => ({ ...c, note: e.target.value }))}
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
          ใช้สูตรนี้อยู่ (active)
        </label>
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
          {pending ? "กำลังบันทึก…" : v.id ? "บันทึกการแก้ไข" : "เพิ่มสูตร"}
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

type BomRow = {
  key: string;
  material_id: string;
  qty: string;
  unit: string;
  note: string;
};

let rowSeq = 0;
const newRow = (): BomRow => ({
  key: `r${rowSeq++}`,
  material_id: "",
  qty: "",
  unit: "",
  note: "",
});

function BomEditor({
  recipe,
  materials,
  onDone,
}: {
  recipe: Recipe;
  materials: MaterialOption[];
  onDone: () => void;
}) {
  const [rows, setRows] = useState<BomRow[]>(
    recipe.items.length > 0
      ? recipe.items.map((it) => ({
          key: `e${it.id}`,
          material_id: it.material_id,
          qty: String(it.qty),
          unit: it.unit ?? "",
          note: it.note ?? "",
        }))
      : [newRow()],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function setRow(key: string, patch: Partial<BomRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await setRecipeItems(
        recipe.id,
        rows.map((r) => ({
          material_id: r.material_id,
          qty: r.qty,
          unit: r.unit,
          note: r.note,
        })),
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
        {rows.map((r) => (
          <div
            key={r.key}
            className="grid grid-cols-1 gap-2 rounded-md border bg-background p-2 sm:grid-cols-[1fr_90px_80px_1fr_auto] sm:items-end"
          >
            <div>
              <label className={labelClass}>วัตถุดิบ</label>
              <select
                value={r.material_id}
                onChange={(e) => {
                  const m = materials.find((x) => x.id === e.target.value);
                  setRow(r.key, {
                    material_id: e.target.value,
                    unit: r.unit || m?.unit || "",
                  });
                }}
                className={inputClass}
              >
                <option value="">— เลือกวัตถุดิบ —</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>จำนวน</label>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={r.qty}
                onChange={(e) => setRow(r.key, { qty: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>หน่วย</label>
              <input
                value={r.unit}
                onChange={(e) => setRow(r.key, { unit: e.target.value })}
                className={inputClass}
              />
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
              title="ลบรายการนี้"
            >
              ลบ
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, newRow()])}
        className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
      >
        ＋ เพิ่มวัตถุดิบ
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
          {pending ? "กำลังบันทึก…" : "บันทึกรายการวัตถุดิบ"}
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
        * บันทึกแล้วจะแทนที่รายการวัตถุดิบเดิมทั้งหมดของสูตรนี้ (แถวที่ไม่ได้เลือกวัตถุดิบจะถูกข้าม)
      </p>
    </div>
  );
}
