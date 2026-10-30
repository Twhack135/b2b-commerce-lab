// Form logic of the Order Simulation: values, positions, validation and the
// request. The pricing date is not part of the form: it is the order date
// (see orderDate below) and cannot be changed by the user. Mirrors the ERP API rules (apps/erp-api/src/sales-orders) so users
// get feedback before submitting; the ERP API stays the authoritative check.
// Only type imports and import-free helpers, so it can be tested directly
// with `node --test`.
import type { B2bUnit, PartnerSummary } from "./b2b-units.ts";
import { isCalendarDate } from "./dates.ts";
import type {
  RequestedShippingMethod,
  SimulationRequest,
} from "./sales-orders.ts";
import {
  DEFAULT_SALES_AREA_ID,
  parseSalesAreaId,
  salesAreaById,
  salesAreaId,
} from "./sales-area-display.ts";
import type { SalesArea } from "./sales-areas.ts";

/** Technical limit of the ERP API, not a business rule */
export const MAX_ITEMS = 200;
export const MAX_QUANTITY = 99_999;
export const CUSTOMER_REFERENCE_MAX_LENGTH = 35;
export const CUSTOMER_NOTE_MAX_LENGTH = 1000;
/** Positions are numbered like in SAP and like the ERP API: 10, 20, 30 */
export const ITEM_NUMBER_STEP = 10;

/** One order position as entered; quantity is the text of the input */
export type ItemDraft = {
  /** Stable key for React; not sent to the API */
  key: number;
  materialNumber: string;
  quantity: string;
};

export type OrderSimulationValues = {
  /**
   * The sales area (shop context) as "1000/10/00"; the first commercial
   * field. The unit must belong to it; the document currency comes from it.
   */
  salesArea: string;
  unitId: string;
  shipToCustomerNumber: string;
  /** Optional, YYYY-MM-DD; empty means no requested date */
  requestedDeliveryDate: string;
  requestedShippingMethod: RequestedShippingMethod;
  customerReference: string;
  customerNote: string;
  items: ItemDraft[];
};

export type HeaderField =
  | "salesArea"
  | "unitId"
  | "shipToCustomerNumber"
  | "requestedDeliveryDate"
  | "customerReference"
  | "customerNote";

export type ItemField = "materialNumber" | "quantity";

export type SimulationFormErrors = {
  header: Partial<Record<HeaderField, string>>;
  /** Errors per position, by item key */
  items: Record<number, Partial<Record<ItemField, string>>>;
  /** Errors about the list of positions as a whole */
  itemList?: string;
};

export function itemNumberAt(index: number) {
  return (index + 1) * ITEM_NUMBER_STEP;
}

/** A new order starts in the German sales area unless the user chooses another one */
export function emptySimulationForm(
  salesArea: string = DEFAULT_SALES_AREA_ID,
): OrderSimulationValues {
  return {
    salesArea,
    unitId: "",
    shipToCustomerNumber: "",
    requestedDeliveryDate: "",
    requestedShippingMethod: "STANDARD",
    customerReference: "",
    customerNote: "",
    items: [{ key: 1, materialNumber: "", quantity: "1" }],
  };
}

/** Adds an empty position at the end, unless the limit is reached */
/** The key the next added position gets */
export function nextItemKey(values: OrderSimulationValues) {
  return Math.max(0, ...values.items.map((i) => i.key)) + 1;
}

export function addItem(values: OrderSimulationValues): OrderSimulationValues {
  if (values.items.length >= MAX_ITEMS) return values;
  return {
    ...values,
    items: [
      ...values.items,
      { key: nextItemKey(values), materialNumber: "", quantity: "1" },
    ],
  };
}

/**
 * Appends a position only if `afterKey` is still the last one. A second,
 * quick Enter on the same row therefore never adds a second empty row.
 */
export function addItemAfter(
  values: OrderSimulationValues,
  afterKey: number,
): OrderSimulationValues {
  return values.items.at(-1)?.key === afterKey ? addItem(values) : values;
}

