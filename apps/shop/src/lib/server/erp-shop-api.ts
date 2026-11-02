import "server-only";
import { readShopServerConfig } from "./config";

// The only way from the shop to the ERP: server-side calls to the shop API
// /shop/v1 with the service key. The browser never calls the ERP API, and
// the shop never calls the ERP admin endpoints (docs/adr/0001, 0005).
//
// The service key only proves that the call comes from the shop server. It
// does not identify a customer and authorizes no customer data; later
// customer calls will also carry the user's session (docs/adr/0002, 0003).

const SERVICE_KEY_HEADER = "X-Shop-Service-Key";
const TIMEOUT_MS = 3_000;

export type ErpStatus = "ok" | "unavailable";

/**
 * Technical health of the ERP shop API. Every problem is reported the same
 * way: the reason (missing configuration, wrong key, ERP down) is only
 * written to the server log, never sent to the browser.
 */
export async function erpShopHealth(): Promise<ErpStatus> {
  const config = readShopServerConfig(process.env);
  if (!config.ok) {
    console.error(`Shop: ERP shop API not configured: ${config.problem}`);
    return "unavailable";
  }
  try {
    const response = await fetch(`${config.erpApiUrl}/shop/v1/health`, {
      headers: { [SERVICE_KEY_HEADER]: config.serviceKey, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Shop: ERP shop API health answered HTTP ${response.status}`);
      return "unavailable";
    }
    const body: unknown = await response.json();
    return isOk(body) ? "ok" : "unavailable";
  } catch {
    console.error("Shop: ERP shop API not reachable");
    return "unavailable";
  }
}

function isOk(body: unknown): boolean {
  return typeof body === "object" && body !== null && "status" in body && body.status === "ok";
}
