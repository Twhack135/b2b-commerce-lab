import { createHash, randomBytes } from 'node:crypto';

// Activation and session tokens: 256 random bits from the operating
// system's cryptographic generator, as base64url text (43 characters).
// The database only stores the SHA-256 digest, so a copy of the database
// does not contain usable tokens.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** False for anything that cannot be a token; it is not even looked up */
export function isTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** The stored form of a token: SHA-256 as 64 lower-case hex characters */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
