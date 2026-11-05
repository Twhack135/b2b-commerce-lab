import {
  activationLink,
  passwordResetLink,
  shopOrigin,
} from './activation-link';
import { isSessionOpen, SESSION_IDLE_MS, sessionEndsAt } from './session-rules';

describe('shopOrigin', () => {
  it('defaults to the local shop and accepts HTTPS or local HTTP', () => {
    expect(shopOrigin(undefined)).toBe('http://127.0.0.1:3002');
    expect(shopOrigin('http://127.0.0.1:3303')).toBe('http://127.0.0.1:3303');
    expect(shopOrigin('http://localhost:3002/')).toBe('http://localhost:3002');
    expect(shopOrigin('https://shop.example.com')).toBe(
      'https://shop.example.com',
    );
  });

  it('refuses addresses a link must never point to', () => {
    for (const value of [
      '',
      'not a url',
      'http://shop.example.com',
      'ftp://127.0.0.1',
      'javascript:alert(1)',
      'https://shop.example.com/path',
      'https://shop.example.com/?x=1',
      'https://user:secret@shop.example.com',
      'https://shop.example.com/#token=x',
    ]) {
      expect(shopOrigin(value)).toBeNull();
    }
  });
});

describe('activationLink', () => {
  it('puts the token into the fragment, never into path or query', () => {
    const link = new URL(activationLink('http://127.0.0.1:3002', 'abc'));
    expect(link.pathname).toBe('/activate');
    expect(link.search).toBe('');
    expect(link.hash).toBe('#token=abc');
  });
});

describe('passwordResetLink', () => {
  it('has its own page and the token in the fragment only', () => {
    const link = new URL(passwordResetLink('http://127.0.0.1:3002', 'abc'));
    expect(link.pathname).toBe('/reset-password');
    expect(link.search).toBe('');
    expect(link.hash).toBe('#token=abc');
  });
});

describe('session rules', () => {
  const now = new Date('2026-11-15T12:00:00.000Z');
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000);
  const session = (
    overrides: Partial<Parameters<typeof isSessionOpen>[0]>,
  ) => ({
    lastSeenAt: minutesAgo(1),
    expiresAt: new Date(now.getTime() + 3_600_000),
    revokedAt: null,
    ...overrides,
  });

  it('is open while active, not revoked and within its lifetime', () => {
    expect(isSessionOpen(session({}), now)).toBe(true);
    expect(isSessionOpen(session({ revokedAt: minutesAgo(0) }), now)).toBe(
      false,
    );
    expect(isSessionOpen(session({ expiresAt: now }), now)).toBe(false);
    expect(isSessionOpen(session({ lastSeenAt: minutesAgo(30) }), now)).toBe(
      false,
    );
    expect(isSessionOpen(session({ lastSeenAt: minutesAgo(29) }), now)).toBe(
      true,
    );
  });

  it('ends at the idle limit or the absolute limit, whichever is first', () => {
    const idle = session({});
    expect(sessionEndsAt(idle)).toEqual(
      new Date(idle.lastSeenAt.getTime() + SESSION_IDLE_MS),
    );
    const absolute = session({ expiresAt: new Date(now.getTime() + 60_000) });
    expect(sessionEndsAt(absolute)).toEqual(absolute.expiresAt);
  });
});
