// The activation link a shop user receives (Sprint 12B/12C). Built in the
// ERP for the local tool (npm run shop:user) and the Backoffice
// administration, so both produce the same, safe link.
//
// The token goes into the fragment (#token=...): browsers never send the
// fragment to a server or in a Referer header, so it does not end up in
// access logs. The shop page reads it and removes it from the address bar.

/** Where the shop runs, e.g. http://127.0.0.1:3002 (root .env) */
export const SHOP_PUBLIC_URL_ENV = 'SHOP_PUBLIC_URL';
export const DEFAULT_SHOP_URL = 'http://127.0.0.1:3002';

const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * The origin of the shop, or null if the address is unusable: HTTPS, or
 * plain HTTP on this computer only, without path, query or credentials.
 */
export function shopOrigin(value: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL(value ?? DEFAULT_SHOP_URL);
  } catch {
    return null;
  }
  const secure =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.includes(url.hostname));
  return secure &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
    ? url.origin
    : null;
}

export function activationLink(origin: string, token: string): string {
  return `${origin}/activate#token=${token}`;
}
