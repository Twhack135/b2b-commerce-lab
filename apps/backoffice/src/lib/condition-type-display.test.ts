import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CALCULATION_TYPE_LABELS,
  CONDITION_CLASS_LABELS,
  conditionTypeLabel,
  RESTRICTION_TEXTS,
} from "./condition-type-display.ts";

describe("condition type display", () => {
  it("labels a condition type with code and description", () => {
    assert.equal(conditionTypeLabel({ code: "ZP02", name: "Customer Net Price" }), "ZP02 – Customer Net Price");
  });

  it("has a text for every condition class and calculation type", () => {
    assert.deepEqual(Object.keys(CONDITION_CLASS_LABELS), ["PRICE", "DISCOUNT_SURCHARGE", "FREIGHT", "TAX"]);
    assert.deepEqual(Object.keys(CALCULATION_TYPE_LABELS), ["QUANTITY", "FIXED_AMOUNT", "PERCENTAGE"]);
    assert.equal(CALCULATION_TYPE_LABELS.QUANTITY, "Per unit");
  });

  it("explains every reason why a type cannot be used", () => {
    assert.equal(RESTRICTION_TEXTS.INACTIVE, "Inactive");
    assert.match(RESTRICTION_TEXTS.CALCULATION_NOT_SUPPORTED, /^Not supported yet/);
    assert.equal(RESTRICTION_TEXTS.NOT_ALLOWED_FOR_CONDITION_RECORDS, "Not allowed for condition records");
  });
});
