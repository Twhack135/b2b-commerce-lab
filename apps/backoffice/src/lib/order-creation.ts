// Creating a sales order from a simulation (Sprint 10C).
//
// The request is built from the simulation the user has seen, never from the
// current form: positions, quantities and order header exactly as simulated,
// each position with the unit price of its simulated result item and the
// simulated total. These are only the prices the user confirmed; the ERP API
// prices the order again and answers 409 PRICE_CHANGED if anything differs.
// Amounts are copied as text, never calculated.
//
// Idempotency: every confirmed attempt gets a new requestId. A retry after a
// network error, a timeout or another uncertain answer sends the same
// request again, unchanged, so the ERP API returns the order it may already
// have created instead of creating a second one.

import { ApiError, TIMEOUT } from "./erp-api.ts";
import type {
  CreateSalesOrderRequest,
  SalesOrder,
  SalesOrderSimulation,
  SimulationRequest,
} from "./sales-orders.ts";

/** A position whose price differs from the price the user confirmed */
export type ChangedItemPrice = {
  itemNumber: number;
  materialNumber: string;
  quantity: number;
  expectedUnitPrice: string;
  /** The price the ERP API determined now; null if there is none */
  unitPrice: string | null;
};

/** The confirmed simulation an order can be created from */
export type CreationSource = {
  request: SimulationRequest;
  result: SalesOrderSimulation;
};

/**
 * Why no order can be created from this simulation, or null if it can.
 * `isOutdated`: the form has changed since the simulation.
 */
export function creationBlocker(
  source: CreationSource | null,
  isOutdated: boolean,
): string | null {
  if (!source) return "Simulate the order first.";
  if (isOutdated) {
    return "The input has changed since the simulation. Simulate the order again.";
  }
  const { request, result } = source;
  if (result.status === "INVALID") {
    return "The simulation has errors. Resolve them and simulate again.";
  }
  if (!result.totals || !result.currency) {
    return "The simulation has no total.";
  }
  if (
    result.items.length !== request.items.length ||
    result.items.some(
      (item, index) =>
        item.itemNumber !== (index + 1) * 10 ||
        item.materialNumber !== request.items[index].materialNumber ||
        item.quantity !== request.items[index].quantity,
    )
  ) {
    return "The simulation result does not match the simulated positions. Simulate again.";
  }
  if (result.items.some((item) => item.unitPrice === null)) {
    return "Not every position has a price.";
  }
  return null;
}

/**
 * The order from a simulation without blockers (see creationBlocker): the
 * simulated header and positions with the simulated prices.
 */
export function toCreateRequest(
  source: CreationSource,
  requestId: string,
): CreateSalesOrderRequest {
  const blocker = creationBlocker(source, false);
  if (blocker) throw new Error(blocker);
  const { request, result } = source;
  return {
    requestId,
    salesOrganization: request.salesOrganization,
    distributionChannel: request.distributionChannel,
    division: request.division,
    unitId: request.unitId,
    shipToCustomerNumber:
      request.shipToCustomerNumber === "" ? null : request.shipToCustomerNumber,
    requestedDeliveryDate: request.requestedDeliveryDate,
    requestedShippingMethod: request.requestedShippingMethod,
    customerReference: request.customerReference,
    customerNote: request.customerNote,
    items: request.items.map((item, index) => ({
      materialNumber: item.materialNumber,
      quantity: item.quantity,
      // The text exactly as the simulation returned it
      expectedUnitPrice: result.items[index].unitPrice as string,
    })),
    expectedTotal: {
      netValue: result.totals!.netValue,
      currency: result.totals!.currency,
    },
  };
}

/** What happened to a creation attempt */
export type CreationOutcome =
  /** 201 (created) or 200 (this request had already created the order) */
  | { kind: "created"; order: SalesOrder; replayed: boolean }
  /**
   * The order may or may not exist (timeout, network error, ERP API down or
   * failing, concurrent change). Only the SAME request may be sent again.
   */
  | { kind: "retry"; reason: "UNCERTAIN" | "CONCURRENT_UPDATE"; messages: string[] }
  /** 409: prices differ from the confirmed ones; nothing was stored */
  | {
      kind: "price-changed";
      evaluation: SalesOrderSimulation;
      changedItems: ChangedItemPrice[];
      messages: string[];
    }
  /** 422: the order has errors; nothing was stored */
  | { kind: "invalid"; evaluation: SalesOrderSimulation; messages: string[] }
  /** 409: this requestId already created another order */
  | { kind: "reused"; salesOrderNumber: string | null; messages: string[] }
  /** Any other answer: rejected, nothing was stored */
  | { kind: "rejected"; messages: string[] };

