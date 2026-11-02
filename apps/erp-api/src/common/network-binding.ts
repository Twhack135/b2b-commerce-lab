// The ERP API has no user authentication for its admin endpoints (materials,
// customers, prices, sales orders, ...). It may therefore only listen on the
// loopback interface of this computer; there is deliberately no override.
// A customer-facing shop reaches the ERP only through its own BFF on the
// same machine (docs/adr/0006).

const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

/** The host to listen on: HOST or 127.0.0.1; refuses any other interface */
export function loopbackHost(host: string | undefined): string {
  const value = host ?? '127.0.0.1';
  if (!LOOPBACK_HOSTS.includes(value)) {
    throw new Error(
      `Refusing to listen on "${value}": the ERP API has no authentication for its admin endpoints and may only listen on 127.0.0.1, ::1 or localhost.`,
    );
  }
  return value;
}

const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * True if the Host header of a request names this computer (any port).
 * Listening on loopback alone does not stop a web page from reaching the
 * API through DNS rebinding: a foreign domain that resolves to 127.0.0.1
 * still carries its own name in the Host header, so such requests are
 * refused before any route runs (docs/adr/0007).
 */
export function isLoopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const url = new URL(`http://${host}`);
    return (
      LOOPBACK_HOSTNAMES.includes(url.hostname) &&
      url.host === host.toLowerCase()
    );
  } catch {
    return false;
  }
}
