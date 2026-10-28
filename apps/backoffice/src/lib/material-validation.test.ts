import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePrice,
  validateMaterialForm,
  type MaterialFormValues,
} from "./material-validation.ts";

const valid: MaterialFormValues = {
  materialNumber: "MAT-003",
  description: "Circulation Pump",
  price: "349.99",
  currency: "EUR",
};

function errorsFor(change: Partial<MaterialFormValues>, mode: "create" | "edit" = "create") {
  return validateMaterialForm({ ...valid, ...change }, mode);
}

describe("price validation", () => {
  for (const price of ["349.99", "349,99", "1", "0.01", "12.5", "9999999999.99"]) {
    it(`accepts ${price}`, () => {
      assert.equal(errorsFor({ price }).price, undefined);
    });
  }

  for (const price of ["1.999", "0.001", "349,999", "12.3456", "9999999999.999"]) {
    it(`rejects ${price} instead of rounding it`, () => {
      assert.equal(errorsFor({ price }).price, "Use at most two decimal places.");
    });
  }

  for (const price of ["", "  ", "abc", "-5", "1e-7", "1.2.3", "1,000.50", "."]) {
    it(`rejects ${JSON.stringify(price)}`, () => {
      assert.notEqual(errorsFor({ price }).price, undefined);
    });
  }

  it("rejects 0 and values above the database limit", () => {
    assert.equal(errorsFor({ price: "0" }).price, "Price must be at least 0.01.");
    assert.equal(errorsFor({ price: "10000000000" }).price, "Price must not exceed 9,999,999,999.99.");
  });

  it("parses a validated price exactly, without rounding", () => {
    assert.equal(parsePrice("349,99"), 349.99);
    assert.equal(parsePrice(" 12.5 "), 12.5);
    assert.equal(parsePrice("9999999999.99"), 9999999999.99);
  });
});

describe("material number validation", () => {
  it("accepts a valid number", () => {
    assert.equal(errorsFor({ materialNumber: "MAT 003" }).materialNumber, undefined);
  });

  for (const materialNumber of ["", "   ", "\t"]) {
    it(`rejects blank ${JSON.stringify(materialNumber)}`, () => {
      assert.equal(errorsFor({ materialNumber }).materialNumber, "Material number is required.");
    });
  }

  for (const materialNumber of [" MAT-003", "MAT-003 "]) {
    it(`rejects ${JSON.stringify(materialNumber)} instead of trimming it`, () => {
      assert.match(errorsFor({ materialNumber }).materialNumber ?? "", /start or end with a space/);
    });
  }

  it("is not checked when editing, because it cannot be changed", () => {
    assert.equal(errorsFor({ materialNumber: "" }, "edit").materialNumber, undefined);
  });
});

describe("description and currency validation", () => {
  it("rejects a whitespace-only description", () => {
    assert.equal(errorsFor({ description: "   " }).description, "Description is required.");
  });

  for (const currency of ["eur", "EU", "EURO", "E1R", ""]) {
    it(`rejects currency ${JSON.stringify(currency)}`, () => {
      assert.notEqual(errorsFor({ currency }).currency, undefined);
    });
  }

  it("returns no errors for a valid material", () => {
    assert.deepEqual(validateMaterialForm(valid, "create"), {});
  });
});
