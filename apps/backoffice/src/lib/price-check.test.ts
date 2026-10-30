import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  noPriceFoundOf,
  SOURCE_LABELS,
  stepStatus,
  toPriceRequest,
  validatePriceCheck,
  type PriceCheckValues,
} from "./price-check.ts";

const DE = { salesOrganization: "1000", distributionChannel: "10", division: "00" };
const JP = { ...DE, salesOrganization: "3000" };

const valid: PriceCheckValues = {
  salesArea: "1000/10/00",
  materialNumber: "MAT-002",
  unitId: "UNIT-STUTTGART",
  pricingDate: "2026-11-15",
  quantity: "3",
};

const units = [
  { unitId: "UNIT-STUTTGART", salesArea: DE },
  { unitId: "UNIT-OSAKA", salesArea: JP },
];

describe("validatePriceCheck", () => {
  it("accepts a complete check", () => {
    assert.deepEqual(validatePriceCheck(valid, units), {});
    assert.deepEqual(validatePriceCheck({ ...valid, quantity: "99999" }, units), {});
  });

  it("requires every field", () => {
    assert.deepEqual(
      validatePriceCheck({ salesArea: "", materialNumber: "", unitId: "", pricingDate: "", quantity: "" }),
      {
        salesArea: "Select a sales area.",
        materialNumber: "Select a material.",
        unitId: "Select a B2B unit.",
        pricingDate: "Pricing date is required.",
        quantity: "Quantity is required.",
      },
    );
  });

  it("never checks a unit of another sales area", () => {
    assert.equal(
      validatePriceCheck({ ...valid, unitId: "UNIT-OSAKA" }, units).unitId,
      "B2B unit UNIT-OSAKA belongs to sales area 3000/10/00, not 1000/10/00.",
    );
    assert.equal(validatePriceCheck({ ...valid, salesArea: "3000/10/00", unitId: "UNIT-OSAKA" }, units).unitId, undefined);
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
  it("sends the sales area, the explicit pricing date and the quantity as a whole number", () => {
    assert.deepEqual(toPriceRequest({ ...valid, quantity: " 12 " }), {
      ...DE,
      materialNumber: "MAT-002",
      unitId: "UNIT-STUTTGART",
      pricingDate: "2026-11-15",
      quantity: 12,
    });
  });

  it("never sends a currency: the ERP API takes it from the sales area", () => {
    assert.equal("currency" in toPriceRequest(valid), false);
  });
});

describe("stepStatus and labels", () => {
  it("distinguishes the applied, the overruled and empty levels", () => {
    assert.equal(stepStatus({ source: "B2B_UNIT", conditionId: 1, amount: "1.00", applied: true, conditionType: null }), "applied");
    assert.equal(stepStatus({ source: "SOLD_TO", conditionId: 2, amount: "2.00", applied: false, conditionType: null }), "not-used");
    assert.equal(stepStatus({ source: "SALES_AREA", conditionId: null, amount: null, applied: false, conditionType: null }), "none");
  });

  it("names the list price of the sales area", () => {
    assert.equal(SOURCE_LABELS.SALES_AREA, "List price (sales area)");
  });
});

describe("noPriceFoundOf", () => {
  const steps = [
    { source: "B2B_UNIT", conditionId: null, amount: null, applied: false, conditionType: null },
    { source: "SOLD_TO", conditionId: null, amount: null, applied: false, conditionType: null },
    { source: "SALES_AREA", conditionId: null, amount: null, applied: false, conditionType: null },
  ];

  it("reads the NO_PRICE_FOUND answer of the ERP API with its analysis", () => {
    assert.deepEqual(
      noPriceFoundOf({
        statusCode: 422,
        error: "Unprocessable Entity",
        code: "NO_PRICE_FOUND",
        message: ["No price found for material MAT-2 in sales area 1000/10/00 on 2026-11-15"],
        steps,
      }),
      {
        code: "NO_PRICE_FOUND",
        message: ["No price found for material MAT-2 in sales area 1000/10/00 on 2026-11-15"],
        steps,
      },
    );
  });

  for (const other of [
    null,
    "text",
    { statusCode: 422, message: ["unitId U1 is inactive"] },
    { code: "SOMETHING_ELSE", message: [] },
  ]) {
    it(`ignores other errors: ${JSON.stringify(other)}`, () => {
      assert.equal(noPriceFoundOf(other), null);
    });
  }

  it("tolerates a body without steps", () => {
    assert.deepEqual(noPriceFoundOf({ code: "NO_PRICE_FOUND", message: ["x"] })?.steps, []);
  });
});
