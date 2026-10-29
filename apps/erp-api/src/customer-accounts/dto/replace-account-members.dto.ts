import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsBusinessKey } from '../../common/validators';
import { CUSTOMER_NUMBER_MAX_LENGTH } from '../../customers/dto/customer-validators';

export const MAX_ACCOUNT_MEMBERS = 500;

/** The complete list of members; it replaces the current list */
export class ReplaceAccountMembersDto {
  @IsArray()
  @ArrayMaxSize(MAX_ACCOUNT_MEMBERS)
  @ArrayUnique()
  @IsString({ each: true })
  @IsBusinessKey({ each: true })
  @MaxLength(CUSTOMER_NUMBER_MAX_LENGTH, { each: true })
  memberCustomerNumbers: string[];
}
