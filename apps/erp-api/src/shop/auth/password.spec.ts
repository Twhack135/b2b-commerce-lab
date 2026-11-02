import { argon2Sync } from 'node:crypto';
import {
  assertArgon2Available,
  dummyPasswordHash,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblems,
  verifyPassword,
} from './password';

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'anna.weber@mueller.example';

describe('shop passwords', () => {
  it('uses the Argon2id of Node.js (fails closed without it)', () => {
    expect(() => assertArgon2Available()).not.toThrow();
  });

  it('is genuine Argon2id version 1.3 (test vector of RFC 9106, section 5.3)', () => {
    const tag = argon2Sync('argon2id', {
      message: Buffer.alloc(32, 0x01),
      nonce: Buffer.alloc(16, 0x02),
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });

  describe('hashing', () => {
    it('encodes salt and hash as unpadded base64 (PHC string format)', async () => {
      const [empty, algorithm, version, params, salt, hash] = (
        await hashPassword(PASSWORD)
      ).split('$');
      expect([empty, algorithm, version, params]).toEqual([
        '',
        'argon2id',
        'v=19',
        'm=19456,t=2,p=1',
      ]);
      expect(Buffer.from(salt, 'base64')).toHaveLength(16);
      expect(Buffer.from(hash, 'base64')).toHaveLength(32);
      expect(salt + hash).not.toContain('=');
    });

    it('verifies with the parameters stored in the hash, also other ones', async () => {
      const salt = Buffer.alloc(16, 7);
      const tag = argon2Sync('argon2id', {
        message: Buffer.from(PASSWORD),
        nonce: salt,
        parallelism: 4,
        tagLength: 24,
        memory: 65536,
        passes: 3,
      });
      const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
      const stored = `$argon2id$v=19$m=65536,t=3,p=4$${b64(salt)}$${b64(tag)}`;
      expect(await verifyPassword(PASSWORD, stored)).toBe(true);
      expect(await verifyPassword(`${PASSWORD}!`, stored)).toBe(false);
    });

    it('stores an Argon2id PHC string with OWASP parameters and a random salt', async () => {
      const a = await hashPassword(PASSWORD);
      const b = await hashPassword(PASSWORD);
      expect(a).toMatch(
        /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
      );
      expect(a).not.toBe(b);
      expect(a).not.toContain(PASSWORD);
    });

    it('verifies the right password only', async () => {
      const stored = await hashPassword(PASSWORD);
      expect(await verifyPassword(PASSWORD, stored)).toBe(true);
      for (const wrong of [
        '',
        'correct horse battery stapl',
        `${PASSWORD} `,
        'CORRECT HORSE BATTERY STAPLE',
      ]) {
        expect(await verifyPassword(wrong, stored)).toBe(false);
      }
    });

    it('treats Unicode spellings of the same text as equal (NFKC)', async () => {
      // "ﬁ" (ligature) and "fi", composed and decomposed umlaut
      const stored = await hashPassword('ﬁnanzbuchhaltung müller');
      expect(await verifyPassword('finanzbuchhaltung müller', stored)).toBe(
        true,
      );
    });

    it('never matches or throws for malformed or tampered hashes', async () => {
      const stored = await hashPassword(PASSWORD);
      const [, , , params, salt, hash] = stored.split('$');
      for (const bad of [
        '',
        PASSWORD,
        'plain:text',
        stored.replace('argon2id', 'argon2i'),
        stored.replace('v=19', 'v=16'),
        `$argon2id$v=19$m=999999999,t=2,p=1$${salt}$${hash}`,
        `$argon2id$v=19$m=19456,t=999,p=1$${salt}$${hash}`,
        `$argon2id$v=19$m=7,t=2,p=1$${salt}$${hash}`,
        `$argon2id$v=19$${params}$${salt}$`,
        `$argon2id$v=19$${params}$$${hash}`,
        `$argon2id$v=19$${params}$${salt}$${hash.slice(0, -2)}AA`,
        `${stored}$extra`,
      ]) {
        await expect(verifyPassword(PASSWORD, bad)).resolves.toBe(false);
      }
    });

    it('offers a dummy hash with the same cost for unknown users', async () => {
      const dummy = await dummyPasswordHash();
      expect(dummy).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(await verifyPassword(PASSWORD, dummy)).toBe(false);
      expect(await dummyPasswordHash()).toBe(dummy);
    });
  });

  describe('policy (NIST SP 800-63B Rev. 4)', () => {
    it('accepts a long passphrase without composition rules', () => {
      expect(passwordProblems(PASSWORD, EMAIL)).toEqual([]);
      expect(passwordProblems('a'.repeat(14) + 'b', EMAIL)).toEqual([]);
      expect(passwordProblems('Grüße aus Stuttgart!', EMAIL)).toEqual([]);
    });

    it(`requires ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`, () => {
      expect(passwordProblems('a'.repeat(13) + 'b', EMAIL)).toEqual([
        'The password must have at least 15 characters.',
      ]);
      expect(passwordProblems('ab'.repeat(65), EMAIL)).toEqual([
        'The password must have at most 128 characters.',
      ]);
      // Characters, not UTF-16 units: 15 emoji are 15 characters
      expect(passwordProblems('🔑'.repeat(14) + '🔒', EMAIL)).toEqual([]);
    });

    it('rejects repeated characters, common values and the e-mail address', () => {
      expect(passwordProblems(' '.repeat(20), EMAIL)).toEqual([
        'The password must not consist of one repeated character.',
      ]);
      expect(passwordProblems('a'.repeat(20), EMAIL)).toEqual([
        'The password must not consist of one repeated character.',
      ]);
      expect(passwordProblems('PasswordPassword', EMAIL)).toEqual([
        'The password is too common. Choose another one.',
      ]);
      expect(passwordProblems('anna.weber@mueller.example', EMAIL)).toEqual([
        'The password must not contain your e-mail address.',
      ]);
      expect(passwordProblems('my name is anna.weber, hi', EMAIL)).toEqual([
        'The password must not contain your e-mail address.',
      ]);
    });
  });
});
