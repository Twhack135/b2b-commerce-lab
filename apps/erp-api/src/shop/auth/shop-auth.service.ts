import { Injectable, OnModuleInit } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { isUuid, normalizeEmail } from '../users/shop-user-rules';
import { AttemptLimiter } from './attempt-limiter';
import {
  assertArgon2Available,
  dummyPasswordHash,
  hashPassword,
  passwordProblems,
  verifyPassword,
} from './password';
import {
  ActivationNotPossibleError,
  InvalidActivationError,
  InvalidCredentialsError,
  PasswordPolicyError,
  TooManyAttemptsError,
} from './shop-auth.errors';
import { isTokenFormat, newToken, tokenHash } from './tokens';

const MINUTE = 60_000;

/** An activation link is valid for 24 hours */
export const ACTIVATION_LIFETIME_MS = 24 * 60 * MINUTE;
/** A session ends after 30 minutes without requests ... */
export const SESSION_IDLE_MS = 30 * MINUTE;
/** ... and at the latest 10 hours after sign-in */
export const SESSION_LIFETIME_MS = 10 * 60 * MINUTE;
/** last_seen_at is written at most once a minute per session */
const SESSION_TOUCH_MS = MINUTE;

/**
 * Unsuccessful sign-ins per e-mail address and per trusted client address.
 * Requests without a client address the BFF can trust share one counter,
 * so missing or spoofed addresses never bypass the limits (development
 * only: in memory of this process, see AttemptLimiter).
 */
export const LOGIN_LIMIT_PER_EMAIL = 5;
export const LOGIN_LIMIT_PER_ADDRESS = 30;
export const LOGIN_LIMIT_UNATTRIBUTED = 50;
/** Unsuccessful activations per trusted client address, or together */
export const ACTIVATION_LIMIT_PER_ADDRESS = 10;
export const ACTIVATION_LIMIT_UNATTRIBUTED = 20;
export const ATTEMPT_WINDOW_MS = 15 * MINUTE;

/** The shared key of requests without a trusted client address */
const UNATTRIBUTED = 'unattributed';

/** The signed-in user as the shop may see them */
export interface ShopSessionUser {
  email: string;
  displayName: string;
  role: 'BUYER';
  account: { customerNumber: string; name: string };
}

export interface ShopSessionContext {
  sessionId: string;
  userId: string;
  expiresAt: Date;
  user: ShopSessionUser;
}

const SESSION_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  status: true,
  accountCustomerNumber: true,
  account: { select: { customer: { select: { name: true, isActive: true } } } },
} as const;

type SessionUserRecord = {
  id: string;
  email: string;
  displayName: string;
  role: 'BUYER';
  status: 'ACTIVE' | 'DISABLED';
  accountCustomerNumber: string;
  account: { customer: { name: string; isActive: boolean } };
};

/** An active user of an active account may sign in and stay signed in */
function mayUseShop(user: SessionUserRecord): boolean {
  return user.status === 'ACTIVE' && user.account.customer.isActive;
}

function toSessionUser(user: SessionUserRecord): ShopSessionUser {
  return {
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    account: {
      customerNumber: user.accountCustomerNumber,
      name: user.account.customer.name,
    },
  };
}

/**
 * Sign-in of shop users (docs/adr/0003): activation with a one-time link,
 * password login and opaque server-side sessions. The raw tokens leave this
 * service only towards the shop BFF; the database stores their hashes.
 */
@Injectable()
export class ShopAuthService implements OnModuleInit {
  private readonly loginByEmail: AttemptLimiter;
  private readonly loginByAddress: AttemptLimiter;
  private readonly activationByAddress: AttemptLimiter;
  private readonly loginUnattributed: AttemptLimiter;
  private readonly activationUnattributed: AttemptLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {
    const now = () => this.clock.now().getTime();
    this.loginByEmail = new AttemptLimiter(
      LOGIN_LIMIT_PER_EMAIL,
      ATTEMPT_WINDOW_MS,
      now,
    );
    this.loginByAddress = new AttemptLimiter(
      LOGIN_LIMIT_PER_ADDRESS,
      ATTEMPT_WINDOW_MS,
      now,
    );
    this.activationByAddress = new AttemptLimiter(
      ACTIVATION_LIMIT_PER_ADDRESS,
      ATTEMPT_WINDOW_MS,
      now,
    );
    this.loginUnattributed = new AttemptLimiter(
      LOGIN_LIMIT_UNATTRIBUTED,
      ATTEMPT_WINDOW_MS,
      now,
    );
    this.activationUnattributed = new AttemptLimiter(
      ACTIVATION_LIMIT_UNATTRIBUTED,
      ATTEMPT_WINDOW_MS,
      now,
    );
  }

