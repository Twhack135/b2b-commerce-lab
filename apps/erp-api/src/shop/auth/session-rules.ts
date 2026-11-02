// When a shop session counts as open (Sprint 12B), without database access.
// Shared by the sign-in (ShopAuthService) and the session list of the
// shop user administration, so both always agree.

const MINUTE = 60_000;

/** A session ends after 30 minutes without requests ... */
export const SESSION_IDLE_MS = 30 * MINUTE;
/** ... and at the latest 10 hours after sign-in */
export const SESSION_LIFETIME_MS = 10 * 60 * MINUTE;

export interface SessionTimes {
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Not signed out or revoked, not past its lifetime, not idle too long */
export function isSessionOpen(session: SessionTimes, now: Date): boolean {
  return (
    !session.revokedAt &&
    session.expiresAt > now &&
    now.getTime() - session.lastSeenAt.getTime() < SESSION_IDLE_MS
  );
}

/** The moment an open session ends without further activity */
export function sessionEndsAt(session: SessionTimes): Date {
  return new Date(
    Math.min(
      session.expiresAt.getTime(),
      session.lastSeenAt.getTime() + SESSION_IDLE_MS,
    ),
  );
}
