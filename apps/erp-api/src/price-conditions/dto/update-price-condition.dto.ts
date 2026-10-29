import { IsBoolean, IsOptional } from 'class-validator';
import { IfPresent, IsCalendarDate } from '../../common/validators';
import { IsAmount } from './price-condition-validators';

// conditionTypeCode, materialNumber, scope, soldToCustomerNumber, unitId and
// currency are intentionally not listed: they cannot be changed, and the
// ValidationPipe rejects unknown properties.
export class UpdatePriceConditionDto {
  @IfPresent()
  @IsAmount()
  amount?: string;

  @IfPresent()
  @IsCalendarDate()
  validFrom?: string;

  // Missing keeps the current end; null makes the condition open-ended
  @IsOptional()
  @IsCalendarDate()
  validTo?: string | null;

  @IfPresent()
  @IsBoolean()
  isActive?: boolean;
}
