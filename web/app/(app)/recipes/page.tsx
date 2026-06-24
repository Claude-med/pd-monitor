import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { listProductsWithRecipes, getMaterialOptions } from "@/lib/data/recipes";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { RecipesView } from "./recipes-view";

export const metadata = { title: "สูตรการผลิต / BOM — PD Monitor" };

export default async function RecipesPage() {
  const profile = await getProfile();
  const canManage = hasAnyRole(profile?.roles ?? [], ["manager"]);
  const [products, materials] = await Promise.all([
    listProductsWithRecipes(),
    getMaterialOptions(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["product_recipes", "recipe_items"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สูตรการผลิต / BOM</h1>
        <p className="text-sm text-muted-foreground">
          สูตรของยาแต่ละตัว · ขนาดแบตช์ · รายการวัตถุดิบ/บรรจุภัณฑ์ที่ใช้ (Bill of Materials)
          {canManage ? "" : " (ดูอย่างเดียว — จัดการได้เฉพาะผู้บริหาร)"}
        </p>
      </div>

      {materials.length === 0 && canManage && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
          <span className="font-semibold text-amber-900 dark:text-amber-300">
            ยังไม่มีวัตถุดิบในระบบ
          </span>{" "}
          — ไปเพิ่มที่หน้า “วัตถุดิบ / คลัง” ก่อน แล้วค่อยนำมาใส่ในสูตร
        </div>
      )}

      <RecipesView
        products={products}
        materials={materials}
        canManage={canManage}
      />
    </div>
  );
}
