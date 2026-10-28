import { applyDecorators } from '@nestjs/common';
import {
  IsNumber,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidationArguments,
} from 'class-validator';

// Largest value that fits into the database column Decimal(12, 2)
const MAX_PRICE = 9999999999.99;

/**
 * A price must be a positive number with at most two decimal places.
 * Prices like 1.999 are rejected instead of silently rounded.
 */
export function IsPrice() {
  return applyDecorators(
    IsNumber({ allowNaN: false, allowInfinity: false }),
    Min(0.01),
    Max(MAX_PRICE),
    ValidateBy({
      name: 'hasAtMostTwoDecimals',
      validator: {
        // Rounding to two decimals must not change the value.
        // (class-validator's own maxDecimalPlaces crashes on values like 1e-7)
        validate: (value: unknown) =>
          typeof value === 'number' && Number(value.toFixed(2)) === value,
        defaultMessage: (args?: ValidationArguments) =>
          `${args?.property} must have at most two decimal places`,
      },
    }),
  );
}

/** Text with at least one visible character, so "   " is rejected */
export function IsNotBlank() {
  return Matches(/\S/, { message: '$property must not be blank' });
}

/**
 * A material number must not be blank and must not start or end with
 * whitespace. It is rejected rather than trimmed, so the key the client
 * sends is exactly the key that is stored.
 */
export function IsMaterialNumber() {
  return Matches(/^\S(.*\S)?$/s, {
    message: 'materialNumber must not be blank or start or end with whitespace',
  });
}

/** ISO 4217 style currency code, e.g. EUR */
export function IsCurrencyCode() {
  return Matches(/^[A-Z]{3}$/, {
    message: 'currency must be exactly three uppercase letters (e.g. EUR)',
  });
}
