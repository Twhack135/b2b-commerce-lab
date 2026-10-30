import {
  IsSalesAreaPartCode,
  IsSalesOrganizationCode,
} from '../../sales-areas/sales-area-validators';

/** Assigns the customer to a sales area; new assignments are active */
export class CreateCustomerSalesAreaDto {
  @IsSalesOrganizationCode()
  salesOrganization: string;

  @IsSalesAreaPartCode()
  distributionChannel: string;

  @IsSalesAreaPartCode()
  division: string;
}
