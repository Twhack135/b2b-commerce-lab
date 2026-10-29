// Form logic for B2B units: values, validation and partner selection.
// Mirrors the ERP API rules (apps/erp-api/src/b2b-units) so users get
// feedback before submitting. The ERP API stays the authoritative check.
// Only type imports, so it can be tested directly with `node --test`.
import type {
  B2bUnit,
  CreateB2bUnitInput,
  PartnerSummary,
  UpdateB2bUnitInput,
} from "./b2b-units.ts";
import type { CustomerAccount } from "./customer-accounts.ts";

export const UNIT_ID_MAX_LENGTH = 20;
export const UNIT_NAME_MAX_LENGTH = 100;
export const MAX_SHIP_TOS = 50;

/** Field names are the ERP API names, so API errors map 1:1 */
export type B2bUnitFormValues = {
  unitId: string;
  name: string;
  accountCustomerNumber: string;
  soldToCustomerNumber: string;
  billToCustomerNumber: string;
  payerCustomerNumber: string;
  shipToCustomerNumbers: string[];
  defaultShipToCustomerNumber: string;
  isActive: boolean;
};

export type B2bUnitFormField = Exclude<keyof B2bUnitFormValues, "isActive">;

export type B2bUnitFieldErrors = Partial<Record<B2bUnitFormField, string>>;

export const B2B_UNIT_FIELDS: B2bUnitFormField[] = [
  "unitId",
  "name",
  "accountCustomerNumber",
  "soldToCustomerNumber",
  "billToCustomerNumber",
  "payerCustomerNumber",
  "shipToCustomerNumbers",
  "defaultShipToCustomerNumber",
];

/** Single-valued partner functions and their labels */
export const PARTNER_ROLES = [
  { field: "soldToCustomerNumber", label: "Sold-to" },
  { field: "billToCustomerNumber", label: "Bill-to" },
  { field: "payerCustomerNumber", label: "Payer" },
] as const;

export function emptyUnitForm(): B2bUnitFormValues {
  return {
    unitId: "",
    name: "",
    accountCustomerNumber: "",
    soldToCustomerNumber: "",
    billToCustomerNumber: "",
    payerCustomerNumber: "",
    shipToCustomerNumbers: [],
    defaultShipToCustomerNumber: "",
    isActive: true,
  };
}

export function unitToForm(unit: B2bUnit): B2bUnitFormValues {
  return {
    unitId: unit.unitId,
    name: unit.name,
    accountCustomerNumber: unit.account.customerNumber,
    soldToCustomerNumber: unit.soldTo.customerNumber,
    billToCustomerNumber: unit.billTo.customerNumber,
    payerCustomerNumber: unit.payer.customerNumber,
    shipToCustomerNumbers: unit.shipTos.map((s) => s.customerNumber),
    defaultShipToCustomerNumber: unit.defaultShipToCustomerNumber,
    isActive: unit.isActive,
  };
}

// ---------------------------------------------------------------------------
// Partner selection
// ---------------------------------------------------------------------------

/** Customers that may be partners of the account: the owner and members */
export function accountPartners(account: CustomerAccount | undefined): PartnerSummary[] {
  if (!account) return [];
  return [
    {
      customerNumber: account.accountCustomerNumber,
      name: account.name,
      isActive: account.isActive,
    },
    ...account.members,
  ];
}

export type PartnerOption = PartnerSummary & {
  /** Assigned in the saved unit; kept even if the customer is inactive */
  isAssigned: boolean;
  /** Can be chosen: active, or an inactive customer that is already assigned */
  isSelectable: boolean;
};

/**
 * Options for one partner function. Inactive customers can never be chosen
 * newly, but an inactive customer that is already assigned stays visible and
 * selected, so it is never removed or replaced silently.
 */
export function partnerOptions(
  partners: PartnerSummary[],
  assigned: string[] = [],
): PartnerOption[] {
  return partners.map((partner) => {
    const isAssigned = assigned.includes(partner.customerNumber);
    return { ...partner, isAssigned, isSelectable: partner.isActive || isAssigned };
  });
}

