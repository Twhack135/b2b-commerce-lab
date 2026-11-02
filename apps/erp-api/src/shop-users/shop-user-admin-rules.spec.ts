import {
  activationState,
  shopAccess,
  unitAccess,
} from './shop-user-admin-rules';

const now = new Date('2026-11-15T12:00:00.000Z');

describe('activationState', () => {
  it('reports the first-password state without revealing any secret', () => {
    const later = new Date(now.getTime() + 1);
    expect(activationState({ createdAt: now }, undefined, now)).toBe(
      'ACTIVATED',
    );
    // A password set wins over a link (cannot coexist, but never mislead)
    expect(activationState({ createdAt: now }, { expiresAt: later }, now)).toBe(
      'ACTIVATED',
    );
    expect(activationState(null, { expiresAt: later }, now)).toBe('LINK_OPEN');
    expect(activationState(null, { expiresAt: now }, now)).toBe('LINK_EXPIRED');
    expect(activationState(null, undefined, now)).toBe('NOT_INVITED');
  });
});

describe('shopAccess and unitAccess', () => {
  it('grants nothing to a disabled user or an inactive account', () => {
    expect(shopAccess('ACTIVE', true)).toBe('GRANTED');
    expect(shopAccess('DISABLED', true)).toBe('USER_DISABLED');
    expect(shopAccess('DISABLED', false)).toBe('USER_DISABLED');
    expect(shopAccess('ACTIVE', false)).toBe('ACCOUNT_INACTIVE');
    for (const access of ['USER_DISABLED', 'ACCOUNT_INACTIVE'] as const) {
      expect(unitAccess(access, true)).toBe('NONE');
    }
  });

  it('allows ordering for active units only; inactive ones are view only', () => {
    expect(unitAccess('GRANTED', true)).toBe('ORDER');
    expect(unitAccess('GRANTED', false)).toBe('VIEW');
  });
});
