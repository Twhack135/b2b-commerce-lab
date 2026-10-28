import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { IsCurrencyCode, IsPrice } from './material-validators';

// Skip validation only when a field is missing. Unlike @IsOptional(),
// this still rejects an explicit null, which the database would not accept.
const IfPresent = () => ValidateIf((_object, value) => value !== undefined);

// materialNumber is intentionally not listed here: the primary key
// cannot be changed, and the ValidationPipe rejects unknown properties.
export class UpdateMaterialDto {
  @IfPresent()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IfPresent()
  @IsPrice()
  price?: number;

  @IfPresent()
  @IsCurrencyCode()
  currency?: string;
}
