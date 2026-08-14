import { getProfile } from "@/lib/auth/dal";
import { hasAnyRole } from "@/lib/auth/roles";
import { canPlanJobs } from "@/lib/data/role-access";
import { listProductsWithRoutes } from "@/lib/data/recipes";
import { listStations } from "@/lib/data/stations";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { RecipesView } from "./recipes-view";

export const metadata = { title: "ผลิตภัณฑ์ / ขั้นตอนการผลิต — PD Monitor" };

export default async function RecipesPage() {
  const profile = await getProfile();
  const roles = profile?.roles ?? [];
  const canManageProducts = canPlanJobs(roles);
  const canManageStations = hasAnyRole(roles, ["manager"]);
  const [products, stations] = await Promise.all([
    listProductsWithRoutes(),
    listStations(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RealtimeRefresh tables={["products", "stations", "product_routes"]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          ผลิตภัณฑ์ / ขั้นตอนการผลิต
        </h1>
        <p className="text-sm text-muted-foreground">
          ทะเบียนผลิตภัณฑ์ (ยา · วัตถุดิบ · บรรจุภัณฑ์) · หน่วย/ชนิด/REG NO. ·
          ลำดับสถานีการผลิตของแต่ละตัว
          {canManageProducts ? "" : " (ดูอย่างเดียว)"}
        </p>
      </div>

      <RecipesView
        products={products}
        stations={stations}
        canManageProducts={canManageProducts}
        canManageStations={canManageStations}
      />
    </div>
  );
}
