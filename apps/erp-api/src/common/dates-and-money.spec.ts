import { Prisma } from '../generated/prisma/client';
import { fromDbDate, isCalendarDate, toDbDate } from './dates';
import { formatAmount, roundAmount } from './money';

describe('isCalendarDate', () => {
  it.each([
    '2026-01-01',
    '2026-12-31',
    '2028-02-29',
    '1900-01-01',
    '9999-12-31',
  ])('should accept %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each([
    ['February 30', '2026-02-30'],
    ['February 29 in a non-leap year', '2026-02-29'],
    ['month 13', '2026-13-01'],
    ['day 0', '2026-01-00'],
    ['a year before 1900', '1899-12-31'],
    ['a two-digit year', '0050-01-01'],
    ['a five-digit year', '10000-01-01'],
    ['a German date', '01.03.2026'],
    ['a missing leading zero', '2026-3-01'],
    ['a timestamp', '2026-03-01T00:00:00Z'],
    ['surrounding spaces', ' 2026-03-01 '],
    ['an empty text', ''],
    ['a number', 20260301],
    ['a Date object', new Date('2026-03-01')],
    ['null', null],
  ])('should reject %s', (_case, value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});

describe('toDbDate and fromDbDate', () => {
  it('should convert without shifting the day', () => {
    expect(toDbDate('2026-03-31').toISOString()).toBe(
      '2026-03-31T00:00:00.000Z',
    );
    expect(fromDbDate(toDbDate('2026-03-31'))).toBe('2026-03-31');
    expect(fromDbDate(toDbDate('9999-12-31'))).toBe('9999-12-31');
  });
});

describe('money', () => {
  const d = (value: string) => new Prisma.Decimal(value);

  it.each([
    ['4500', '4500.00'],
    ['199.5', '199.50'],
    ['0.01', '0.01'],
    ['9999999999.99', '9999999999.99'],
  ])('should format %s as %s', (value, text) => {
    expect(formatAmount(d(value))).toBe(text);
  });

  it.each([
    ['2.345', '2.35'],
    ['2.344', '2.34'],
    ['2.005', '2.01'],
    ['-2.345', '-2.35'],
  ])('should round %s half up to %s', (value, rounded) => {
    expect(roundAmount(d(value)).toFixed(2)).toBe(rounded);
  });

  it('should calculate exactly where floating point numbers do not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(formatAmount(d('0.1').plus(d('0.2')))).toBe('0.30');
  });
});