/** New create form for an account: the owner fills all partner functions */
export function prefillForAccount(
  values: B2bUnitFormValues,
  account: CustomerAccount | undefined,
): B2bUnitFormValues {
  const owner = account?.isActive ? account.accountCustomerNumber : "";
  return {
    ...values,
    accountCustomerNumber: account?.accountCustomerNumber ?? "",
    soldToCustomerNumber: owner,
    billToCustomerNumber: owner,
    payerCustomerNumber: owner,
    shipToCustomerNumbers: owner ? [owner] : [],
    defaultShipToCustomerNumber: owner,
  };
}

/**
 * Adds or removes an allowed ship-to. The default ship-to cannot be removed
 * (choose another default first), so there is always exactly one default.
 * The first ship-to added to an empty list becomes the default.
 */
export function toggleShipTo(
  values: B2bUnitFormValues,
  customerNumber: string,
): B2bUnitFormValues {
  const list = values.shipToCustomerNumbers;
  if (list.includes(customerNumber)) {
    if (customerNumber === values.defaultShipToCustomerNumber) return values;
    return {
      ...values,
      shipToCustomerNumbers: list.filter((n) => n !== customerNumber),
    };
  }
  return {
    ...values,
    shipToCustomerNumbers: [...list, customerNumber],
    defaultShipToCustomerNumber:
      list.length === 0 ? customerNumber : values.defaultShipToCustomerNumber,
  };
}

