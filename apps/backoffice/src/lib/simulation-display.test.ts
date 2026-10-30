import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SalesOrderSimulation, SimulatedItem } from "./sales-orders.ts";
import {
  allMessages,
  checkLabel,
  badRequestErrors,
  headerFieldMessages,
  itemMessagesByIndex,
  partnerRoleMessages,
  sortMessages,
  splitChecks,
  STATUS_TEXT,
  totalToShow,
} from "./simulation-display.ts";

const item = (itemNumber: number, changes: Partial<SimulatedItem> = {}): SimulatedItem => ({
  itemNumber,
  materialNumber: "MAT-002",
  materialDescription: "Thermostat",
  quantity: 10,
  unitPrice: "189.50",
  netValue: "1895.00",
  currency: "EUR",
  pricing: { source: "SOLD_TO", conditionType: null, conditionId: 1, validFrom: "2026-01-01", validTo: null, steps: [] },
  messages: [],
  ...changes,
});

const result = (changes: Partial<SalesOrderSimulation> = {}): SalesOrderSimulation => ({
  simulated: true,
  status: "VALID",
  salesArea: { salesOrganization: "1000", distributionChannel: "10", division: "00" },
  currency: "EUR",
  pricingDate: "2026-11-15",
  requestedDeliveryDate: null,
  requestedShippingMethod: "STANDARD",
  customerReference: null,
  customerNote: null,
  partners: null,
  items: [item(10), item(20)],
  totals: { netValue: "3790.00", currency: "EUR", includes: "NET_EXCL_TAX_AND_FREIGHT" },
  requiresSalesReview: false,
  proposedOrderBlock: null,
  checks: [
    { check: "PARTNERS", result: "PASSED" },
    { check: "PRICING", result: "FAILED" },
    { check: "TAX", result: "NOT_PERFORMED", text: "Taxes are not calculated." },
    { check: "CREDIT", result: "NOT_PERFORMED", text: "No credit check." },
  ],
  messages: [],
  ...changes,
});

const msg = (severity: "ERROR" | "WARNING" | "INFO", code: string, field?: string) => ({
  severity,
  code,
  text: code,
  ...(field ? { field } : {}),
});

describe("status and total", () => {
  it("never shows a total for an invalid simulation", () => {
    assert.equal(totalToShow(result())?.netValue, "3790.00");
    assert.equal(totalToShow(result({ status: "VALID_WITH_WARNINGS" }))?.netValue, "3790.00");
    // Even if a total were sent, an INVALID result shows none
    assert.equal(totalToShow(result({ status: "INVALID" })), null);
  });

  it("does not let VALID sound like a delivery promise", () => {
    assert.match(STATUS_TEXT.VALID.text, /delivery is not guaranteed/);
  });
});

describe("checks", () => {
  it("separates performed from not performed checks", () => {
    const { performed, notPerformed } = splitChecks(result().checks);
    assert.deepEqual(performed.map((c) => c.check), ["PARTNERS", "PRICING"]);
    assert.deepEqual(notPerformed.map((c) => c.check), ["TAX", "CREDIT"]);
  });
});

