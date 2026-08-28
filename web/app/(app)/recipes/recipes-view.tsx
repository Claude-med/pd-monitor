"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductWithRoute } from "@/lib/data/recipes";
import type { Station } from "@/lib/data/stations";
import { PRODUCT_UNITS } from "@/lib/data/product-constants";
import {
  upsertProduct,
  setProductActive,
  deleteProduct,
  previewDeleteProduct,
  forceDeleteProduct,
  upsertStation,
  setStationActive,
  deleteStation,
  setProductRoute,
} from "./actions";
import type { DeleteImpact, DeletePreview } from "./actions";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

let rowSeq = 1;

export function RecipesView({
  products,
  stations,
  canManageProducts,
  canManageStations,
  canForceDelete,
}: {
  products: ProductWithRoute[];
  stations: Station[];
  canManageProducts: boolean;
  canManageStations: boolean;
  canForceDelete: boolean;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  const inactiveCount = products.filter((p) => !p.is_active).length;
  // ติ๊ก "แสดงที่ปิดใช้งานแล้ว" → ดันตัวที่ปิดใช้งานขึ้นบนสุด (จะได้จัดการทีเดียวจบ)
  // sort ของ JS เป็น stable → ลำดับ code เดิมภายในแต่ละกลุ่มยังอยู่
  const visible = showInactive
    ? products.slice().sort((a, b) => Number(a.is_active) - Number(b.is_active))
    : products.filter((p) => p.is_active);

  return (
    <div className="space-y-4">
      {canManageStations && <StationMasterPanel stations={stations} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          ผลิตภัณฑ์ {visible.length} รายการ
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {/* แสดงเสมอ — ของเดิมซ่อนตอนไม่มีตัวปิดใช้งาน ทำให้ผู้ใช้ไม่รู้ว่ามีตัวกรองนี้อยู่ */}
          <label
            className={`flex items-center gap-1.5 text-xs ${
              inactiveCount > 0 ? "text-muted-foreground" : "text-muted-foreground/50"
            }`}
          >
            <input
              type="checkbox"
              checked={showInactive}
              disabled={inactiveCount === 0}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4"
            />
            แสดงที่ปิดใช้งานแล้ว ({inactiveCount})
          </label>
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
              canForceDelete={canForceDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}


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
            สถานีจริงในกระบวนการผลิต · ใช้ชื่อสถานีอ้างอิงทุกที่ในระบบ
            (บันทึกผลผลิต · ตรวจ QC · เครื่องจักร · แดชบอร์ด)
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
                nextSeq={stations.reduce((max, s) => Math.max(max, s.seq), 0) + 1}
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
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  /** ปุ่ม "ลบ" = ลบจริงถ้ายังไม่มีประวัติผูก · ติดแล้ว RPC ปิดใช้งานให้แทน (0044) */
  function remove() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await deleteStation(station.id);
      if (res.ok) {
        // ลบจริง = แถวหายไปเลย ไม่ต้องขึ้นข้อความค้าง · ปิดใช้งานแทน = ต้องบอกเหตุผล
        if (res.action === "deactivated") setNotice(res.message ?? null);
        router.refresh();
        return;
      }
      setError(res.error ?? "ลบสถานีไม่สำเร็จ");
    });
  }

  /** ปุ่ม "กู้คืน" = เปิดใช้งานสถานีที่เคยปิดไป */
  function restore() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await setStationActive(station.id, true);
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(res.error ?? "กู้คืนไม่สำเร็จ");
    });
  }

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="px-2 py-2 tabular-nums text-muted-foreground">{station.seq}</td>
        <td className="px-2 py-2 font-medium">{station.code}</td>
        <td className="px-2 py-2">{station.name}</td>
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
              onClick={station.is_active ? remove : restore}
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
      {notice && (
        <tr>
          <td colSpan={6} className="px-2 pb-2">
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              ⚠️ {notice}
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
    seq: string;
    is_active: boolean;
  }>({
    id: station?.id ?? null,
    code: station?.code ?? "",
    name: station?.name ?? "",
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
  canForceDelete,
}: {
  product: ProductWithRoute;
  stations: Station[];
  canManageProducts: boolean;
  canManageStations: boolean;
  canForceDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // แผงถามยืนยันก่อนลบ (เดิมกดปุ๊บทำงานทันที ไม่มีทางถอย)
  const [confirming, setConfirming] = useState(false);
  // แผง "ลบถาวร": null = ปิด · object = เปิดพร้อมผลแจกแจงจาก DB
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  function closePanels() {
    setConfirming(false);
    setPreview(null);
    setPassword("");
    setError(null);
  }

  /** ปุ่ม "ลบ" = ลบจริงถ้ายังไม่มีใครใช้ · ติดแล้ว RPC ปิดใช้งานให้แทน (0044) */
  function remove() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await deleteProduct(product.id);
      if (res.ok) {
        // ลบจริง = การ์ดหายไปเลย · ปิดใช้งานแทน = ต้องบอกว่าติดอะไรอยู่
        if (res.action === "deactivated") setNotice(res.message ?? null);
        setConfirming(false);
        router.refresh();
        return;
      }
      setError(res.error ?? "ลบผลิตภัณฑ์ไม่สำเร็จ");
    });
  }

  /** ปุ่ม "ลบถาวร" ขั้นที่ 1 — ถาม DB ก่อนว่าติดอะไร / อะไรจะหายตาม (0050) */
  function openForceDelete() {
    setError(null);
    setNotice(null);
    setPassword("");
    start(async () => {
      const res = await previewDeleteProduct(product.id);
      if (res.error) return setError(res.error);
      setPreview(res);
    });
  }

  /** ปุ่ม "ลบถาวร" ขั้นที่ 2 — ยืนยันรหัสผ่านแล้วลบจริง */
  function confirmForceDelete() {
    setError(null);
    start(async () => {
      const res = await forceDeleteProduct(product.id, password);
      if (res.ok) {
        closePanels();
        router.refresh();
        return;
      }
      setError(res.error ?? "ลบถาวรไม่สำเร็จ");
    });
  }

  /** ปุ่ม "กู้คืน" = เปิดใช้งานผลิตภัณฑ์ที่เคยปิดไป */
  function restore() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await setProductActive(product.id, true);
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(res.error ?? "กู้คืนไม่สำเร็จ");
    });
  }

  return (
    <div
      className={
        product.is_active
          ? "rounded-xl border bg-card p-4"
          : "rounded-xl border-2 border-amber-400 bg-amber-50/40 p-4 dark:bg-amber-950/20"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
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
          {product.appearance && (
            <p className="mt-0.5 break-words text-xs text-muted-foreground">
              ลักษณะยา: {product.appearance}
            </p>
          )}
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
              onClick={
                product.is_active ? () => setConfirming((c) => !c) : restore
              }
              className={`rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50 ${
                product.is_active ? "text-destructive" : ""
              }`}
            >
              {pending ? "…" : product.is_active ? "ลบ" : "กู้คืน"}
            </button>
            {/* ลบถาวร — เฉพาะตัวที่ปิดใช้งานแล้ว + ผู้บริหาร (0050) */}
            {!product.is_active && canForceDelete && (
              <button
                type="button"
                disabled={pending}
                onClick={preview ? closePanels : openForceDelete}
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                {pending && !preview ? "กำลังตรวจ…" : preview ? "ปิด" : "🗑️ ลบถาวร"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ถามยืนยันก่อนลบ (ปุ่ม "ลบ" ปกติ) */}
      {confirming && (
        <div className="mt-3 space-y-2 rounded-md border border-red-300 bg-red-50/60 p-3 dark:bg-red-950/20">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            ลบผลิตภัณฑ์ {product.code} ?
          </p>
          <p className="text-xs text-red-700 dark:text-red-400">
            ถ้ายังไม่มีใครใช้ = ลบออกจากระบบเลย · ถ้ามีงาน/ล็อตผูกอยู่ =
            ระบบจะเปลี่ยนเป็นปิดใช้งานให้แทน แล้วบอกว่าติดอะไร
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "กำลังลบ…" : "ยืนยันลบ"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={closePanels}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* ลบถาวร — แจกแจงผลกระทบ แล้วยืนยันด้วยรหัสผ่าน */}
      {preview && (
        <ForceDeletePanel
          preview={preview}
          code={product.code}
          password={password}
          setPassword={setPassword}
          pending={pending}
          onConfirm={confirmForceDelete}
          onCancel={closePanels}
        />
      )}

      {error && (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          ⚠️ {notice}
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

/** ลิสต์ผลกระทบ 1 กลุ่ม — ใช้ทั้งฝั่ง "ลบไม่ได้เพราะ" และ "จะหายตามไปด้วย" */
function ImpactList({ items }: { items: DeleteImpact[] }) {
  return (
    <ul className="ml-4 list-disc space-y-0.5">
      {items.map((it) => (
        <li key={it.label}>
          {it.label} <strong>{it.count.toLocaleString("th-TH")}</strong> {it.unit}
        </li>
      ))}
    </ul>
  );
}

/**
 * แผง "ลบถาวร" (0050) — แจกแจงก่อนเสมอ แล้วค่อยให้ยืนยันด้วยรหัสผ่าน
 * ลบไม่ได้ = แสดงเหตุผลอย่างเดียว ไม่มีช่องรหัสผ่านให้กรอก
 */
function ForceDeletePanel({
  preview,
  code,
  password,
  setPassword,
  pending,
  onConfirm,
  onCancel,
}: {
  preview: DeletePreview;
  code: string;
  password: string;
  setPassword: (v: string) => void;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const blockers = preview.blockers ?? [];
  const cascades = preview.cascades ?? [];
  const canDelete = !!preview.can_delete;

  return (
    <div className="mt-3 space-y-3 rounded-md border-2 border-red-400 bg-red-50/60 p-3 dark:bg-red-950/20">
      <p className="text-sm font-medium text-red-800 dark:text-red-300">
        🗑️ ลบผลิตภัณฑ์ {code} ออกจากระบบถาวร
      </p>

      {blockers.length > 0 && (
        <div className="rounded-md bg-background/60 p-2 text-xs text-red-700 dark:text-red-400">
          <p className="font-medium">ลบถาวรไม่ได้ เพราะยังมี:</p>
          <ImpactList items={blockers} />
          <p className="mt-1.5">
            ข้อมูลการผลิตต้องเก็บไว้ตามหลัก GMP — ผลิตภัณฑ์นี้ปิดใช้งานไว้ได้
            แต่ลบทิ้งไม่ได้
          </p>
        </div>
      )}

      {cascades.length > 0 && (
        <div className="rounded-md bg-background/60 p-2 text-xs text-amber-800 dark:text-amber-300">
          <p className="font-medium">
            ⚠️ สิ่งที่จะถูกลบตามไปด้วย{canDelete ? "" : " (ถ้าลบได้)"}:
          </p>
          <ImpactList items={cascades} />
        </div>
      )}

      {canDelete && cascades.length === 0 && (
        <p className="text-xs text-muted-foreground">
          ผลิตภัณฑ์นี้ไม่มีข้อมูลอื่นผูกอยู่เลย — ลบได้ทันที
        </p>
      )}

      {canDelete && (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              ยืนยันรหัสผ่านเพื่อลบถาวร (จำเป็น)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="รหัสผ่านบัญชีของคุณ"
              className={inputClass}
            />
          </div>
          <p className="text-xs text-red-700 dark:text-red-400">
            การลบถาวรย้อนกลับไม่ได้ (ยังมีร่องรอยในหน้า &ldquo;ประวัติ /
            Audit&rdquo; แต่กู้ข้อมูลคืนไม่ได้)
          </p>
        </>
      )}

      <div className="flex gap-2">
        {canDelete && (
          <button
            type="button"
            disabled={pending || !password.trim()}
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "กำลังลบ…" : "ยืนยันลบถาวร"}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
        >
          {canDelete ? "ยกเลิก" : "ปิด"}
        </button>
      </div>
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
    unit: product?.unit ?? "TAB",
    reg_no: product?.reg_no ?? "",
    dosage_form: product?.dosage_form ?? "",
    appearance: product?.appearance ?? "",
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
        {/* ลักษณะยา = ช่อง "รูปร่างลักษณะยา" บนใบแจ้งผลิต F.PLN.01 — ข้อความยาว จึงกินเต็มแถว */}
        <div className="sm:col-span-2">
          <label className={labelClass}>ลักษณะยา</label>
          <textarea
            value={v.appearance}
            onChange={(e) => setV((c) => ({ ...c, appearance: e.target.value }))}
            rows={2}
            placeholder="เช่น ยาเม็ดรูปกลมนูน เคลือบน้ำตาลสีขาว เรียบทั้งสองด้าน"
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
              <span className="rounded bg-slate-600 px-2 py-1 text-xs font-medium text-white">
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
                    {s.name}
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
