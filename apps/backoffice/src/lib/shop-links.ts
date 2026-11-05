// The "Open Shop" menu of the Backoffice (Sprint 12C acceptance, UX-001).
// The shop addresses are configuration of the Backoffice server, never
// fixed in the code: SHOP_LINK_TEST_URL and SHOP_LINK_PRODUCTION_URL in
// apps/backoffice/.env.local. No imports, so it can be tested with
// `node --test`.

const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"];

export type ShopLink = {
  key: "test" | "production";
  label: string;
  /** The shop's address, or null when the environment is not configured */
  url: string | null;
};

const ENVIRONMENTS = [
  { key: "test", label: "Test shop", variable: "SHOP_LINK_TEST_URL" },
  { key: "production", label: "Production shop", variable: "SHOP_LINK_PRODUCTION_URL" },
] as const;

/**
 * A usable shop address: HTTPS, or plain HTTP on this computer only,
 * without credentials, query or fragment. Returned without a trailing
 * slash; null if the value is missing or not acceptable.
 */
export function shopLinkUrl(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const allowed =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTNAMES.includes(url.hostname));
  if (!allowed || url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The menu entries: every environment, configured or not */
export function shopLinks(env: Record<string, string | undefined>): ShopLink[] {
  return ENVIRONMENTS.map(({ key, label, variable }) => ({ key, label, url: shopLinkUrl(env[variable]) }));
}
