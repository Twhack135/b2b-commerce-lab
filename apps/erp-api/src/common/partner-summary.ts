/** Short view of a customer used as account owner, member or partner */
export interface PartnerSummary {
  customerNumber: string;
  name: string;
  isActive: boolean;
}

export function toPartnerSummary(customer: {
  customerNumber: string;
  name: string;
  isActive: boolean;
}): PartnerSummary {
  return {
    customerNumber: customer.customerNumber,
    name: customer.name,
    isActive: customer.isActive,
  };
}
