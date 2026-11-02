import {
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateBy,
  ValidationArguments,
} from 'class-validator';
import {
  IsCustomerReference,
  UNIT_ID_MAX_LENGTH,
} from '../../b2b-units/dto/b2b-unit-validators';
import {
  IfPresent,
  IsBusinessKey,
  IsCalendarDate,
  IsNotBlank,
} from '../../common/validators';
import {
  IsSalesAreaPartCode,
  IsSalesOrganizationCode,
} from '../../sales-areas/sales-area-validators';

export const SEARCH_MAX_LENGTH = 100;
export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 100;

/** 10 digits, e.g. 1000000001 */
export const SALES_ORDER_NUMBER_PATTERN = /^\d{10}$/;

/** Filter on the header delivery block; NONE = orders without a block */
export const DELIVERY_BLOCK_FILTERS = ['SALES_REVIEW', 'NONE'] as const;
export type DeliveryBlockFilter = (typeof DELIVERY_BLOCK_FILTERS)[number];

/** The other parameters of the validated query */
function parametersOf(args?: ValidationArguments): Record<string, unknown> {
  return (args?.object ?? {}) as Record<string, unknown>;
}

/** The parameter may only be used together with all of `required` */
function RequiresParameters(...required: string[]) {
  return ValidateBy({
    name: 'requiresParameters',
    validator: {
      validate: (_value: unknown, args?: ValidationArguments) =>
        required.every((name) => parametersOf(args)[name] !== undefined),
      defaultMessage: (args?: ValidationArguments) =>
        `${args?.property} can only be used together with ${required.join(' and ')}`,
    },
  });
}

/** A date that must not be before the date in `fromProperty`, if given */
function NotBeforeDate(fromProperty: string) {
  return ValidateBy({
    name: 'notBeforeDate',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const from = parametersOf(args)[fromProperty];
        // Both are YYYY-MM-DD (checked separately), so text order is date order
        return (
          typeof from !== 'string' || typeof value !== 'string' || from <= value
        );
      },
      defaultMessage: (args?: ValidationArguments) =>
        `${args?.property} must not be before ${fromProperty}`,
    },
  });
}

/**
 * Query parameters of GET /sales-orders. All are optional and arrive as
 * text; a repeated parameter (an array) is rejected. Unknown parameters are
 * rejected by the global ValidationPipe (forbidNonWhitelisted).
 *
 * The sales area is filtered top-down like its key: a distribution channel
 * only within a sales organization, a division only within both, because
 * channel and division codes have no meaning of their own.
 */
export class ListSalesOrdersQueryDto {
  /**
   * A 10-digit sales order number is searched exactly; any other text in
   * the customer reference and the Sold-to number and name (contains,
   * case-insensitive). Leading and trailing spaces are ignored.
   */
  @IfPresent()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  @IsNotBlank()
  q?: string;

  @IfPresent()
  @IsSalesOrganizationCode()
  salesOrganization?: string;

  @IfPresent()
  @IsSalesAreaPartCode()
  @RequiresParameters('salesOrganization')
  distributionChannel?: string;

  @IfPresent()
  @IsSalesAreaPartCode()
  @RequiresParameters('salesOrganization', 'distributionChannel')
  division?: string;

  /** Exact customer number of the Sold-to */
  @IfPresent()
  @IsCustomerReference()
  soldTo?: string;

  @IfPresent()
  @IsString()
  @IsBusinessKey()
  @MaxLength(UNIT_ID_MAX_LENGTH)
  unitId?: string;

  @IfPresent()
  @IsIn(DELIVERY_BLOCK_FILTERS, {
    message: `deliveryBlock must be one of: ${DELIVERY_BLOCK_FILTERS.join(', ')}`,
  })
  deliveryBlock?: DeliveryBlockFilter;

  /** First order date included (YYYY-MM-DD) */
  @IfPresent()
  @IsCalendarDate()
  orderDateFrom?: string;

  /** Last order date included (YYYY-MM-DD) */
  @IfPresent()
  @IsCalendarDate()
  @NotBeforeDate('orderDateFrom')
  orderDateTo?: string;

  /** Page size, 1 to 100; default 25 */
  @IfPresent()
  @IsString()
  @Matches(/^(100|[1-9]\d?)$/, {
    message: `limit must be a whole number from 1 to ${MAX_LIST_LIMIT}`,
  })
  limit?: string;

  /** nextCursor of the previous page */
  @IfPresent()
  @IsString()
  @Matches(SALES_ORDER_NUMBER_PATTERN, {
    message: 'after must be the nextCursor of a previous page',
  })
  after?: string;
}
