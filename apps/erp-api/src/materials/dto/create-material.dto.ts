import { IsString } from 'class-validator';
import { IfPresent, IsBusinessKey, IsNotBlank } from '../../common/validators';
import { IsCurrencyCode, IsPrice } from './material-validators';

export class CreateMaterialDto {
  @IsString()
  @IsBusinessKey()
  materialNumber: string;

  @IsString()
  @IsNotBlank()
  description: string;

  // DEPRECATED since Sprint 9C-B: optional and stored only for older
  // clients. List prices are ZP01 price conditions per sales area; these
  // values are never used for price determination.
  @IfPresent()
  @IsPrice()
  price?: number;

  @IfPresent()
  @IsCurrencyCode()
  currency?: string;
}
