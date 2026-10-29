// Form, filter and display logic for price conditions.
// Mirrors the ERP API rules (apps/erp-api/src/price-conditions) so users get
// feedback before submitting. The ERP API stays the authoritative check,
// e.g. for overlapping validity periods.
// Only type imports and import-free helpers, so it can be tested directly
// with `node --test`.
import type { B2bUnit } from "./b2b-units.ts";
import type { ConditionType } from "./condition-types.ts";
import type { Customer } from "./customers.ts";
import { isCalendarDate } from "./dates.ts";
import type { Material } from "./materials.ts";
import { amountError, normalizeAmount } from "./money.ts";
import type {
  CreatePriceConditionInput,
  PriceCondition,
  PriceConditionScope,
  UpdatePriceConditionInput,
} from "./price-conditions.ts";

export const SCOPE_LABELS: Record<PriceConditionScope, string> = {
  B2B_UNIT: "B2B Unit",
  SOLD_TO: "Sold-to",
};

/** Field names are the ERP API names, so API errors map 1:1 */
export type PriceConditionFormValues = {
  /** e.g. ZP02; chosen when creating, fixed afterwards */
  conditionTypeCode: string;
  materialNumber: string;
  scope: PriceConditionScope | "";
  soldToCustomerNumber: string;
  unitId: string;
  amount: string;
  validFrom: string;
  /** Empty means open-ended */
  validTo: string;
  isActive: boolean;
};

export type PriceConditionFormField = Exclude<
  keyof PriceConditionFormValues,
  "isActive"
>;

export type PriceConditionFieldErrors = Partial<
  Record<PriceConditionFormField, string>
>;

export const PRICE_CONDITION_FIELDS: PriceConditionFormField[] = [
  "conditionTypeCode",
  "materialNumber",
  "scope",
  "soldToCustomerNumber",
  "unitId",
  "amount",
  "validFrom",
  "validTo",
];

/** Readable names for ERP API messages such as "unitId U1 is inactive" */
export const PRICE_CONDITION_LABELS: Partial<Record<PriceConditionFormField, string>> = {
  conditionTypeCode: "Condition type",
  materialNumber: "Material",
  soldToCustomerNumber: "Sold-to",
  unitId: "B2B unit",
};

/** A new condition starts today and is open-ended */
export function emptyConditionForm(today: string): PriceConditionFormValues {
  return {
    conditionTypeCode: "",
    materialNumber: "",
    scope: "",
    soldToCustomerNumber: "",
    unitId: "",
    amount: "",
    validFrom: today,
    validTo: "",
    isActive: true,
  };
}

export function conditionToForm(
  condition: PriceCondition,
): PriceConditionFormValues {
  return {
    conditionTypeCode: condition.conditionType.code,
    materialNumber: condition.materialNumber,
    scope: condition.scope,
    soldToCustomerNumber: condition.soldTo?.customerNumber ?? "",
    unitId: condition.unit?.unitId ?? "",
    amount: condition.amount,
    validFrom: condition.validFrom,
    validTo: condition.validTo ?? "",
    isActive: condition.isActive,
  };
}

export type SoldToOption = {
  customerNumber: string;
  name: string;
  isActive: boolean;
};

export type UnitOption = {
  unitId: string;
  name: string;
  soldToCustomerNumber: string;
  /** Only active units with an active Sold-to can get a new price */
  isSelectable: boolean;
  /** Why the unit cannot be selected */
  note?: string;
};

export function soldToOptions(customers: Customer[]): SoldToOption[] {
  return customers.map((c) => ({
    customerNumber: c.customerNumber,
    name: c.name,
    isActive: c.isActive,
  }));
}

export function unitOptions(units: B2bUnit[]): UnitOption[] {
  return units.map((unit) => ({
    unitId: unit.unitId,
    name: unit.name,
    soldToCustomerNumber: unit.soldTo.customerNumber,
    isSelectable: unit.isActive && unit.soldTo.isActive,
    note: !unit.isActive
      ? "inactive"
      : !unit.soldTo.isActive
        ? `inactive Sold-to ${unit.soldTo.customerNumber}`
        : undefined,
  }));
}

