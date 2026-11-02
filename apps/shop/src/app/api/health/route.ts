import { connection } from "next/server";
import { erpShopHealth } from "@/lib/server/erp-shop-api";

/**
 * Technical health of the shop for operations and tests: whether the shop
 * runs and reaches the ERP shop API. No versions, no configuration, no
 * reasons; GET only (Next.js answers 405 for other methods).
 */
export async function GET() {
  // Always at request time: the configuration is never read during the build
  await connection();
  const erp = await erpShopHealth();
  return Response.json(
    { status: erp === "ok" ? "ok" : "degraded", erp },
    { status: erp === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