/** A typed quantity as number, or null if it is not a whole number */
function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export function isValidQuantity(text: string) {
  const quantity = parseQuantity(text);
  return quantity !== null && quantity >= 1 && quantity <= MAX_QUANTITY;
}

/**
 * The quantity after a + or - click, always valid (1 to 99,999). An empty
 * or invalid input becomes 1, so a click never produces NaN.
 */
export function stepQuantity(text: string, delta: 1 | -1): string {
  const quantity = parseQuantity(text);
  if (quantity === null) return "1";
  return String(Math.min(MAX_QUANTITY, Math.max(1, quantity + delta)));
}

/** Minus is disabled at 1 (and below), plus at 99,999 (and above) */
export function canStepQuantity(text: string, delta: 1 | -1) {
  const quantity = parseQuantity(text);
  if (quantity === null) return true;
  return delta === -1 ? quantity > 1 : quantity < MAX_QUANTITY;
}

export type QuantityEnterResult =
  /** Move to the material of the next existing position */
  | { kind: "focus-next"; key: number }
  /** Append a position after the last one and move to its material */
  | { kind: "add"; key: number }
  /** Nothing happens; tell the user why */
  | { kind: "blocked"; reason: string };

/**
 * What Enter in the quantity input of a position does: on an earlier
 * position it moves to the next one; on the last position it adds a new
 * one, but only for a selected material with a valid quantity and within
 * the limit of 200 positions.
 */
export function quantityEnter(
  values: OrderSimulationValues,
  key: number,
): QuantityEnterResult {
  const index = values.items.findIndex((i) => i.key === key);
  if (index === -1) return { kind: "blocked", reason: "This item no longer exists." };
  if (index < values.items.length - 1) {
    return { kind: "focus-next", key: values.items[index + 1].key };
  }
  const item = values.items[index];
  if (item.materialNumber === "") {
    return { kind: "blocked", reason: "Select a material before adding the next item." };
  }
  if (!isValidQuantity(item.quantity)) {
    return {
      kind: "blocked",
      reason: `Enter a quantity from 1 to ${MAX_QUANTITY.toLocaleString("en-US")} before adding the next item.`,
    };
  }
  if (values.items.length >= MAX_ITEMS) {
    return {
      kind: "blocked",
      reason: `The maximum of ${MAX_ITEMS} items is reached. No item was added.`,
    };
  }
  return { kind: "add", key: nextItemKey(values) };
}

/**
 * Removes a position; the others keep their order and are numbered again
 * (10, 20, ...), as the ERP API numbers positions by their order. The last
 * position is emptied instead of removed, so there is always one row.
 */
export function removeItem(
  values: OrderSimulationValues,
  key: number,
): OrderSimulationValues {
  if (values.items.length === 1) {
    return {
      ...values,
      items: [{ key: values.items[0].key + 1, materialNumber: "", quantity: "1" }],
    };
  }
  return { ...values, items: values.items.filter((i) => i.key !== key) };
}

export function updateItem(
  values: OrderSimulationValues,
  key: number,
  changes: Partial<Omit<ItemDraft, "key">>,
): OrderSimulationValues {
  return {
    ...values,
    items: values.items.map((i) => (i.key === key ? { ...i, ...changes } : i)),
  };
}

export type ShipToOption = PartnerSummary & {
  isDefault: boolean;
  /** Inactive Ship-tos stay visible but cannot be selected */
  isSelectable: boolean;
};

export function shipToOptions(unit: B2bUnit | undefined): ShipToOption[] {
  return (unit?.shipTos ?? []).map((s) => ({
    customerNumber: s.customerNumber,
    name: s.name,
    isActive: s.isActive,
    isDefault: s.isDefault,
    isSelectable: s.isActive,
  }));
}

/** The B2B units of the selected sales area; the only ones offered */
export function unitsOfSalesArea(units: B2bUnit[], salesArea: string): B2bUnit[] {
  return units.filter((u) => salesAreaId(u.salesArea) === salesArea);
}

