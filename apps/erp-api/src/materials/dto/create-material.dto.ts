import { IsNotEmpty, IsString } from 'class-validator';
import { IsCurrencyCode, IsPrice } from './material-validators';

export class CreateMaterialDto {
  @IsString()
  @IsNotEmpty()
  materialNumber: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsPrice()
  price: number;

  @IsCurrencyCode()
  currency: string;
}
