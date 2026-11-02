import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, TIMEOUT } from "./erp-api.ts";
import {
  changedPricesByItem,
  clearPendingRequest,
  creationBlocker,
  creationOutcome,
  loadPendingRequest,
  PENDING_STORAGE_KEY,
  savePendingRequest,
  toCreateRequest,
  type CreationSource,
} from "./order-creation.ts";
import type {
  SalesOrder,
  SalesOrderSimulation,
  SimulationRequest,
} from "./sales-orders.ts";

const REQUEST_ID = "8f0c6a1e-3b7d-4e7a-9c55-1f2a3b4c5d6e";

const simulationRequest = (): SimulationRequest => ({
  salesOrganization: "1000",
  distributionChannel: "10",
  division: "00",
  unitId: "UNIT-STUTTGART",
  shipToCustomerNumber: "CUST-1100",
  pricingDate: "2026-11-15",
  requestedDeliveryDate: "2026-11-30",
  requestedShippingMethod: "EXPRESS",
  customerReference: "PO-STR-2026-118",
  customerNote: "Gate 3",
  items: [
    { materialNumber: "MAT-001", quantity: 2 },
    { materialNumber: "MAT-002", quantity: 10 },
  ],
});

const item = (
  index: number,
  materialNumber: string,
  quantity: number,
  unitPrice: string | null,
  netValue: string | null,
) => ({
  itemNumber: (index + 1) * 10,
  materialNumber,
  materialDescription: materialNumber,
  quantity,
  unitPrice,
  netValue,
  currency: unitPrice === null ? null : "EUR",
  pricing: null,
  messages: [],
});

const result = (change: Partial<SalesOrderSimulation> = {}): SalesOrderSimulation => ({
  simulated: true,
  status: "VALID_WITH_WARNINGS",
  salesArea: { salesOrganization: "1000", distributionChannel: "10", division: "00" },
  currency: "EUR",
  pricingDate: "2026-11-15",
  requestedDeliveryDate: "2026-11-30",
  requestedShippingMethod: "EXPRESS",
  customerReference: "PO-STR-2026-118",
  customerNote: "Gate 3",
  partners: null,
  items: [
    item(0, "MAT-001", 2, "4400.00", "8800.00"),
    item(1, "MAT-002", 10, "189.50", "1895.00"),
  ],
  totals: { netValue: "10695.00", currency: "EUR", includes: "NET_EXCL_TAX_AND_FREIGHT" },
  requiresSalesReview: true,
  proposedOrderBlock: null,
  checks: [],
  messages: [],
  ...change,
});

const source = (change: Partial<SalesOrderSimulation> = {}): CreationSource => ({
  request: simulationRequest(),
  result: result(change),
});

describe("creationBlocker", () => {
  it("allows VALID and VALID_WITH_WARNINGS simulations of the current input", () => {
    assert.equal(creationBlocker(source(), false), null);
    assert.equal(creationBlocker(source({ status: "VALID" }), false), null);
  });

  it("requires a simulation of the current input", () => {
    assert.equal(creationBlocker(null, false), "Simulate the order first.");
    assert.match(creationBlocker(source(), true) ?? "", /input has changed/);
  });

  it("never allows an invalid simulation or one without total", () => {
    assert.match(creationBlocker(source({ status: "INVALID", totals: null }), false) ?? "", /errors/);
    assert.match(creationBlocker(source({ totals: null }), false) ?? "", /no total/);
  });

  it("requires a price for every position", () => {
    const unpriced = result();
    unpriced.items[1] = item(1, "MAT-002", 10, null, null);
    assert.match(
      creationBlocker({ request: simulationRequest(), result: unpriced }, false) ?? "",
      /Not every position has a price/,
    );
  });

  it("rejects a result that does not belong to the simulated positions", () => {
    for (const items of [
      [item(0, "MAT-001", 2, "4400.00", "8800.00")],
      [item(0, "MAT-001", 3, "4400.00", "13200.00"), item(1, "MAT-002", 10, "189.50", "1895.00")],
      [item(0, "MAT-002", 10, "189.50", "1895.00"), item(1, "MAT-001", 2, "4400.00", "8800.00")],
    ]) {
      assert.match(creationBlocker(source({ items }), false) ?? "", /does not match/);
    }
  });
});

