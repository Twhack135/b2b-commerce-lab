import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateMaterialForm,
  type MaterialFormValues,
} from "./material-validation.ts";

const valid: MaterialFormValues = {
  materialNumber: "MAT-003",
  description: "Circulation Pump",
};

function errorsFor(change: Partial<MaterialFormValues>, mode: "create" | "edit" = "create") {
  return validateMaterialForm({ ...valid, ...change }, mode);
}

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

describe("description validation", () => {
  it("rejects a whitespace-only description", () => {
    assert.equal(errorsFor({ description: "   " }).description, "Description is required.");
  });

  it("accepts a complete material", () => {
    assert.deepEqual(errorsFor({}), {});
  });
});

describe("no price in the material master", () => {
  it("has neither a price nor a currency field (prices are per sales area)", () => {
    assert.deepEqual(Object.keys(validateMaterialForm({ materialNumber: "", description: "" }, "create")).sort(), [
      "description",
      "materialNumber",
    ]);
  });
});
