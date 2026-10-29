import { PartnerSummary } from '../common/partner-summary';

/** A customer account, represented by its owner customer */
export interface CustomerAccount {
  accountCustomerNumber: string;
  name: string;
  isActive: boolean;
  /** Other customers of the account; the owner is not listed here */
  members: PartnerSummary[];
}