/** Statuses whose answer does not tell whether the order was stored */
const UNCERTAIN_STATUSES = [0, 500, 502, 503, 504];

function codeOf(data: unknown): string | undefined {
  return data !== null && typeof data === "object" && "code" in data
    ? String((data as { code: unknown }).code)
    : undefined;
}

function field<T>(data: unknown, name: string): T | undefined {
  return data !== null && typeof data === "object" && name in data
    ? ((data as Record<string, unknown>)[name] as T)
    : undefined;
}

/** Classifies the answer (or the error) of POST /sales-orders */
export function creationOutcome(
  answer: { order: SalesOrder; created: boolean } | { error: unknown },
): CreationOutcome {
  if ("order" in answer) {
    return { kind: "created", order: answer.order, replayed: !answer.created };
  }
  const { error } = answer;
  if (!(error instanceof ApiError)) {
    return {
      kind: "retry",
      reason: "UNCERTAIN",
      messages: ["Something went wrong. It is unknown whether the order was created."],
    };
  }
  const code = codeOf(error.data);
  const evaluation = field<SalesOrderSimulation>(error.data, "evaluation");

  if (UNCERTAIN_STATUSES.includes(error.status) || code === TIMEOUT) {
    return { kind: "retry", reason: "UNCERTAIN", messages: error.messages };
  }
  if (error.status === 409 && code === "CONCURRENT_UPDATE") {
    return { kind: "retry", reason: "CONCURRENT_UPDATE", messages: error.messages };
  }
  if (error.status === 409 && code === "PRICE_CHANGED" && evaluation) {
    return {
      kind: "price-changed",
      evaluation,
      changedItems: field<ChangedItemPrice[]>(error.data, "changedItems") ?? [],
      messages: error.messages,
    };
  }
  if (error.status === 422 && code === "ORDER_INVALID" && evaluation) {
    return { kind: "invalid", evaluation, messages: error.messages };
  }
  if (error.status === 409 && code === "IDEMPOTENCY_KEY_REUSED") {
    return {
      kind: "reused",
      salesOrderNumber: field<string>(error.data, "salesOrderNumber") ?? null,
      messages: error.messages,
    };
  }
  return { kind: "rejected", messages: error.messages };
}

/**
 * How often a creation is repeated automatically after CONCURRENT_UPDATE
 * (with the same request), and how long to wait before each repetition
 */
export const CONCURRENT_RETRY_DELAYS_MS = [400, 1200];

/** The changed prices by item number, for highlighting */
export function changedPricesByItem(changes: ChangedItemPrice[]) {
  return new Map(changes.map((change) => [change.itemNumber, change]));
}

// ---------------------------------------------------------------------------
// A request whose result is unknown is kept in the session storage of the
// browser, so it can still be repeated (unchanged) after a page reload.
// ---------------------------------------------------------------------------

export const PENDING_STORAGE_KEY = "b2b-backoffice.pending-sales-order";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Remembers the request; storage errors are ignored (private mode etc.) */
export function savePendingRequest(
  storage: StorageLike | undefined,
  request: CreateSalesOrderRequest,
) {
  try {
    storage?.setItem(PENDING_STORAGE_KEY, JSON.stringify(request));
  } catch {
    // Without storage the pending request is only kept on this page
  }
}

export function clearPendingRequest(storage: StorageLike | undefined) {
  try {
    storage?.removeItem(PENDING_STORAGE_KEY);
  } catch {
    // Nothing to clear
  }
}

/** The stored text of the remembered request (stable between renders) */
export function readPendingText(storage: StorageLike | undefined): string | null {
  try {
    return storage?.getItem(PENDING_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The request in a stored text, or null if it is missing or unreadable */
export function parsePendingRequest(
  text: string | null,
): CreateSalesOrderRequest | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isCreateRequest(value) ? value : null;
  } catch {
    return null;
  }
}

/** The remembered request, or null if there is none or it is unreadable */
export function loadPendingRequest(
  storage: StorageLike | undefined,
): CreateSalesOrderRequest | null {
  return parsePendingRequest(readPendingText(storage));
}

function isCreateRequest(value: unknown): value is CreateSalesOrderRequest {
  if (value === null || typeof value !== "object") return false;
  const request = value as Partial<CreateSalesOrderRequest>;
  return (
    typeof request.requestId === "string" &&
    typeof request.unitId === "string" &&
    Array.isArray(request.items) &&
    request.items.length > 0 &&
    request.items.every(
      (item) =>
        typeof item?.materialNumber === "string" &&
        typeof item.quantity === "number" &&
        typeof item.expectedUnitPrice === "string",
    ) &&
    typeof request.expectedTotal?.netValue === "string" &&
    typeof request.expectedTotal.currency === "string"
  );
}