describe("toCreateRequest", () => {
  it("builds the exact backend contract from the simulation", () => {
    assert.deepEqual(toCreateRequest(source(), REQUEST_ID), {
      requestId: REQUEST_ID,
      salesOrganization: "1000",
      distributionChannel: "10",
      division: "00",
      unitId: "UNIT-STUTTGART",
      shipToCustomerNumber: "CUST-1100",
      requestedDeliveryDate: "2026-11-30",
      requestedShippingMethod: "EXPRESS",
      customerReference: "PO-STR-2026-118",
      customerNote: "Gate 3",
      items: [
        { materialNumber: "MAT-001", quantity: 2, expectedUnitPrice: "4400.00" },
        { materialNumber: "MAT-002", quantity: 10, expectedUnitPrice: "189.50" },
      ],
      expectedTotal: { netValue: "10695.00", currency: "EUR" },
    });
  });

  it("never sends a pricing date: the ERP API sets the order date", () => {
    assert.equal("pricingDate" in toCreateRequest(source(), REQUEST_ID), false);
  });

  it("copies prices as text, never as numbers (JPY and cents)", () => {
    const japan = toCreateRequest(
      {
        request: { ...simulationRequest(), salesOrganization: "3000", items: [{ materialNumber: "MAT-001", quantity: 2 }] },
        result: result({
          currency: "JPY",
          items: [{ ...item(0, "MAT-001", 2, "700000", "1400000"), currency: "JPY" }],
          totals: { netValue: "1400000", currency: "JPY", includes: "NET_EXCL_TAX_AND_FREIGHT" },
        }),
      },
      REQUEST_ID,
    );
    assert.deepEqual(japan.items, [{ materialNumber: "MAT-001", quantity: 2, expectedUnitPrice: "700000" }]);
    assert.deepEqual(japan.expectedTotal, { netValue: "1400000", currency: "JPY" });

    const cents = toCreateRequest(
      {
        request: { ...simulationRequest(), items: [{ materialNumber: "MAT-101", quantity: 3 }] },
        result: result({
          items: [item(0, "MAT-101", 3, "0.10", "0.30")],
          totals: { netValue: "0.30", currency: "EUR", includes: "NET_EXCL_TAX_AND_FREIGHT" },
        }),
      },
      REQUEST_ID,
    );
    assert.equal(cents.items[0].expectedUnitPrice, "0.10");
    assert.equal(cents.expectedTotal.netValue, "0.30");
  });

  it("keeps the order of positions and the price of each, also for equal materials", () => {
    const request = {
      ...simulationRequest(),
      items: [
        { materialNumber: "MAT-002", quantity: 1 },
        { materialNumber: "MAT-002", quantity: 2 },
      ],
    };
    const built = toCreateRequest(
      {
        request,
        result: result({
          items: [item(0, "MAT-002", 1, "189.50", "189.50"), item(1, "MAT-002", 2, "189.50", "379.00")],
          totals: { netValue: "568.50", currency: "EUR", includes: "NET_EXCL_TAX_AND_FREIGHT" },
        }),
      },
      REQUEST_ID,
    );
    assert.deepEqual(
      built.items.map((i) => `${i.materialNumber}:${i.quantity}:${i.expectedUnitPrice}`),
      ["MAT-002:1:189.50", "MAT-002:2:189.50"],
    );
  });

  it("sends no Ship-to instead of an empty one", () => {
    const request = { ...simulationRequest(), shipToCustomerNumber: "" };
    assert.equal(toCreateRequest({ request, result: result() }, REQUEST_ID).shipToCustomerNumber, null);
  });

  it("refuses to build a request from a blocked simulation", () => {
    assert.throws(() => toCreateRequest(source({ status: "INVALID", totals: null }), REQUEST_ID), /errors/);
  });
});

const order = { salesOrderNumber: "1000000001" } as SalesOrder;
const apiError = (status: number, data: unknown, messages = ["message"]) =>
  new ApiError(status, messages, data);

