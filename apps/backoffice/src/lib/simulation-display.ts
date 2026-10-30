// Display logic of an order simulation result: status texts, message
// grouping and the assignment of messages to fields, partners and positions.
// Only type imports and import-free helpers, so it can be tested directly
// with `node --test`.
import { fieldOfMessage } from "./form-errors.ts";
import type { HeaderField, ItemField } from "./order-simulation-form.ts";
import type {
  MessageSeverity,
  SalesOrderSimulation,
  SimulationCheck,
  SimulationMessage,
  SimulationStatus,
} from "./sales-orders.ts";

export const STATUS_TEXT: Record<
  SimulationStatus,
  { title: string; text: string }
> = {
  VALID: {
    title: "Valid",
    text: "The simulation found no problems. Checks marked “not checked” were not performed, so delivery is not guaranteed.",
  },
  VALID_WITH_WARNINGS: {
    title: "Valid with warnings",
    text: "The order could be placed, but see the warnings below.",
  },
  INVALID: {
    title: "Invalid",
    text: "The order cannot be placed like this. Resolve the errors below.",
  },
};

export const SEVERITY_LABELS: Record<MessageSeverity, string> = {
  ERROR: "Error",
  WARNING: "Warning",
  INFO: "Info",
};

const SEVERITY_ORDER: MessageSeverity[] = ["ERROR", "WARNING", "INFO"];

/** Most severe first, otherwise in the order of the API */
export function sortMessages(messages: SimulationMessage[]) {
  return [...messages].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

export const CHECK_LABELS: Record<string, string> = {
  SALES_AREA: "Sales area",
  PARTNERS: "Partners",
  MATERIALS: "Materials",
  PRICING: "Pricing",
  CURRENCY: "Document currency",
  AVAILABILITY: "Stock availability",
  DELIVERY_DATE: "Delivery date",
  FREIGHT: "Freight",
  TAX: "Tax",
  CREDIT: "Credit check",
  CUSTOMER_BLOCKS: "Customer blocks",
  MINIMUM_ORDER_VALUE: "Minimum order value",
};

export function checkLabel(check: SimulationCheck) {
  return CHECK_LABELS[check.check] ?? check.check;
}

export function splitChecks(checks: SimulationCheck[]) {
  return {
    performed: checks.filter((c) => c.result !== "NOT_PERFORMED"),
    notPerformed: checks.filter((c) => c.result === "NOT_PERFORMED"),
  };
}

/** A total is only shown for a simulation without errors */
export function totalToShow(result: SalesOrderSimulation) {
  return result.status === "INVALID" ? null : result.totals;
}

export type PartnerRole = "account" | "soldTo" | "billTo" | "payer" | "shipTo";

const PARTNER_ROLES: PartnerRole[] = [
  "account",
  "soldTo",
  "billTo",
  "payer",
  "shipTo",
];

/** Header messages by the input field they belong to */
export function headerFieldMessages(result: SalesOrderSimulation) {
  const byField: Partial<Record<HeaderField | "requestedShippingMethod", SimulationMessage[]>> = {};
  for (const message of result.messages) {
    // Sales area messages of the ERP API name the sales organization
    const field =
      message.field === "shipTo"
        ? "shipToCustomerNumber"
        : message.field === "salesOrganization"
          ? "salesArea"
          : message.field;
    if (
      field === "salesArea" ||
      field === "unitId" ||
      field === "shipToCustomerNumber" ||
      field === "customerNote" ||
      field === "customerReference" ||
      field === "requestedDeliveryDate" ||
      field === "requestedShippingMethod"
    ) {
      (byField[field] ??= []).push(message);
    }
  }
  return byField;
}

/** Inactive partners and other partner messages by partner role */
export function partnerRoleMessages(result: SalesOrderSimulation) {
  const byRole: Partial<Record<PartnerRole, SimulationMessage[]>> = {};
  for (const message of result.messages) {
    if (PARTNER_ROLES.includes(message.field as PartnerRole)) {
      (byRole[message.field as PartnerRole] ??= []).push(message);
    }
  }
  return byRole;
}

/** Item messages by position index (item 10 is index 0) */
export function itemMessagesByIndex(result: SalesOrderSimulation) {
  const byIndex = new Map<number, SimulationMessage[]>();
  result.items.forEach((item, index) => {
    if (item.messages.length > 0) byIndex.set(index, item.messages);
  });
  return byIndex;
}

/** All messages of a simulation, also of the positions */
export function allMessages(result: SalesOrderSimulation) {
  return [...result.messages, ...result.items.flatMap((i) => i.messages)];
}

const HEADER_FIELDS: HeaderField[] = [
  "salesArea",
  "unitId",
  "shipToCustomerNumber",
  "requestedDeliveryDate",
  "customerReference",
  "customerNote",
];

/**
 * Maps the messages of an HTTP 400 answer: "items.1.quantity must ..."
 * belongs to the second position, "customerNote must ..." to that field.
 */
export function badRequestErrors(messages: string[]) {
  const header: Partial<Record<HeaderField, string>> = {};
  const items = new Map<number, Partial<Record<ItemField, string>>>();
  const other: string[] = [];
  for (const message of messages) {
    const itemMatch = /^items\.(\d+)\.(materialNumber|quantity) (.+)$/.exec(
      message,
    );
    if (itemMatch) {
      const index = Number(itemMatch[1]);
      const field = itemMatch[2] as ItemField;
      const errors = items.get(index) ?? {};
      errors[field] ??= sentence(`${field} ${itemMatch[3]}`);
      items.set(index, errors);
      continue;
    }
    // The three fields of the sales area are one input in the form
    if (/^(salesOrganization|distributionChannel|division) /.test(message)) {
      header.salesArea ??= sentence(message);
      continue;
    }
    const field = fieldOfMessage(message, HEADER_FIELDS);
    if (field && !header[field]) header[field] = sentence(message);
    else other.push(sentence(message));
  }
  return { header, items, other };
}

function sentence(message: string) {
  const text = message.charAt(0).toUpperCase() + message.slice(1);
  return text.endsWith(".") ? text : `${text}.`;
}
