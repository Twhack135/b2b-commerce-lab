import { isLoopbackHostHeader } from './network-binding';

describe('isLoopbackHostHeader (DNS rebinding)', () => {
  it('accepts requests addressed to this computer, on any port', () => {
    for (const host of [
      '127.0.0.1:3000',
      '127.0.0.1',
      'localhost:3000',
      'LOCALHOST:3000',
      '[::1]:3000',
      '[::1]',
    ]) {
      expect(isLoopbackHostHeader(host)).toBe(true);
    }
  });

  it('refuses foreign names, even when they resolve to 127.0.0.1', () => {
    for (const host of [
      undefined,
      '',
      'attacker.example:3000',
      'localhost.attacker.example:3000',
      '127.0.0.1.nip.io:3000',
      'localhost.:3000',
      '127.0.0.2:3000',
      '0.0.0.0:3000',
      '127.0.0.1@attacker.example',
      '127.0.0.1:3000/path',
      '127.0.0.1:3000 attacker.example',
      '127.0.0.1:80',
    ]) {
      expect(isLoopbackHostHeader(host)).toBe(false);
    }
  });
});
