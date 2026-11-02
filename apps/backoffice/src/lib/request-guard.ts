// Request checks of the Backoffice's ERP proxy (Sprint 12C). No imports, so
// it can be tested directly with `node --test`.
//
// The Backoffice and the ERP admin API have NO administrator sign-in yet.
// They are only safe on this computer (docs/adr/0006, 0007), and binding to
// 127.0.0.1 alone does not keep other web pages out:
//
// - DNS rebinding: a foreign site whose name resolves to 127.0.0.1 can talk
//   to the Backoffice as "its own" origin. Its requests still carry the
//   foreign name in the Host header, so only loopback host names are served.
// - Cross-site requests (CSRF): any page may send a form or a simple POST to
//   127.0.0.1:3001. Browsers mark every state-changing request with Origin
//   (and Sec-Fetch-Site); only requests from the Backoffice's own pages are
//   forwarded.
//
// This is a boundary for local development, not an authentication.

const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"];

export type RequestHeaders = { get(name: string): string | null };

/** True if the Host header names this computer (any port) */
export function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  try {
    const url = new URL(`http://${host}`);
    return LOOPBACK_HOSTNAMES.includes(url.hostname) && url.host === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * True if a state-changing request comes from a page of this Backoffice:
 * Origin is exactly http://<Host>, and Sec-Fetch-Site, when the browser
 * sends it, says same-origin. Requests without Origin are refused.
 */
export function isSameOrigin(headers: RequestHeaders): boolean {
  const host = headers.get("host");
  const origin = headers.get("origin");
  if (!host || !origin || !isLocalHost(host) || origin !== `http://${host.toLowerCase()}`) {
    return false;
  }
  const site = headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}

/** Methods that only read; every other method must pass isSameOrigin */
export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/** A request body may only be JSON (the only type the ERP API reads) */
export function isJsonContentType(contentType: string | null): boolean {
  return contentType !== null && /^application\/json\s*(;|$)/i.test(contentType);
}