  onModuleInit() {
    assertArgon2Available();
  }

  /**
   * A new activation link for an active user of an active account who has
   * no password yet. Replaces an earlier, unused link. Internal only (no
   * endpoint): the raw token is returned once and never stored.
   */
  async issueActivation(
    userId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    if (!isUuid(userId)) throw new ActivationNotPossibleError('USER_NOT_FOUND');
    const now = this.clock.now();
    const token = newToken();
    const expiresAt = new Date(now.getTime() + ACTIVATION_LIFETIME_MS);
    await this.prisma.$transaction(async (tx) => {
      // One issue at a time per user
      await tx.$queryRaw`SELECT id FROM shop_users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.shopUser.findUnique({
        where: { id: userId },
        select: {
          ...SESSION_USER_SELECT,
          credential: { select: { userId: true } },
        },
      });
      if (!user) throw new ActivationNotPossibleError('USER_NOT_FOUND');
      if (user.status !== 'ACTIVE')
        throw new ActivationNotPossibleError('USER_DISABLED');
      if (!user.account.customer.isActive)
        throw new ActivationNotPossibleError('ACCOUNT_INACTIVE');
      if (user.credential)
        throw new ActivationNotPossibleError('ALREADY_ACTIVATED');
      await tx.shopActivationToken.deleteMany({
        where: { userId, usedAt: null },
      });
      await tx.shopActivationToken.create({
        data: {
          userId,
          tokenHash: tokenHash(token),
          createdAt: now,
          expiresAt,
        },
      });
    });
    return { token, expiresAt };
  }

  /**
   * Sets the first password with an activation link. The link is used up
   * in the same transaction (row lock), so it works exactly once, also when
   * it is submitted several times at the same moment.
   */
  async activate(
    token: string,
    password: string,
    clientAddress?: string,
  ): Promise<void> {
    // Counted before the link is checked; a valid link gives the slot back
    const [limiter, key] = clientAddress
      ? [this.activationByAddress, clientAddress]
      : [this.activationUnattributed, UNATTRIBUTED];
    if (!limiter.acquire(key)) throw new TooManyAttemptsError();
    const fail = (): never => {
      throw new InvalidActivationError();
    };
    if (!isTokenFormat(token)) fail();

    const now = this.clock.now();
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const [link] = await tx.$queryRaw<{ id: string; user_id: string }[]>`
          SELECT id, user_id FROM shop_activation_tokens
          WHERE token_hash = ${tokenHash(token)} AND used_at IS NULL AND expires_at > ${now}
          FOR UPDATE`;
        if (!link) return 'invalid' as const;
        const user = await tx.shopUser.findUnique({
          where: { id: link.user_id },
          select: {
            ...SESSION_USER_SELECT,
            credential: { select: { userId: true } },
          },
        });
        // A disabled user or an inactive account cannot activate; the link
        // stays unused (it expires) and nothing reveals the reason
        if (!user || !mayUseShop(user) || user.credential)
          return 'invalid' as const;
        const problems = passwordProblems(password, user.email);
        if (problems.length > 0) return { problems };
        await tx.shopUserCredential.create({
          data: { userId: user.id, passwordHash: await hashPassword(password) },
        });
        await tx.shopActivationToken.update({
          where: { id: link.id },
          data: { usedAt: now },
        });
        return 'activated' as const;
      },
      { timeout: 15_000 },
    );
    if (outcome === 'invalid') fail();
    limiter.release(key);
    if (typeof outcome === 'object')
      throw new PasswordPolicyError(outcome.problems);
  }

  /**
   * Signs a user in and returns a new session token (for the session
   * cookie). An existing session of the browser is ended first, so a
   * session ID is never reused after sign-in. Every failure is the same.
   */
  async login(input: {
    email: string;
    password: string;
    clientAddress?: string;
    previousSessionToken?: string;
  }): Promise<{ token: string; expiresAt: Date; user: ShopSessionUser }> {
    const email = normalizeEmail(input.email);
    const emailKey = email ?? `invalid:${input.email.trim().toLowerCase()}`;
    const { clientAddress } = input;
    const [addressLimiter, addressKey] =
      clientAddress !== undefined
        ? [this.loginByAddress, clientAddress]
        : [this.loginUnattributed, UNATTRIBUTED];
    // Counted before the password is checked, in one synchronous step: of
    // concurrent attempts, no more than the limit are ever checked
    if (
      this.loginByEmail.isBlocked(emailKey) ||
      addressLimiter.isBlocked(addressKey)
    ) {
      throw new TooManyAttemptsError();
    }
    this.loginByEmail.acquire(emailKey);
    addressLimiter.acquire(addressKey);

    const user = email
      ? await this.prisma.shopUser.findUnique({
          where: { email },
          select: {
            ...SESSION_USER_SELECT,
            credential: { select: { passwordHash: true } },
          },
        })
      : null;
    // Unknown users are checked against a dummy hash: same time, same answer
    const stored =
      user?.credential?.passwordHash ?? (await dummyPasswordHash());
    const passwordMatches = await verifyPassword(input.password, stored);
    if (!passwordMatches || !user?.credential || !mayUseShop(user)) {
      throw new InvalidCredentialsError();
    }

    if (input.previousSessionToken)
      await this.logout(input.previousSessionToken);
    const now = this.clock.now();
    const token = newToken();
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    const created = await this.prisma.$transaction(async (tx) => {
      // Locks the user and the account's owner customer against concurrent
      // status changes: a deactivation either waits for this sign-in (and
      // its trigger then ends the new session) or this sign-in waits and
      // sees the deactivation. No session can outlive a deactivation.
      const [state] = await tx.$queryRaw<
        { status: string; is_active: boolean }[]
      >`
        SELECT u.status::text AS status, c.is_active
          FROM shop_users u
          JOIN customers c ON c.customer_number = u.account_customer_number
         WHERE u.id = ${user.id}::uuid
           FOR SHARE OF u, c`;
      if (!state || state.status !== 'ACTIVE' || !state.is_active) {
        return false;
      }
      await tx.shopSession.create({
        data: {
          userId: user.id,
          tokenHash: tokenHash(token),
          createdAt: now,
          lastSeenAt: now,
          expiresAt,
        },
      });
      return true;
    });
    if (!created) throw new InvalidCredentialsError();
    // A successful sign-in does not count against the limits
    this.loginByEmail.reset(emailKey);
    addressLimiter.release(addressKey);
    return { token, expiresAt, user: toSessionUser(user) };
  }

  /**
   * The session of a token, or null if it is unknown, ended, expired, idle
   * too long, or its user or account may no longer use the shop. Checked on
   * every request, so disabling a user takes effect immediately.
   */
  async session(token: string | undefined): Promise<ShopSessionContext | null> {
    if (!isTokenFormat(token)) return null;
    const now = this.clock.now();
    const session = await this.prisma.shopSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: {
        id: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: SESSION_USER_SELECT },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      now.getTime() - session.lastSeenAt.getTime() >= SESSION_IDLE_MS ||
      !mayUseShop(session.user)
    ) {
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_MS) {
      await this.prisma.shopSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { lastSeenAt: now },
      });
    }
    return {
      sessionId: session.id,
      userId: session.user.id,
      expiresAt: session.expiresAt,
      user: toSessionUser(session.user),
    };
  }

  /** Ends the session of the token; unknown or ended tokens change nothing */
  async logout(token: string | undefined): Promise<void> {
    if (!isTokenFormat(token)) return;
    await this.prisma.shopSession.updateMany({
      where: { tokenHash: tokenHash(token), revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }
}
