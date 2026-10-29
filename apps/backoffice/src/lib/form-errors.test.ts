import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitValidationMessages } from "./form-errors.ts";

describe("splitValidationMessages", () => {
  it("assigns messages to the field they start with", () => {
    const result = splitValidationMessages(
      ["price must have at most two decimal places", "currency must be exactly three uppercase letters (e.g. EUR)"],
      ["price", "currency"],
    );

    assert.deepEqual(result.fieldErrors, {
      price: "Price must have at most two decimal places.",
      currency: "Currency must be exactly three uppercase letters (e.g. EUR).",
    });
    assert.deepEqual(result.otherMessages, []);
  });

  it("keeps only the first message per field", () => {
    const result = splitValidationMessages(
      ["name must not be blank", "name must be shorter than or equal to 100 characters"],
      ["name"],
    );

    assert.deepEqual(result.fieldErrors, { name: "Name must not be blank." });
  });

  it("does not confuse fields that share a prefix", () => {
    // "name" must not catch a message for a field called "nameSuffix"
    const result = splitValidationMessages(["nameSuffix must not be blank"], ["name"]);

    assert.deepEqual(result.fieldErrors, {});
    assert.deepEqual(result.otherMessages, ["NameSuffix must not be blank."]);
  });

  it("returns unknown messages separately", () => {
    const result = splitValidationMessages(
      ["property color should not exist"],
      ["materialNumber"],
    );

    assert.deepEqual(result.fieldErrors, {});
    assert.deepEqual(result.otherMessages, ["Property color should not exist."]);
  });
});
