import { IsString } from 'class-validator';
import {
  IsCurrencyCode,
  IsMaterialNumber,
  IsNotBlank,
  IsPrice,
} from './material-validators';

export class CreateMaterialDto {
  @IsString()
  @IsMaterialNumber()
  materialNumber: string;

  @IsString()
  @IsNotBlank()
  description: string;

  @IsPrice()
  price: number;

  @IsCurrencyCode()
  currency: string;
}
