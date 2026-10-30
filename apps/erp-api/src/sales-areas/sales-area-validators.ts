import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import {
  SALES_AREA_PART_PATTERN,
  SALES_ORGANIZATION_PATTERN,
} from './sales-area-key';

/** Sales organization code: 4 capital letters or digits, e.g. 1000 */
export function IsSalesOrganizationCode() {
  return applyDecorators(
    IsString(),
    Matches(SALES_ORGANIZATION_PATTERN, {
      message: '$property must be 4 capital letters or digits, e.g. 1000',
    }),
  );
}

/** Distribution channel or division code: 2 capital letters or digits */
export function IsSalesAreaPartCode() {
  return applyDecorators(
    IsString(),
    Matches(SALES_AREA_PART_PATTERN, {
      message: '$property must be 2 capital letters or digits, e.g. 10',
    }),
  );
}
