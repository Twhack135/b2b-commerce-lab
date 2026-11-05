import { ConditionTypeSummary } from '../condition-types/condition-type.interface';
import { PriceConditionScope } from '../generated/prisma/enums';
import { SalesAreaKey } from '../sales-areas/sales-area-key';

// Read-only contracts of the pricing configuration (Sprint 13A, admin API)

export interface AccessSequenceAccess {
  accessNumber: number;
  conditionType: ConditionTypeSummary;
  scope: PriceConditionScope;
  /** The record must be for the material of the item */
  materialSpecific: boolean;
}

export interface AccessSequence {
  code: string;
  name: string;
  /** In the order they are searched; the first valid record wins */
  accesses: AccessSequenceAccess[];
}

export interface PricingProcedureStepInfo {
  stepNumber: number;
  kind: 'CONDITION' | 'SUBTOTAL';
  label: string;
  /** CONDITION: how the record is found */
  accessSequence: AccessSequence | null;
  /** The calculation base: steps fromStep..toStep */
  fromStep: number | null;
  toStep: number | null;
  statistical: boolean;
  mandatory: boolean;
  /** SUBTOTAL: the name of the value, e.g. NET_VALUE */
  subtotalKey: string | null;
  customerVisible: boolean;
}

export interface PricingProcedureAssignment extends SalesAreaKey {
  /** '*' for every customer */
  customerProcedure: string;
}

export interface PricingProcedureSummary {
  code: string;
  name: string;
  revision: number;
  isActive: boolean;
  /** The sales areas that use this procedure */
  assignments: PricingProcedureAssignment[];
  stepCount: number;
}

export interface PricingProcedureDetail extends PricingProcedureSummary {
  steps: PricingProcedureStepInfo[];
}
