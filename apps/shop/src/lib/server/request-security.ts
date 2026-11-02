// Security rules of the shop BFF for browser requests (Sprint 12B). No
// imports, so it can be tested directly with `node --test`.
//
// CSRF: every state-changing request (POST) must come from a page of this
// shop. Browsers send the Origin header with every POST; it must match the
// host the request was sent to. Plain HTTP is only accepted on this
// computer (local development, docs/adr/0006).
//
// Session cookie: HttpOnly (no script can read it), SameSite=Lax, Path=/.
// Over HTTPS it is "__Host-shop_session" with Secure. Browsers only accept
// the __Host- prefix together with Secure, so plain-HTTP localhost uses
// "shop_session" instead (a documented deviation from docs/adr/0003).

const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"];

export const SECURE_SESSION_COOKIE = "__Host-shop_session";
export const LOCAL_SESSION_COOKIE = "shop_session";

export type RequestHeaders = { get(name: string): string | null };

function isLoopbackHost(host: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/**
 * The origin of this shop as the browser sees it, from the Origin of a
 * state-changing request; null if the request is not from this shop
 */
export function sameOrigin(headers: RequestHeaders): URL | null {
  const host = headers.get("host");
  const origin = headers.get("origin");
  if (!host || !origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.host !== host || url.origin !== origin) return null;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(host))) {
    return null;
  }
  // Fetch metadata: when the browser sends it, it must agree
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return null;
  return url;
}

export type CookieSettings = {
  name: string;
  options: { httpOnly: true; sameSite: "lax"; path: "/"; secure: boolean };
};

/** The session cookie for this shop origin; null where no sign-in is allowed */
export function sessionCookie(origin: URL): CookieSettings | null {
  const options = { httpOnly: true, sameSite: "lax", path: "/" } as const;
  if (origin.protocol === "https:") {
    return { name: SECURE_SESSION_COOKIE, options: { ...options, secure: true } };
  }
  if (origin.protocol === "http:" && isLoopbackHost(origin.host)) {
    return { name: LOCAL_SESSION_COOKIE, options: { ...options, secure: false } };
  }
  return null;
}

/**
 * The session token from the request cookies. The local cookie name is
 * only accepted on this computer, so it cannot be planted on a real domain.
 */
export function sessionTokenFrom(
  cookies: { get(name: string): { value: string } | undefined },
  host: string | null,
): string | undefined {
  const secure = cookies.get(SECURE_SESSION_COOKIE)?.value;
  if (secure) return secure;
  return host && isLoopbackHost(host) ? cookies.get(LOCAL_SESSION_COOKIE)?.value : undefined;
}

/**
 * How many reverse proxies in front of the shop append to X-Forwarded-For
 * and can be trusted (SHOP_TRUSTED_PROXY_HOPS). Default 0: the shop runs
 * without a proxy and trusts no X-Forwarded-For at all, because any client
 * can send that header. Anything but a small whole number also means 0.
 */
export function trustedProxyHops(env: Record<string, string | undefined>): number {
  const value = env.SHOP_TRUSTED_PROXY_HOPS ?? "0";
  return /^[0-5]$/.test(value) ? Number(value) : 0;
}

/**
 * The client address for rate limits, or undefined if none can be trusted.
 * With n trusted proxies, the n-th entry from the right of X-Forwarded-For
 * is the address the outermost trusted proxy saw; entries further left come
 * from the client and are ignored. Without a trusted address the ERP counts
 * the request in one shared limit, so spoofing never bypasses a limit.
 */
export function clientAddress(headers: RequestHeaders, hops: number): string | undefined {
  if (hops < 1) return undefined;
  const entries = (headers.get("x-forwarded-for") ?? "").split(",").map((entry) => entry.trim());
  const candidate = entries.length >= hops ? entries[entries.length - hops] : undefined;
  return candidate && /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : undefined;
}

// Unit selection (Sprint 12C, docs/adr/0007): the unit the user chose is
// remembered in its own cookie with the same attributes as the session
// cookie. It is only a preference: the ERP checks it on every request
// against the units it authorizes for the session, so changing the cookie
// can never select a unit the user may not use. It authenticates nothing.

export const SECURE_UNIT_COOKIE = "__Host-shop_unit";
export const LOCAL_UNIT_COOKIE = "shop_unit";

/** A plausible unit ID (the ERP decides whether it exists and is allowed) */
export function isUnitIdFormat(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,20}$/.test(value);
}

/** The unit cookie for this shop origin; null where no sign-in is allowed */
export function unitCookie(origin: URL): CookieSettings | null {
  const session = sessionCookie(origin);
  if (!session) return null;
  return { name: session.options.secure ? SECURE_UNIT_COOKIE : LOCAL_UNIT_COOKIE, options: session.options };
}

/** The chosen unit from the request cookies; local name only on this computer */
export function selectedUnitFrom(
  cookies: { get(name: string): { value: string } | undefined },
  host: string | null,
): string | undefined {
  const value =
    cookies.get(SECURE_UNIT_COOKIE)?.value ??
    (host && isLoopbackHost(host) ? cookies.get(LOCAL_UNIT_COOKIE)?.value : undefined);
  return isUnitIdFormat(value) ? value : undefined;
}
