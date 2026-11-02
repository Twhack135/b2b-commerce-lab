import { createHash, timingSafeEqual } from 'node:crypto';

// The shop service key proves that a request to /shop/v1 comes from the
// shop BFF (apps/shop). It identifies a SERVICE, never a user: it does not
// say which customer is acting and never authorizes access to customer
// data. Customer operations will additionally need a user session and an
// authorization check per B2B unit (docs/adr/0002, 0004).

/** Header of the service key; deliberately not "Authorization" */
export const SHOP_SERVICE_KEY_HEADER = 'x-shop-service-key';

/** Environment variable with the key (only on the servers, never in Git) */
export const SHOP_SERVICE_KEY_ENV = 'SHOP_SERVICE_KEY';

/** At least 32 visible characters, e.g. 64 hex digits of 32 random bytes */
const KEY_PATTERN = /^[\x21-\x7e]{32,256}$/;

/**
 * SHA-256 of the configured key, or null if it is missing or too weak. Then
 * the shop API answers every request with 503 (fail closed).
 */
export function configuredKeyDigest(
  env: Record<string, string | undefined>,
): Buffer | null {
  const key = env[SHOP_SERVICE_KEY_ENV];
  return key !== undefined && KEY_PATTERN.test(key) ? digest(key) : null;
}

/**
 * True if the presented header matches the configured key. Both are hashed
 * first, so the comparison takes the same time for every input.
 */
export function isValidServiceKey(
  presented: string | string[] | undefined,
  expected: Buffer,
): boolean {
  if (typeof presented !== 'string') return false;
  return timingSafeEqual(digest(presented), expected);
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}
