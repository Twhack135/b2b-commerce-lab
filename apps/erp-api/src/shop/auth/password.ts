import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

// Passwords of shop users (Sprint 12B, docs/adr/0003).
//
// Hashing: Argon2id from Node.js itself (node:crypto, Node 24.7 and later),
// so no third-party native module is needed. Parameters follow the OWASP
// Password Storage Cheat Sheet: 19 MiB memory, 2 passes, parallelism 1.
// The result is stored as a PHC string, e.g.
//   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>   (base64 without padding)
// so the parameters can be raised later without breaking stored passwords.
//
// Policy: NIST SP 800-63B Rev. 4 for passwords as the only factor: at least
// 15 characters, at most 128, no composition rules (passphrases welcome),
// Unicode normalized (NFKC), obviously weak values rejected.

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

/** Upper bounds for parameters read from the database (no resource abuse) */
const MAX_MEMORY_KIB = 262_144;
const MAX_PASSES = 10;
const MAX_PARALLELISM = 8;

const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=(\d{1,2})\$([A-Za-z0-9+/]{11,86})\$([A-Za-z0-9+/]{22,86})$/;

/** Fails closed: the ERP refuses to start without Argon2 support */
export function assertArgon2Available(): void {
  if (typeof argon2 !== 'function') {
    throw new Error(
      'Argon2 is not available: Node.js 24.7 or later is required for shop passwords.',
    );
  }
}

/** The password as it is hashed: Unicode NFKC (NIST SP 800-63B) */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

/** Length in characters (code points), not UTF-16 units */
function length(text: string): number {
  return Array.from(text).length;
}

/** Values that are long enough but trivially guessable */
const WEAK_PASSWORDS = new Set(
  [
    'passwordpassword',
    'password1234567',
    'password12345678',
    '123456789012345',
    '1234567890123456',
    'qwertyuiopasdfgh',
    'qwertzuiopasdfgh',
    'abcdefghijklmnop',
    'letmeinletmein1',
    'welcomewelcome1',
    'changemechangeme',
    'iloveyouiloveyou',
  ].map((p) => p.toLowerCase()),
);

/**
 * Why a new password is not acceptable (empty if it is). The messages may
 * be shown to the person who sets the password.
 */
export function passwordProblems(password: string, email: string): string[] {
  const value = normalize(password);
  const problems: string[] = [];
  if (length(value) < PASSWORD_MIN_LENGTH) {
    problems.push(
      `The password must have at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  if (length(value) > PASSWORD_MAX_LENGTH) {
    problems.push(
      `The password must have at most ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  if (problems.length > 0) return problems;
  const lower = value.toLowerCase();
  if (value.trim() === '' || /^(.)\1*$/u.test(value)) {
    problems.push('The password must not consist of one repeated character.');
  } else if (WEAK_PASSWORDS.has(lower)) {
    problems.push('The password is too common. Choose another one.');
  }
  const localPart = email.toLowerCase().split('@')[0] ?? '';
  if (
    lower === email.toLowerCase() ||
    (localPart.length >= 4 && lower.includes(localPart))
  ) {
    problems.push('The password must not contain your e-mail address.');
  }
  return problems;
}

function derive(
  password: string,
  salt: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      argon2(
        'argon2id',
        {
          message: Buffer.from(normalize(password), 'utf8'),
          nonce: salt,
          memory,
          passes,
          parallelism,
          tagLength,
        },
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    } catch (error) {
      // Invalid parameters are reported synchronously
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const b64 = (buffer: Buffer) => buffer.toString('base64').replace(/=+$/, '');

/** The PHC string of a new password (random salt per password) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(
    password,
    salt,
    MEMORY_KIB,
    PASSES,
    PARALLELISM,
    HASH_BYTES,
  );
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${b64(salt)}$${b64(hash)}`;
}

/**
 * True if the password matches the stored PHC string. A malformed or
 * implausible stored value never matches and never throws.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const match = PHC_PATTERN.exec(stored);
  if (!match) return false;
  const [memory, passes, parallelism] = match.slice(1, 4).map(Number);
  if (
    memory < 8 * parallelism ||
    memory > MAX_MEMORY_KIB ||
    passes < 1 ||
    passes > MAX_PASSES ||
    parallelism < 1 ||
    parallelism > MAX_PARALLELISM
  ) {
    return false;
  }
  const salt = Buffer.from(match[4], 'base64');
  const expected = Buffer.from(match[5], 'base64');
  try {
    const actual = await derive(
      password,
      salt,
      memory,
      passes,
      parallelism,
      expected.length,
    );
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * A valid hash of a random password. Verifying against it takes as long as
 * a real check, so an unknown e-mail address is not faster to reject.
 */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64'));
  return dummyHash;
}
