import { ConditionTypeSummary } from '../condition-types/condition-type.interface';
import { PriceConditionScope } from '../generated/prisma/enums';
import { SalesAreaKey } from '../sales-areas/sales-area-key';
import { AccessResult } from './engine/procedure';

// Result of POST /pricing/calculate (Sprint 13A, admin API). Amounts are
// decimal strings in the decimal places of the document currency (JPY:
// none). It explains every value: the procedure and revision, each step,
// each access of an access sequence and the record that was used.

export interface DocumentPricingAccess {
  accessNumber: number;
  conditionTypeCode: string;
  scope: PriceConditionScope;
  /** APPLIED: used; FOUND_NOT_USED: valid, but an earlier access won */
  result: AccessResult;
  conditionId: number | null;
}

export interface DocumentPricingConditionLine {
  step: number;
  kind: 'CONDITION';
  label: string;
  statistical: boolean;
  mandatory: boolean;
  conditionId: number | null;
  conditionType: ConditionTypeSummary | null;
  scope: PriceConditionScope | null;
  validFrom: string | null;
  validTo: string | null;
  /** Amount per unit of the record */
  rate: string | null;
  quantity: number;
  value: string | null;
  accessSequence: string;
  accesses: DocumentPricingAccess[];
}

export interface DocumentPricingSubtotalLine {
  step: number;
  kind: 'SUBTOTAL';
  label: string;
  key: string;
  fromStep: number;
  toStep: number;
  value: string | null;
}

export interface DocumentPricingMessage {
  code: 'MANDATORY_CONDITION_MISSING';
  itemNumber: number;
  step: number;
  text: string;
}

export interface DocumentPricingItem {
  /** 10, 20, 30, … in request order, as in the order simulation */
  itemNumber: number;
  materialNumber: string;
  materialDescription: string;
  quantity: number;
  status: 'PRICED' | 'INCOMPLETE';
  lines: (DocumentPricingConditionLine | DocumentPricingSubtotalLine)[];
  netValue: string | null;
  messages: DocumentPricingMessage[];
}

export interface DocumentPricingResult {
  status: 'COMPLETE' | 'INCOMPLETE';
  procedure: { code: string; name: string; revision: number };
  salesArea: SalesAreaKey;
  unitId: string;
  soldToCustomerNumber: string;
  pricingDate: string;
  currency: { code: string; decimals: number };
  items: DocumentPricingItem[];
  totals: { netValue: string | null };
  messages: DocumentPricingMessage[];
}
