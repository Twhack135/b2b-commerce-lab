import { AttemptLimiter } from './attempt-limiter';
import { isTokenFormat, newToken, tokenHash } from './tokens';

describe('tokens', () => {
  it('creates 256-bit random tokens in base64url', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => newToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) expect(isTokenFormat(token)).toBe(true);
    expect(Buffer.from([...tokens][0], 'base64url')).toHaveLength(32);
  });

  it('stores only a SHA-256 hex digest', () => {
    const token = newToken();
    expect(tokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(token)).toBe(tokenHash(token));
    expect(tokenHash(token)).not.toContain(token);
  });

  it('rejects everything that cannot be a token', () => {
    for (const value of [
      undefined,
      null,
      42,
      '',
      'short',
      `${newToken()}x`,
      `${newToken().slice(0, 42)}=`,
      "' OR 1=1 --",
    ]) {
      expect(isTokenFormat(value)).toBe(false);
    }
  });
});

describe('AttemptLimiter', () => {
  let now = 0;
  const limiter = () => new AttemptLimiter(3, 60_000, () => now);

  beforeEach(() => {
    now = 1_000_000;
  });

  it('counts attempts and blocks a key at the limit until its window has passed', () => {
    const l = limiter();
    for (let i = 0; i < 3; i++) {
      expect(l.isBlocked('a')).toBe(false);
      expect(l.acquire('a')).toBe(true);
    }
    expect(l.isBlocked('a')).toBe(true);
    expect(l.acquire('a')).toBe(false);
    expect(l.isBlocked('b')).toBe(false);
    now += 59_999;
    expect(l.acquire('a')).toBe(false);
    now += 1;
    expect(l.acquire('a')).toBe(true);
  });

  it('lets no more than the limit through when attempts arrive together', () => {
    const l = limiter();
    const results = Array.from({ length: 20 }, () => l.acquire('a'));
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it('gives a slot back after a success, and clears a key on reset', () => {
    const l = limiter();
    l.acquire('a');
    l.acquire('a');
    l.release('a');
    l.acquire('a');
    expect(l.isBlocked('a')).toBe(false);
    l.acquire('a');
    expect(l.isBlocked('a')).toBe(true);
    l.reset('a');
    expect(l.isBlocked('a')).toBe(false);
    l.release('unknown');
    expect(l.isBlocked('unknown')).toBe(false);
  });

  it('keeps its memory bounded for many different keys', () => {
    const l = limiter();
    for (let i = 0; i < 25_000; i++) l.acquire(`key-${i}`);
    expect(
      (l as unknown as { windows: Map<string, unknown> }).windows.size,
    ).toBeLessThanOrEqual(10_000);
  });
});