type ValidationContext = {
  mode: "create" | "edit";
  materials: Material[];
  customers: Customer[];
  units: B2bUnit[];
  /** The condition types; may be missing while they load */
  conditionTypes?: ConditionType[];
  /** The stored condition when editing */
  original?: PriceCondition;
};

export function validatePriceConditionForm(
  values: PriceConditionFormValues,
  { mode, materials, customers, units, conditionTypes = [], original }: ValidationContext,
): PriceConditionFieldErrors {
  const errors: PriceConditionFieldErrors = {};

  // A new or reactivated condition needs an active Sold-to or unit, and a
  // unit also needs an active Sold-to. An active condition may keep a
  // Sold-to or unit that became inactive later.
  const needsActivePartners =
    mode === "create" || (values.isActive && original?.isActive === false);

  if (mode === "create") {
    // Whether a type can be used is decided by the ERP API and shown in
    // usableForPriceConditions; the form only repeats that answer
    const conditionType = conditionTypes.find(
      (t) => t.code === values.conditionTypeCode,
    );
    if (values.conditionTypeCode === "") {
      errors.conditionTypeCode = "Select a condition type.";
    } else if (conditionType && !conditionType.usableForPriceConditions) {
      errors.conditionTypeCode = `Condition type ${conditionType.code} cannot be used for new price conditions.`;
    }
    if (values.materialNumber === "") {
      errors.materialNumber = "Select a material.";
    } else if (!materials.some((m) => m.materialNumber === values.materialNumber)) {
      errors.materialNumber = `Material ${values.materialNumber} does not exist.`;
    }
    if (values.scope === "") {
      errors.scope = "Select whether the price is for a B2B unit or a Sold-to.";
    }
  }

  if (values.scope === "SOLD_TO") {
    const number = values.soldToCustomerNumber;
    if (number === "") {
      errors.soldToCustomerNumber = "Select a Sold-to customer.";
    } else if (needsActivePartners) {
      const customer =
        customers.find((c) => c.customerNumber === number) ??
        (original?.soldTo ?? undefined);
      if (!customer) {
        errors.soldToCustomerNumber = `Customer ${number} does not exist.`;
      } else if (!customer.isActive) {
        errors.soldToCustomerNumber = `Customer ${number} is inactive. Only active customers can get an active price.`;
      }
    }
  }

  if (values.scope === "B2B_UNIT") {
    const unitId = values.unitId;
    if (unitId === "") {
      errors.unitId = "Select a B2B unit.";
    } else if (needsActivePartners) {
      const unit =
        units.find((u) => u.unitId === unitId) ?? (original?.unit ?? undefined);
      if (!unit) {
        errors.unitId = `B2B unit ${unitId} does not exist.`;
      } else if (!unit.isActive) {
        errors.unitId = `B2B unit ${unitId} is inactive. Only active units can get an active price.`;
      } else if (!unit.soldTo.isActive) {
        errors.unitId = `The Sold-to ${unit.soldTo.customerNumber} of B2B unit ${unitId} is inactive.`;
      }
    }
  }

  const amount = amountError(values.amount);
  if (amount) errors.amount = amount;

  if (values.validFrom === "") {
    errors.validFrom = "Valid from is required.";
  } else if (!isCalendarDate(values.validFrom)) {
    errors.validFrom = "Enter a valid date.";
  }
  if (values.validTo !== "") {
    if (!isCalendarDate(values.validTo)) {
      errors.validTo = "Enter a valid date or leave it empty for open-ended.";
    } else if (!errors.validFrom && values.validTo < values.validFrom) {
      errors.validTo = "Valid to must not be before valid from.";
    }
  }

  return errors;
}