/**
 * Changing the sales area keeps the unit and Ship-to only if the unit
 * belongs to the new sales area; otherwise both are cleared, so a unit of
 * another market is never submitted. The positions stay: materials are the
 * same in every market, their prices are determined again.
 */
export function selectSalesArea(
  values: OrderSimulationValues,
  salesArea: string,
  units: B2bUnit[],
): OrderSimulationValues {
  const unit = units.find((u) => u.unitId === values.unitId);
  const keepsUnit = unit !== undefined && salesAreaId(unit.salesArea) === salesArea;
  return keepsUnit
    ? { ...values, salesArea }
    : { ...values, salesArea, unitId: "", shipToCustomerNumber: "" };
}

/**
 * Selecting a unit selects its default Ship-to. An inactive default is not
 * selected, and no other Ship-to is chosen silently instead.
 */
export function selectUnit(
  values: OrderSimulationValues,
  unit: B2bUnit | undefined,
): OrderSimulationValues {
  const defaultShipTo = shipToOptions(unit).find((s) => s.isDefault);
  return {
    ...values,
    unitId: unit?.unitId ?? "",
    shipToCustomerNumber:
      defaultShipTo && defaultShipTo.isSelectable
        ? defaultShipTo.customerNumber
        : "",
  };
}

/** Why no Ship-to was preselected, if the default is inactive */
export function inactiveDefaultShipTo(unit: B2bUnit | undefined) {
  const defaultShipTo = shipToOptions(unit).find((s) => s.isDefault);
  return defaultShipTo && !defaultShipTo.isActive ? defaultShipTo : undefined;
}

/** Sold-to, Bill-to and Payer as assigned to the unit (preview only) */
export function unitPartners(unit: B2bUnit | undefined) {
  return unit
    ? { soldTo: unit.soldTo, billTo: unit.billTo, payer: unit.payer }
    : null;
}

export function validateSimulationForm(
  values: OrderSimulationValues,
  units: B2bUnit[],
  /** Today, YYYY-MM-DD; a requested delivery date must not be earlier */
  orderDate: string,
  /** Configured sales areas; may be missing while they load */
  salesAreas: SalesArea[] = [],
): SimulationFormErrors {
  const errors: SimulationFormErrors = { header: {}, items: {} };
  const header = errors.header;

  const area = salesAreaById(salesAreas, values.salesArea);
  if (!parseSalesAreaId(values.salesArea)) {
    header.salesArea = "Select a sales area.";
  } else if (area && !area.isActive) {
    header.salesArea = `Sales area ${values.salesArea} is inactive.`;
  }

  const unit = units.find((u) => u.unitId === values.unitId);
  if (values.unitId === "") {
    header.unitId = "Select a B2B unit.";
  } else if (unit && salesAreaId(unit.salesArea) !== values.salesArea) {
    header.unitId = `B2B unit ${unit.unitId} belongs to sales area ${salesAreaId(unit.salesArea)}, not ${values.salesArea}.`;
  } else if (unit && !unit.isActive) {
    header.unitId = `B2B unit ${unit.unitId} is inactive and cannot be selected.`;
  }

  if (values.shipToCustomerNumber === "") {
    header.shipToCustomerNumber = "Select a Ship-to.";
  } else if (unit) {
    const shipTo = shipToOptions(unit).find(
      (s) => s.customerNumber === values.shipToCustomerNumber,
    );
    if (!shipTo) {
      header.shipToCustomerNumber = `Customer ${values.shipToCustomerNumber} is not an allowed Ship-to of this unit.`;
    } else if (!shipTo.isSelectable) {
      header.shipToCustomerNumber = `Ship-to ${shipTo.customerNumber} is inactive.`;
    }
  }

  if (values.requestedDeliveryDate !== "") {
    if (!isCalendarDate(values.requestedDeliveryDate)) {
      header.requestedDeliveryDate = "Enter a valid date or leave it empty.";
    } else if (values.requestedDeliveryDate < orderDate) {
      header.requestedDeliveryDate = "The requested delivery date must not be before the order date.";
    }
  }

  if (values.customerReference.length > CUSTOMER_REFERENCE_MAX_LENGTH) {
    header.customerReference = `Use at most ${CUSTOMER_REFERENCE_MAX_LENGTH} characters.`;
  }
  if (values.customerNote.length > CUSTOMER_NOTE_MAX_LENGTH) {
    header.customerNote = `Use at most ${CUSTOMER_NOTE_MAX_LENGTH.toLocaleString("en-US")} characters.`;
  }

  if (values.items.length === 0) {
    errors.itemList = "Add at least one item.";
  } else if (values.items.length > MAX_ITEMS) {
    errors.itemList = `An order can have at most ${MAX_ITEMS} items.`;
  }
  for (const item of values.items) {
    const itemErrors: Partial<Record<ItemField, string>> = {};
    if (item.materialNumber === "") itemErrors.materialNumber = "Select a material.";
    const quantity = item.quantity.trim();
    if (quantity === "") {
      itemErrors.quantity = "Enter a quantity.";
    } else if (!/^\d+$/.test(quantity)) {
      itemErrors.quantity = "Enter a whole number.";
    } else if (Number(quantity) < 1 || Number(quantity) > MAX_QUANTITY) {
      itemErrors.quantity = `1 to ${MAX_QUANTITY.toLocaleString("en-US")}.`;
    }
    if (Object.keys(itemErrors).length > 0) errors.items[item.key] = itemErrors;
  }

  return errors;
}

