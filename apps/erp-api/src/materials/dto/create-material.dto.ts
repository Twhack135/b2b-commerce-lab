import { IsString } from 'class-validator';
import { IsBusinessKey, IsNotBlank } from '../../common/validators';
import { IsCurrencyCode, IsPrice } from './material-validators';

export class CreateMaterialDto {
  @IsString()
  @IsBusinessKey()
  materialNumber: string;

  @IsString()
  @IsNotBlank()
  description: string;

  @IsPrice()
  price: number;

  @IsCurrencyCode()
  currency: string;
}
