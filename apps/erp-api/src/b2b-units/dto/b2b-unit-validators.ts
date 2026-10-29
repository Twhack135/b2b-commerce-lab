import { applyDecorators } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsBusinessKey } from '../../common/validators';
import { CUSTOMER_NUMBER_MAX_LENGTH } from '../../customers/dto/customer-validators';

// Field lengths, matching the VARCHAR columns in prisma/schema.prisma
export const UNIT_ID_MAX_LENGTH = 20;
export const UNIT_NAME_MAX_LENGTH = 100;
export const MAX_SHIP_TOS = 50;

/** Reference to an existing customer by its customer number */
export function IsCustomerReference() {
  return applyDecorators(
    IsString(),
    IsBusinessKey(),
    MaxLength(CUSTOMER_NUMBER_MAX_LENGTH),
  );
}

/** Complete list of allowed ship-to customers: 1 to 50, no duplicates */
export function IsShipToList() {
  return applyDecorators(
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(MAX_SHIP_TOS),
    ArrayUnique(),
    IsString({ each: true }),
    IsBusinessKey({ each: true }),
    MaxLength(CUSTOMER_NUMBER_MAX_LENGTH, { each: true }),
  );
}
