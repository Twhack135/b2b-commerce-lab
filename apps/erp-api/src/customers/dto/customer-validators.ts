import { Matches } from 'class-validator';

// Field lengths, matching the VARCHAR columns in prisma/schema.prisma
export const CUSTOMER_NUMBER_MAX_LENGTH = 20;
export const NAME_MAX_LENGTH = 100;
export const STREET_MAX_LENGTH = 100;
export const POSTAL_CODE_MAX_LENGTH = 10;
export const CITY_MAX_LENGTH = 60;

/**
 * Letters, digits, spaces and hyphens, starting and ending with a letter or
 * digit (e.g. 20457, 1070, SW1A 1AA, 00-950). Country-specific formats are
 * not checked yet.
 */
export function IsPostalCode() {
  return Matches(/^[A-Za-z0-9]([A-Za-z0-9 -]*[A-Za-z0-9])?$/, {
    message:
      'postalCode may only contain letters, digits, spaces and hyphens and must start and end with a letter or digit',
  });
}
