import { applyDecorators } from '@nestjs/common';
import {
  IsString,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
  ValidationArguments,
} from 'class-validator';
import { IsBusinessKey } from '../../common/validators';
import { PriceConditionScope } from '../../generated/prisma/enums';

// At most 10 digits before and 2 after the point, as in DECIMAL(12, 2)
const AMOUNT_PATTERN = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;

/**
 * An amount is a decimal string such as "4200.50", greater than 0, with at
 * most two decimal places. It is text instead of a JSON number, so it is
 * never changed by floating-point conversion. Values like "1.999" are
 * rejected instead of silently rounded.
 */
export function IsAmount() {
  return applyDecorators(
    IsString(),
    Matches(AMOUNT_PATTERN, {
      message:
        '$property must be a decimal string with at most 10 digits before and 2 after the point (e.g. "4200.50")',
    }),
    ValidateBy({
      name: 'isPositiveAmount',
      validator: {
        // Only checked further if the format is right; "0.00" is not a price
        validate: (value: unknown) =>
          typeof value === 'string' &&
          (!AMOUNT_PATTERN.test(value) || /[1-9]/.test(value)),
        defaultMessage: (args?: ValidationArguments) =>
          `${args?.property} must be greater than 0`,
      },
    }),
  );
}

/**
 * The key field of one scope, e.g. soldToCustomerNumber for SOLD_TO.
 * It is required for that scope and must not be sent for any other scope.
 */
export function IsScopeKey(scope: PriceConditionScope, maxLength: number) {
  return applyDecorators(
    ValidateIf(
      (object: { scope?: unknown }, value) =>
        object.scope === scope || value !== undefined,
    ),
    ValidateBy({
      name: 'isOnlyForScope',
      validator: {
        validate: (_value, args?: ValidationArguments) =>
          (args?.object as { scope?: unknown } | undefined)?.scope === scope,
        defaultMessage: (args?: ValidationArguments) =>
          `${args?.property} is only allowed when scope is ${scope}`,
      },
    }),
    IsString(),
    IsBusinessKey(),
    MaxLength(maxLength),
  );
}