/** Makes a ship-to the default; adds it to the allowed list if needed */
export function chooseDefaultShipTo(
  values: B2bUnitFormValues,
  customerNumber: string,
): B2bUnitFormValues {
  const list = values.shipToCustomerNumbers;
  return {
    ...values,
    shipToCustomerNumbers: list.includes(customerNumber)
      ? list
      : [...list, customerNumber],
    defaultShipToCustomerNumber: customerNumber,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidationContext = {
  mode: "create" | "edit";
  /** Owner and members of the selected account */
  partners: PartnerSummary[];
  /** The saved unit when editing; its assignments may stay as they are */
  original?: B2bUnit;
};

export function validateB2bUnitForm(
  values: B2bUnitFormValues,
  { mode, partners, original }: ValidationContext,
): B2bUnitFieldErrors {
  const errors: B2bUnitFieldErrors = {};

  if (mode === "create") {
    const id = values.unitId;
    if (id.trim() === "") {
      errors.unitId = "Unit ID is required.";
    } else if (id.trim() !== id) {
      // Rejected instead of trimmed, so the stored key is exactly what was typed
      errors.unitId = "Unit ID must not start or end with a space.";
    } else if (id.length > UNIT_ID_MAX_LENGTH) {
      errors.unitId = `Use at most ${UNIT_ID_MAX_LENGTH} characters.`;
    }
  }

  const name = values.name.trim();
  if (name === "") {
    errors.name = "Name is required.";
  } else if (name.length > UNIT_NAME_MAX_LENGTH) {
    errors.name = `Use at most ${UNIT_NAME_MAX_LENGTH} characters.`;
  }

  if (values.accountCustomerNumber === "") {
    errors.accountCustomerNumber = "Select a customer account.";
  }

  const findPartner = (n: string) => partners.find((p) => p.customerNumber === n);
  const originalNumber = (field: (typeof PARTNER_ROLES)[number]["field"]) =>
    original ? unitToForm(original)[field] : undefined;

  /** Same rules as the ERP API: in the account, and active if newly chosen */
  const partnerError = (customerNumber: string, isUnchanged: boolean) => {
    const partner = findPartner(customerNumber);
    if (!partner) return `${customerNumber} does not belong to this account.`;
    if (!partner.isActive && !isUnchanged) {
      return `${customerNumber} is inactive and cannot be assigned.`;
    }
    return undefined;
  };

  for (const { field, label } of PARTNER_ROLES) {
    const customerNumber = values[field];
    if (customerNumber === "") {
      errors[field] = `Select a ${label}.`;
    } else if (values.accountCustomerNumber !== "") {
      const error = partnerError(customerNumber, originalNumber(field) === customerNumber);
      if (error) errors[field] = error;
    }
  }

  const shipTos = values.shipToCustomerNumbers;
  const originalShipTos = original?.shipTos.map((s) => s.customerNumber) ?? [];
  if (shipTos.length === 0) {
    errors.shipToCustomerNumbers = "Select at least one Ship-to.";
  } else if (shipTos.length > MAX_SHIP_TOS) {
    errors.shipToCustomerNumbers = `Select at most ${MAX_SHIP_TOS} Ship-to partners.`;
  } else if (new Set(shipTos).size !== shipTos.length) {
    errors.shipToCustomerNumbers = "Each Ship-to can only be selected once.";
  } else if (values.accountCustomerNumber !== "") {
    const error = shipTos
      .map((n) => partnerError(n, originalShipTos.includes(n)))
      .find(Boolean);
    if (error) errors.shipToCustomerNumbers = error;
  }

  const defaultShipTo = values.defaultShipToCustomerNumber;
  if (defaultShipTo === "") {
    errors.defaultShipToCustomerNumber = "Select a default Ship-to.";
  } else if (!shipTos.includes(defaultShipTo)) {
    errors.defaultShipToCustomerNumber =
      "The default Ship-to must be one of the selected Ship-to partners.";
  } else if (
    defaultShipTo !== original?.defaultShipToCustomerNumber &&
    findPartner(defaultShipTo)?.isActive === false
  ) {
    errors.defaultShipToCustomerNumber = `${defaultShipTo} is inactive and cannot become the default.`;
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Warnings and request bodies
// ---------------------------------------------------------------------------

/** Readable warnings for inactive customers that are assigned to a unit */
export function inactivePartnerWarnings(unit: B2bUnit): string[] {
  const warnings: string[] = [];
  if (!unit.account.isActive) {
    warnings.push(`Account ${describe(unit.account)} is inactive.`);
  }
  const roles = [
    ["Sold-to", unit.soldTo],
    ["Bill-to", unit.billTo],
    ["Payer", unit.payer],
  ] as const;
  for (const [label, partner] of roles) {
    if (!partner.isActive) warnings.push(`${label} ${describe(partner)} is inactive.`);
  }
  for (const shipTo of unit.shipTos) {
    if (!shipTo.isActive) {
      warnings.push(
        `${shipTo.isDefault ? "Default Ship-to" : "Ship-to"} ${describe(shipTo)} is inactive.`,
      );
    }
  }
  return warnings;
}

function describe(partner: PartnerSummary) {
  return `${partner.customerNumber} (${partner.name})`;
}

export function toCreateInput(values: B2bUnitFormValues): CreateB2bUnitInput {
  return {
    unitId: values.unitId,
    name: values.name.trim(),
    accountCustomerNumber: values.accountCustomerNumber,
    soldToCustomerNumber: values.soldToCustomerNumber,
    billToCustomerNumber: values.billToCustomerNumber,
    payerCustomerNumber: values.payerCustomerNumber,
    shipToCustomerNumbers: values.shipToCustomerNumbers,
    defaultShipToCustomerNumber: values.defaultShipToCustomerNumber,
    isActive: values.isActive,
  };
}

/** Sends the complete configuration; unchanged partners are kept as they are */
export function toUpdateInput(values: B2bUnitFormValues): UpdateB2bUnitInput {
  return {
    name: values.name.trim(),
    billToCustomerNumber: values.billToCustomerNumber,
    payerCustomerNumber: values.payerCustomerNumber,
    shipToCustomerNumbers: values.shipToCustomerNumbers,
    defaultShipToCustomerNumber: values.defaultShipToCustomerNumber,
    isActive: values.isActive,
  };
}