describe("creationOutcome", () => {
  it("treats 201 and 200 as success", () => {
    assert.deepEqual(creationOutcome({ order, created: true }), { kind: "created", order, replayed: false });
    assert.deepEqual(creationOutcome({ order, created: false }), { kind: "created", order, replayed: true });
  });

  it("treats every unknown result as a retry of the same request", () => {
    for (const error of [
      apiError(0, { code: TIMEOUT }),
      apiError(0, null),
      apiError(500, null),
      apiError(502, null),
      apiError(503, null),
      apiError(504, null),
      new TypeError("unexpected"),
    ]) {
      assert.equal(creationOutcome({ error }).kind, "retry", String(error));
      assert.equal((creationOutcome({ error }) as { reason: string }).reason, "UNCERTAIN");
    }
  });

  it("retries a concurrent change with the same request", () => {
    assert.deepEqual(creationOutcome({ error: apiError(409, { code: "CONCURRENT_UPDATE" }) }), {
      kind: "retry",
      reason: "CONCURRENT_UPDATE",
      messages: ["message"],
    });
  });

  it("returns the new evaluation and the changed items of PRICE_CHANGED", () => {
    const evaluation = result();
    const changedItems = [
      { itemNumber: 20, materialNumber: "MAT-002", quantity: 10, expectedUnitPrice: "189.50", unitPrice: "190.00" },
    ];
    assert.deepEqual(
      creationOutcome({ error: apiError(409, { code: "PRICE_CHANGED", changedItems, evaluation }) }),
      { kind: "price-changed", evaluation, changedItems, messages: ["message"] },
    );
  });

  it("returns the evaluation of ORDER_INVALID", () => {
    const evaluation = result({ status: "INVALID", totals: null });
    assert.deepEqual(creationOutcome({ error: apiError(422, { code: "ORDER_INVALID", evaluation }) }), {
      kind: "invalid",
      evaluation,
      messages: ["message"],
    });
  });

  it("reports a reused request ID with the existing order", () => {
    assert.deepEqual(
      creationOutcome({ error: apiError(409, { code: "IDEMPOTENCY_KEY_REUSED", salesOrderNumber: "1000000001" }) }),
      { kind: "reused", salesOrderNumber: "1000000001", messages: ["message"] },
    );
  });

  it("rejects everything else, e.g. a malformed request (400)", () => {
    assert.equal(creationOutcome({ error: apiError(400, { message: ["x"] }) }).kind, "rejected");
    assert.equal(creationOutcome({ error: apiError(404, null) }).kind, "rejected");
    // A 409 or 422 without the expected content is not guessed
    assert.equal(creationOutcome({ error: apiError(409, { code: "PRICE_CHANGED" }) }).kind, "rejected");
  });
});

describe("changedPricesByItem", () => {
  it("finds a changed price by item number", () => {
    const change = { itemNumber: 20, materialNumber: "MAT-002", quantity: 10, expectedUnitPrice: "189.50", unitPrice: "190.00" };
    assert.deepEqual(changedPricesByItem([change]).get(20), change);
    assert.equal(changedPricesByItem([change]).get(10), undefined);
  });
});

describe("pending request in the session storage", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
  };

  it("keeps the exact request until it is cleared", () => {
    const storage = memory();
    const request = toCreateRequest(source(), REQUEST_ID);
    savePendingRequest(storage, request);
    assert.deepEqual(loadPendingRequest(storage), request);
    clearPendingRequest(storage);
    assert.equal(loadPendingRequest(storage), null);
  });

  it("ignores unreadable or foreign content", () => {
    const storage = memory();
    for (const text of ["not json", "null", '{"requestId":1}', '{"requestId":"x","unitId":"U","items":[]}']) {
      storage.values.set(PENDING_STORAGE_KEY, text);
      assert.equal(loadPendingRequest(storage), null, text);
    }
  });

  it("works without storage and when the storage throws", () => {
    const failing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const request = toCreateRequest(source(), REQUEST_ID);
    assert.doesNotThrow(() => savePendingRequest(failing, request));
    assert.doesNotThrow(() => clearPendingRequest(failing));
    assert.equal(loadPendingRequest(failing), null);
    assert.equal(loadPendingRequest(undefined), null);
  });
});
