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
