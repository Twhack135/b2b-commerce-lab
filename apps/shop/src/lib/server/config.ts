// Server configuration of the shop BFF, read from the environment at
// request time. No imports, so it can be tested directly with `node --test`;
// only server code (erp-shop-api.ts) uses it.
//
// Fail closed: without a valid ERP address and service key the shop never
// calls the ERP API. Both stay on the server; neither has the NEXT_PUBLIC_
// prefix, so Next.js never puts them into a browser bundle.

export type ShopServerConfig =
  | { ok: true; erpApiUrl: string; serviceKey: string }
  | { ok: false; problem: string };

/** Local development only: the ERP API listens on loopback (docs/adr/0006) */
const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]", "localhost"];

const KEY_PATTERN = /^[\x21-\x7e]{32,256}$/;

export function readShopServerConfig(
  env: Record<string, string | undefined>,
): ShopServerConfig {
  const url = env.ERP_API_URL ?? "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, problem: "ERP_API_URL is missing or not a URL" };
  }
  if (
    parsed.protocol !== "http:" ||
    !LOOPBACK_HOSTS.includes(parsed.hostname) ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return { ok: false, problem: "ERP_API_URL must be http://127.0.0.1:<port> (local development only)" };
  }
  const serviceKey = env.SHOP_SERVICE_KEY ?? "";
  if (!KEY_PATTERN.test(serviceKey)) {
    return { ok: false, problem: "SHOP_SERVICE_KEY is missing or shorter than 32 characters" };
  }
  return { ok: true, erpApiUrl: parsed.origin, serviceKey };
}
