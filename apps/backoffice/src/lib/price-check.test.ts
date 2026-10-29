import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  stepStatus,
  toPriceRequest,
  validatePriceCheck,
  type PriceCheckValues,
} from "./price-check.ts";

const valid: PriceCheckValues = {
  materialNumber: "MAT-002",
  unitId: "UNIT-STUTTGART",
  pricingDate: "2026-11-15",
  quantity: "3",
};

describe("validatePriceCheck", () => {
  it("accepts a complete check", () => {
    assert.deepEqual(validatePriceCheck(valid), {});
    assert.deepEqual(validatePriceCheck({ ...valid, quantity: "99999" }), {});
  });

  it("requires every field", () => {
    assert.deepEqual(
      validatePriceCheck({ materialNumber: "", unitId: "", pricingDate: "", quantity: "" }),
      {
        materialNumber: "Select a material.",
        unitId: "Select a B2B unit.",
        pricingDate: "Pricing date is required.",
        quantity: "Quantity is required.",
      },
    );
  });

  for (const [quantity, message] of [
    ["1.5", "Enter a whole number of pieces."],
    ["-1", "Enter a whole number of pieces."],
    ["2 pcs", "Enter a whole number of pieces."],
    ["0", "Quantity must be between 1 and 99,999."],
    ["100000", "Quantity must be between 1 and 99,999."],
  ] as const) {
    it(`rejects the quantity "${quantity}"`, () => {
      assert.equal(validatePriceCheck({ ...valid, quantity }).quantity, message);
    });
  }

  it("rejects an impossible pricing date", () => {
    assert.equal(validatePriceCheck({ ...valid, pricingDate: "2026-11-31" }).pricingDate, "Enter a valid date.");
  });
});

describe("toPriceRequest", () => {
  it("sends the explicit pricing date and the quantity as a whole number", () => {
    assert.deepEqual(toPriceRequest({ ...valid, quantity: " 12 " }), {
      materialNumber: "MAT-002",
      unitId: "UNIT-STUTTGART",
      pricingDate: "2026-11-15",
      quantity: 12,
    });
  });
});

describe("stepStatus", () => {
  it("distinguishes the applied, the overruled and empty levels", () => {
    assert.equal(stepStatus({ source: "B2B_UNIT", conditionId: 1, amount: "1.00", applied: true, conditionType: null }), "applied");
    assert.equal(stepStatus({ source: "SOLD_TO", conditionId: 2, amount: "2.00", applied: false, conditionType: null }), "not-used");
    assert.equal(stepStatus({ source: "B2B_UNIT", conditionId: null, amount: null, applied: false, conditionType: null }), "none");
  });
});
