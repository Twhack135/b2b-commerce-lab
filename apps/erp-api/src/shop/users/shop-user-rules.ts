// Business rules of shop users (Sprint 12A), without database access.
//
// A shop user is a person of a customer account (SAP: contact person of the
// customer). The same rules are enforced by CHECK constraints in the
// database (migration 20261102120000_add_shop_users), so no other code path
// can store an e-mail address or a name that breaks them.

export const EMAIL_MAX_LENGTH = 254;
export const DISPLAY_NAME_MAX_LENGTH = 100;

/** Printable ASCII without spaces and @, as in the database CHECK */
const EMAIL_PATTERN = /^[!-?A-~]+@[!-?A-~]+\.[!-?A-~]+$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The e-mail address as it is stored and compared: trimmed and in lower
 * case, so " Anna.Weber@Mueller.example " and "anna.weber@mueller.example"
 * are the same user. null if it is no usable address. Mailbox names are
 * treated case-insensitively, as practically all mail systems do.
 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email)
    ? email
    : null;
}

// Matching control characters is the purpose: they are rejected
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;

/** Trimmed display name, or null if it is blank, too long or has control characters */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim();
  return name !== '' &&
    name.length <= DISPLAY_NAME_MAX_LENGTH &&
    !CONTROL_CHARACTER.test(name)
    ? name
    : null;
}

export function isUuid(text: string): boolean {
  return UUID_PATTERN.test(text);
}

export type ShopUserRuleCode =
  | 'EMAIL_INVALID'
  | 'EMAIL_TAKEN'
  | 'DISPLAY_NAME_INVALID'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'USER_NOT_FOUND'
  | 'UNIT_NOT_FOUND'
  | 'UNIT_OF_OTHER_ACCOUNT'
  | 'UNIT_INACTIVE';

const MESSAGES: Record<ShopUserRuleCode, string> = {
  EMAIL_INVALID: 'The e-mail address is not valid.',
  EMAIL_TAKEN: 'A shop user with this e-mail address already exists.',
  DISPLAY_NAME_INVALID:
    'The display name must not be blank and has at most 100 characters.',
  ACCOUNT_NOT_FOUND: 'The customer account does not exist.',
  ACCOUNT_INACTIVE: 'The customer account is inactive.',
  USER_NOT_FOUND: 'The shop user does not exist.',
  UNIT_NOT_FOUND: 'The B2B unit does not exist.',
  UNIT_OF_OTHER_ACCOUNT:
    'The B2B unit belongs to another customer account than the shop user.',
  UNIT_INACTIVE: 'The B2B unit is inactive and cannot be assigned.',
};

/**
 * A violated business rule of the internal shop user services. These
 * services have no endpoints; a later administration or login endpoint
 * decides how a code is answered (never revealing other accounts' data).
 */
export class ShopUserRuleError extends Error {
  constructor(readonly code: ShopUserRuleCode) {
    super(MESSAGES[code]);
    this.name = 'ShopUserRuleError';
  }
}
