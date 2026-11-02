import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createdNotice,
  isSalesOrderNumber,
  orderAmount,
  orderNotes,
  PARTNER_ROLES,
} from "./sales-order-display.ts";
import type { SalesOrder } from "./sales-orders.ts";

const order = (change: Partial<SalesOrder> = {}) =>
  ({
    salesOrderNumber: "1000000001",
    currency: "EUR",
    currencyDecimals: 2,
    orderDate: "2026-10-30",
    timeZone: "Europe/Berlin",
    requestedDeliveryDate: null,
    requestedShippingMethod: "STANDARD",
    ...change,
  }) as SalesOrder;

describe("isSalesOrderNumber", () => {
  it("accepts exactly 10 digits", () => {
    assert.equal(isSalesOrderNumber("1000000001"), true);
    for (const text of ["", "100000000", "10000000011", "100000000a", "SO-1000000", " 1000000001", "simulate"]) {
      assert.equal(isSalesOrderNumber(text), false, text);
    }
  });
});

describe("orderAmount (decimal places of the stored document currency)", () => {
  it("formats EUR and PLN with two and JPY without decimal places", () => {
    assert.equal(orderAmount(order(), "10695.00"), "10,695.00 EUR");
    assert.equal(orderAmount(order({ currency: "PLN" }), "4400.00"), "4,400.00 PLN");
    assert.equal(orderAmount(order({ currency: "JPY", currencyDecimals: 0 }), "700000"), "700,000 JPY");
    assert.equal(orderAmount(order({ currency: "JPY", currencyDecimals: 0 }), "1400000"), "1,400,000 JPY");
  });

  it("keeps exact cents of large amounts (no floating point)", () => {
    assert.equal(orderAmount(order(), "999999999999999.99"), "999,999,999,999,999.99 EUR");
    assert.equal(orderAmount(order(), "0.30"), "0.30 EUR");
  });
});

describe("createdNotice", () => {
  it("distinguishes a new order from a repeated request", () => {
    assert.equal(createdNotice("1000000001", "new"), "Sales order 1000000001 was created.");
    assert.match(createdNotice("1000000001", "existing") ?? "", /no second order was created/);
    assert.equal(createdNotice("1000000001", undefined), null);
    assert.equal(createdNotice("1000000001", "other"), null);
  });
});

describe("orderNotes", () => {
  it("always states net values and the unchecked topics", () => {
    const notes = orderNotes(order());
    assert.equal(notes[0], "All amounts are net values, excluding tax and freight.");
    assert.match(notes[1], /order date 2026-10-30 \(Europe\/Berlin\)/);
    assert.match(notes.at(-1) ?? "", /not been checked/);
  });

  it("explains requested dates and express shipping as unconfirmed", () => {
    const notes = orderNotes(order({ requestedDeliveryDate: "2026-11-30", requestedShippingMethod: "EXPRESS" }));
    assert.ok(notes.some((n) => n.includes("2026-11-30") && n.includes("not a confirmed delivery date")));
    assert.ok(notes.some((n) => n.startsWith("Express shipping was requested")));
  });
});

describe("PARTNER_ROLES", () => {
  it("lists the four partner functions in SAP order", () => {
    assert.deepEqual(
      PARTNER_ROLES.map(([, label]) => label),
      ["Sold-to (SP)", "Ship-to (SH)", "Bill-to (BP)", "Payer (PY)"],
    );
  });
});