/** Only call this for values without errors */
export function toCreateInput(
  values: PriceConditionFormValues,
  materials: Material[],
): CreatePriceConditionInput {
  const material = materials.find(
    (m) => m.materialNumber === values.materialNumber,
  );
  if (!material || values.scope === "") {
    throw new Error("toCreateInput needs validated values");
  }
  return {
    conditionTypeCode: values.conditionTypeCode,
    materialNumber: values.materialNumber,
    scope: values.scope,
    // Only the key of the chosen scope is sent
    ...(values.scope === "SOLD_TO"
      ? { soldToCustomerNumber: values.soldToCustomerNumber }
      : { unitId: values.unitId }),
    amount: normalizeAmount(values.amount),
    // Always the currency of the material; it cannot be chosen
    currency: material.currency,
    validFrom: values.validFrom,
    validTo: values.validTo === "" ? null : values.validTo,
    isActive: values.isActive,
  };
}

/** Only call this for values without errors */
export function toUpdateInput(
  values: PriceConditionFormValues,
): UpdatePriceConditionInput {
  return {
    amount: normalizeAmount(values.amount),
    validFrom: values.validFrom,
    validTo: values.validTo === "" ? null : values.validTo,
    isActive: values.isActive,
  };
}

/** The ID of the condition named in an overlap error (HTTP 409) */
export function conflictingConditionId(messages: string[]): number | undefined {
  for (const message of messages) {
    const match = /overlaps with active price condition (\d+)/.exec(message);
    if (match) return Number(match[1]);
  }
  return undefined;
}

export type ValidityStatus = "current" | "future" | "expired" | "inactive";

export const VALIDITY_LABELS: Record<ValidityStatus, string> = {
  current: "Valid today",
  future: "Future",
  expired: "Expired",
  inactive: "Inactive",
};

/** Validity on the given day (YYYY-MM-DD) */
export function validityStatus(
  condition: Pick<PriceCondition, "isActive" | "validFrom" | "validTo">,
  today: string,
): ValidityStatus {
  if (!condition.isActive) return "inactive";
  if (condition.validFrom > today) return "future";
  if (condition.validTo !== null && condition.validTo < today) return "expired";
  return "current";
}

/** Inactive Sold-to or unit of a stored condition */
export function conditionWarnings(condition: PriceCondition): string[] {
  const warnings: string[] = [];
  if (condition.soldTo && !condition.soldTo.isActive) {
    warnings.push(`Sold-to ${condition.soldTo.customerNumber} is inactive`);
  }
  if (condition.unit) {
    if (!condition.unit.isActive) {
      warnings.push(`B2B unit ${condition.unit.unitId} is inactive`);
    }
    if (!condition.unit.soldTo.isActive) {
      warnings.push(
        `Sold-to ${condition.unit.soldTo.customerNumber} of the unit is inactive`,
      );
    }
  }
  return warnings;
}

export type ConditionFilter = {
  /** "" for all materials */
  materialNumber: string;
  /** "" for all scopes */
  scope: PriceConditionScope | "";
  /** "" for all condition types */
  conditionTypeCode?: string;
  status: "all" | "active" | "inactive";
  search: string;
};

export function filterConditions(
  conditions: PriceCondition[],
  filter: ConditionFilter,
): PriceCondition[] {
  const query = filter.search.trim().toLowerCase();
  return conditions.filter(
    (c) =>
      (filter.materialNumber === "" ||
        c.materialNumber === filter.materialNumber) &&
      (filter.scope === "" || c.scope === filter.scope) &&
      (!filter.conditionTypeCode ||
        c.conditionType.code === filter.conditionTypeCode) &&
      (filter.status === "all" || c.isActive === (filter.status === "active")) &&
      [
        c.conditionType.code,
        c.conditionType.name,
        c.materialNumber,
        c.materialDescription,
        c.soldTo?.customerNumber,
        c.soldTo?.name,
        c.unit?.unitId,
        c.unit?.name,
        c.unit?.soldTo.customerNumber,
      ].some((text) => text?.toLowerCase().includes(query)),
  );
}