export function hasErrors(errors: SimulationFormErrors) {
  return (
    Object.keys(errors.header).length > 0 ||
    Object.keys(errors.items).length > 0 ||
    errors.itemList !== undefined
  );
}

/**
 * The request for the ERP API.
 *
 * Business rule: the pricing date of an order is its order date. The user
 * cannot choose it, and it is never derived from a requested delivery date.
 * LIMITATION (accepted for Sprint 8B only): the caller passes today's date
 * of the user's browser as order date. Before real orders can be placed,
 * the ERP API must determine the order date and pricing date itself; a
 * client-supplied date must then no longer be trusted.
 *
 * The Ship-to is always sent explicitly: what
 * the user sees is what is simulated. Sold-to, Bill-to and Payer are never
 * sent, the ERP API takes them from the unit. Empty optional texts are null.
 */
export function toSimulationRequest(
  values: OrderSimulationValues,
  pricingDate: string,
): SimulationRequest {
  const key = parseSalesAreaId(values.salesArea);
  if (!key) throw new Error(`Not a sales area: ${values.salesArea}`);
  return {
    // The shop context; the ERP API checks it and decides the currency
    ...key,
    unitId: values.unitId,
    shipToCustomerNumber: values.shipToCustomerNumber,
    pricingDate,
    // Informational only; it never changes the pricing date
    requestedDeliveryDate:
      values.requestedDeliveryDate === "" ? null : values.requestedDeliveryDate,
    requestedShippingMethod: values.requestedShippingMethod,
    customerReference:
      values.customerReference === "" ? null : values.customerReference,
    customerNote: values.customerNote === "" ? null : values.customerNote,
    items: values.items.map((item) => ({
      materialNumber: item.materialNumber,
      // A count of pieces, not money: a whole number is exact as a number
      quantity: Number(item.quantity.trim()),
    })),
  };
}

/**
 * Identifies the input of a simulation, including the pricing date. A
 * result is outdated as soon as the current input has another key than the
 * input it was simulated with, e.g. also when the date changes at midnight.
 */
export function inputKey(
  values: OrderSimulationValues,
  pricingDate: string,
): string {
  return JSON.stringify({
    ...values,
    pricingDate,
    items: values.items.map((i) => [i.materialNumber, i.quantity.trim()]),
  });
}
