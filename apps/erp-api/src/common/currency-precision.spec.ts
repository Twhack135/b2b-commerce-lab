import { Prisma } from '../generated/prisma/client';
import {
  currencyPrecisionError,
  fitsCurrency,
  formatAmount,
  formatInCurrency,
  roundToCurrency,
} from './money';

const d = (value: string) => new Prisma.Decimal(value);

// Configured like the currencies table: EUR and PLN 2, JPY 0
const EUR = { code: 'EUR', decimals: 2 };
const PLN = { code: 'PLN', decimals: 2 };
const JPY = { code: 'JPY', decimals: 0 };

describe('currency precision', () => {
  it('formats with the decimal places of the currency', () => {
    expect(formatInCurrency(d('4400'), EUR)).toBe('4400.00');
    expect(formatInCurrency(d('189.5'), PLN)).toBe('189.50');
    expect(formatInCurrency(d('700000'), JPY)).toBe('700000');
    // A JPY amount as it comes from a DECIMAL(12, 2) column
    expect(formatInCurrency(d('700000.00'), JPY)).toBe('700000');
  });

  it('keeps the existing EUR behaviour of formatAmount', () => {
    expect(formatAmount(d('4400'))).toBe(formatInCurrency(d('4400'), EUR));
    expect(formatAmount(d('10695'))).toBe('10695.00');
  });

  it.each([
    ['0.005', EUR, '0.01'],
    ['0.004', EUR, '0.00'],
    ['10.125', PLN, '10.13'],
    ['1234.5', JPY, '1235'],
    ['1234.49', JPY, '1234'],
  ])('rounds %s half up for %p', (value, currency, expected) => {
    expect(roundToCurrency(d(value), currency).toFixed(currency.decimals)).toBe(
      expected,
    );
  });

  it.each([
    ['4400.00', JPY, true],
    ['4400', JPY, true],
    ['4400.5', JPY, false],
    ['0.01', JPY, false],
    ['4400.50', EUR, true],
    ['4400.505', EUR, false],
    ['12.34', PLN, true],
    ['12.345', PLN, false],
  ])('checks whether %s fits %p', (value, currency, fits) => {
    expect(fitsCurrency(d(value), currency)).toBe(fits);
  });

  it('explains amounts that do not fit and accepts those that do', () => {
    expect(currencyPrecisionError('amount', d('4400.5'), JPY)).toBe(
      'amount must be a whole amount: JPY has no decimal places',
    );
    expect(currencyPrecisionError('amount', d('1.005'), PLN)).toBe(
      'amount must have at most 2 decimal places for PLN',
    );
    expect(currencyPrecisionError('amount', d('4400'), JPY)).toBeNull();
    expect(currencyPrecisionError('amount', d('4400.50'), EUR)).toBeNull();
  });
});
