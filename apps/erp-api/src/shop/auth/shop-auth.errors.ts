// Outcomes of the shop sign-in services. The controller turns them into
// HTTP answers; the messages never reveal whether an account exists.

/** Wrong e-mail address or password, or an account that may not sign in */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid e-mail address or password.');
    this.name = 'InvalidCredentialsError';
  }
}

export class TooManyAttemptsError extends Error {
  constructor() {
    super('Too many attempts. Please wait a few minutes and try again.');
    this.name = 'TooManyAttemptsError';
  }
}

/** Unknown, used or expired activation link, or a user who may not activate */
export class InvalidActivationError extends Error {
  constructor() {
    super('The activation link is invalid or has expired.');
    this.name = 'InvalidActivationError';
  }
}

/** The new password breaks the password rules (messages for the user) */
export class PasswordPolicyError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'PasswordPolicyError';
  }
}

export type ActivationRefusal =
  'USER_NOT_FOUND' | 'USER_DISABLED' | 'ACCOUNT_INACTIVE' | 'ALREADY_ACTIVATED';

/** An activation link cannot be issued (internal tooling only) */
export class ActivationNotPossibleError extends Error {
  constructor(readonly reason: ActivationRefusal) {
    super(`No activation link can be issued: ${reason}`);
    this.name = 'ActivationNotPossibleError';
  }
}

/** Unknown, used or expired reset link, or a user who may not reset */
export class InvalidPasswordResetError extends Error {
  constructor() {
    super('The password reset link is invalid or has expired.');
    this.name = 'InvalidPasswordResetError';
  }
}

export type PasswordResetRefusal =
  'USER_NOT_FOUND' | 'USER_DISABLED' | 'ACCOUNT_INACTIVE' | 'NOT_ACTIVATED';

/** A reset link cannot be issued (administration only) */
export class PasswordResetNotPossibleError extends Error {
  constructor(readonly reason: PasswordResetRefusal) {
    super(`No password reset link can be issued: ${reason}`);
    this.name = 'PasswordResetNotPossibleError';
  }
}
