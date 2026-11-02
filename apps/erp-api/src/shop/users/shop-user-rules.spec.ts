import {
  isUuid,
  normalizeDisplayName,
  normalizeEmail,
  ShopUserRuleError,
} from './shop-user-rules';

describe('shop user rules', () => {
  describe('normalizeEmail', () => {
    it('trims and lower-cases, so every spelling is the same user', () => {
      for (const raw of [
        'anna.weber@mueller-heiztechnik.example',
        '  Anna.Weber@Mueller-Heiztechnik.EXAMPLE ',
        'ANNA.WEBER@MUELLER-HEIZTECHNIK.EXAMPLE',
      ]) {
        expect(normalizeEmail(raw)).toBe(
          'anna.weber@mueller-heiztechnik.example',
        );
      }
    });

    it('accepts common address forms', () => {
      for (const email of [
        'a@b.de',
        'first.last+orders@sub.example.co.uk',
        "o'brien@example.ie",
      ]) {
        expect(normalizeEmail(email)).toBe(email);
      }
    });

    it('rejects what is no usable address', () => {
      for (const raw of [
        '',
        '   ',
        'anna.weber',
        'anna@',
        '@example.com',
        'anna@example',
        'anna@@example.com',
        'anna weber@example.com',
        'anna@exa mple.com',
        // A line break inside (one at the end is trimmed like a space)
        'anna@exam\nple.com',
        'jürgen@example.com',
        `${'a'.repeat(250)}@b.de`,
      ]) {
        expect(normalizeEmail(raw)).toBeNull();
      }
    });
  });

  describe('normalizeDisplayName', () => {
    it('trims the name', () => {
      expect(normalizeDisplayName('  Anna Weber ')).toBe('Anna Weber');
      expect(normalizeDisplayName('Jürgen Müller-Lüdenscheidt')).toBe(
        'Jürgen Müller-Lüdenscheidt',
      );
    });

    it('rejects blank, too long names and control characters', () => {
      for (const raw of ['', '   ', 'x'.repeat(101), 'Anna\nWeber', 'A\tB']) {
        expect(normalizeDisplayName(raw)).toBeNull();
      }
      expect(normalizeDisplayName('x'.repeat(100))).toHaveLength(100);
    });
  });

  it('recognizes UUIDs only', () => {
    expect(isUuid('8f0c6a1e-3b7d-4e7a-9c55-1f2a3b4c5d6e')).toBe(true);
    for (const text of [
      '',
      'user-1',
      '8f0c6a1e3b7d4e7a9c551f2a3b4c5d6e',
      "1' OR '1'='1",
    ]) {
      expect(isUuid(text)).toBe(false);
    }
  });

  it('names the violated rule with a code and a message', () => {
    const error = new ShopUserRuleError('UNIT_OF_OTHER_ACCOUNT');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('UNIT_OF_OTHER_ACCOUNT');
    expect(error.message).toBe(
      'The B2B unit belongs to another customer account than the shop user.',
    );
  });
});
