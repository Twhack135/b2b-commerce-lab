import { IsString } from 'class-validator';
import { IfPresent, IsNotBlank } from '../../common/validators';
import { IsCurrencyCode, IsPrice } from './material-validators';

// materialNumber is intentionally not listed here: the primary key
// cannot be changed, and the ValidationPipe rejects unknown properties.
export class UpdateMaterialDto {
  @IfPresent()
  @IsString()
  @IsNotBlank()
  description?: string;

  @IfPresent()
  @IsPrice()
  price?: number;

  @IfPresent()
  @IsCurrencyCode()
  currency?: string;
}
