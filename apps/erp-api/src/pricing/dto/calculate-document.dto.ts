import { IsString, MaxLength } from 'class-validator';
import { UNIT_ID_MAX_LENGTH } from '../../b2b-units/dto/b2b-unit-validators';
import { IsBusinessKey, IsCalendarDate } from '../../common/validators';
import {
  IsSalesAreaPartCode,
  IsSalesOrganizationCode,
} from '../../sales-areas/sales-area-validators';
import {
  IsOrderItems,
  SimulationItemDto,
} from '../../sales-orders/dto/simulate-sales-order.dto';

/**
 * A document to price with the pricing procedure of its sales area
 * (Sprint 13A). The same limits as the order simulation: up to 200 items,
 * whole quantities from 1 to 99999. Prices are never taken from a request.
 */
export class CalculateDocumentDto {
  @IsSalesOrganizationCode()
  salesOrganization: string;

  @IsSalesAreaPartCode()
  distributionChannel: string;

  @IsSalesAreaPartCode()
  division: string;

  // The Sold-to is taken from the unit
  @IsString()
  @IsBusinessKey()
  @MaxLength(UNIT_ID_MAX_LENGTH)
  unitId: string;

  // Required, so the result never depends on the server's clock
  @IsCalendarDate()
  pricingDate: string;

  @IsOrderItems(() => SimulationItemDto)
  items: SimulationItemDto[];
}
