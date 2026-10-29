import {
  IsIn,
  Matches,
  ValidateBy,
  ValidateIf,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { COUNTRY_CODES } from './country-codes';
import { isCalendarDate } from './dates';

// Validation rules shared by several ERP modules (materials, customers, ...)

/**
 * Validate a field only when it is present. Unlike @IsOptional(),
 * this still rejects an explicit null, which the database would not accept.
 */
export function IfPresent() {
  return ValidateIf((_object, value) => value !== undefined);
}

/** Text with at least one visible character, so "   " is rejected */
export function IsNotBlank() {
  return Matches(/\S/, { message: '$property must not be blank' });
}

/**
 * A business key (material number, customer number, ...) must not be blank
 * and must not start or end with whitespace. It is rejected rather than
 * trimmed, so the key the client sends is exactly the key that is stored.
 * Pass `{ each: true }` to check every entry of a list.
 */
export function IsBusinessKey(options?: ValidationOptions) {
  return Matches(/^\S(.*\S)?$/s, {
    message: '$property must not be blank or start or end with whitespace',
    ...options,
  });
}

/** Calendar date as text in the form YYYY-MM-DD, e.g. 2026-11-15 */
export function IsCalendarDate() {
  return ValidateBy({
    name: 'isCalendarDate',
    validator: {
      validate: (value: unknown) => isCalendarDate(value),
      defaultMessage: (args?: ValidationArguments) =>
        `${args?.property} must be a valid date in the form YYYY-MM-DD (years 1900 to 9999)`,
    },
  });
}

/** Officially assigned ISO 3166-1 alpha-2 country code, e.g. DE */
export function IsCountryCode() {
  return IsIn(COUNTRY_CODES, {
    message:
      '$property must be a valid ISO 3166-1 alpha-2 country code (e.g. DE)',
  });
}
