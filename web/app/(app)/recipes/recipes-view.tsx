"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ProductWithRecipes,
  Recipe,
  MaterialOption,
} from "@/lib/data/recipes";
import { upsertRecipe, setRecipeItems } from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

export function RecipesView({
  products,
  materials,
  canManage,
}: {
  products: ProductWithRecipes[];
  materials: MaterialOption[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-4">
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
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  materials,
  canManage,
}: {
  product: ProductWithRecipes;
  materials: MaterialOption[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editHeaderId, setEditHeaderId] = useState<string | null>(null);

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
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setAdding((s) => !s);
              setEditHeaderId(null);
            }}
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
          >
            {adding ? "ปิด" : "＋ เพิ่มสูตร"}
          </button>
        )}
      </div>

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