describe("message assignment", () => {
  const messages = [
    msg("INFO", "SAME_MATERIAL_IN_SEVERAL_ITEMS"),
    msg("ERROR", "SHIP_TO_NOT_ALLOWED", "shipToCustomerNumber"),
    msg("ERROR", "MASTER_DATA_INACTIVE", "billTo"),
    msg("ERROR", "MASTER_DATA_INACTIVE", "shipTo"),
    msg("WARNING", "SALES_REVIEW_REQUIRED", "customerNote"),
    msg("INFO", "EXPRESS_REQUESTED", "requestedShippingMethod"),
    msg("ERROR", "REQUESTED_DELIVERY_DATE_BEFORE_ORDER_DATE", "requestedDeliveryDate"),
    msg("ERROR", "UNIT_NOT_FOUND", "unitId"),
  ];
  const simulation = result({ status: "INVALID", messages });

  it("assigns header messages to their input fields", () => {
    const byField = headerFieldMessages(simulation);
    assert.deepEqual(byField.unitId?.map((m) => m.code), ["UNIT_NOT_FOUND"]);
    // An inactive Ship-to belongs to the Ship-to field
    assert.deepEqual(byField.shipToCustomerNumber?.map((m) => m.code), ["SHIP_TO_NOT_ALLOWED", "MASTER_DATA_INACTIVE"]);
    assert.deepEqual(byField.customerNote?.map((m) => m.code), ["SALES_REVIEW_REQUIRED"]);
    assert.deepEqual(byField.requestedShippingMethod?.map((m) => m.code), ["EXPRESS_REQUESTED"]);
    assert.deepEqual(byField.requestedDeliveryDate?.map((m) => m.code), ["REQUESTED_DELIVERY_DATE_BEFORE_ORDER_DATE"]);
  });

  it("assigns inactive partners to their role", () => {
    const byRole = partnerRoleMessages(simulation);
    assert.deepEqual(Object.keys(byRole).sort(), ["billTo", "shipTo"]);
  });

  it("assigns item messages to their position", () => {
    const simulationWithItemError = result({
      items: [item(10), item(20, { messages: [msg("ERROR", "MATERIAL_NOT_FOUND", "materialNumber")] })],
    });
    const byIndex = itemMessagesByIndex(simulationWithItemError);
    assert.deepEqual([...byIndex.keys()], [1]);
    assert.equal(allMessages(simulationWithItemError).length, 1);
  });

  it("sorts errors before warnings before info", () => {
    assert.deepEqual(
      sortMessages(messages).map((m) => m.severity),
      ["ERROR", "ERROR", "ERROR", "ERROR", "ERROR", "WARNING", "INFO", "INFO"],
    );
  });
});

describe("badRequestErrors (HTTP 400)", () => {
  it("maps nested item paths to the position and fields to the header", () => {
    const mapped = badRequestErrors([
      "items.1.quantity must not be less than 1",
      "items.0.materialNumber must not be blank or start or end with whitespace",
      "customerNote must be shorter than or equal to 1000 characters",
      "property soldToCustomerNumber should not exist",
    ]);
    assert.deepEqual(mapped.items.get(1), { quantity: "Quantity must not be less than 1." });
    assert.match(mapped.items.get(0)?.materialNumber ?? "", /^MaterialNumber must not be blank/);
    assert.equal(mapped.header.customerNote, "CustomerNote must be shorter than or equal to 1000 characters.");
    assert.deepEqual(mapped.other, ["Property soldToCustomerNumber should not exist."]);
  });
});

describe("pricing date messages", () => {
  it("are general messages, because there is no pricing date field", () => {
    const mapped = badRequestErrors([
      "pricingDate must be a valid date in the form YYYY-MM-DD (years 1900 to 9999)",
    ]);
    assert.deepEqual(mapped.header, {});
    assert.equal(mapped.other.length, 1);
  });
});

describe("sales area messages", () => {
  it("names the sales area check", () => {
    assert.equal(checkLabel({ check: "SALES_AREA", result: "FAILED" }), "Sales area");
  });

  it("shows sales area errors at the sales area input", () => {
    const message = {
      severity: "ERROR" as const,
      code: "SALES_AREA_INACTIVE",
      text: "Sales area 2000/10/00 is inactive.",
      field: "salesOrganization",
    };
    assert.deepEqual(headerFieldMessages(result({ messages: [message] })).salesArea, [message]);
  });

  it("maps 400 messages of the three sales area fields to the one input", () => {
    const mapped = badRequestErrors([
      "salesOrganization must be 4 capital letters or digits, e.g. 1000",
      "division must be 2 capital letters or digits, e.g. 10",
    ]);
    assert.equal(mapped.header.salesArea, "SalesOrganization must be 4 capital letters or digits, e.g. 1000.");
    assert.deepEqual(mapped.other, []);
  });
});
