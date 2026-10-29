import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldOfMessage, splitValidationMessages } from "./form-errors.ts";

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

  // The exact messages the ERP API returns for invalid lists (verified
  // against the real ValidationPipe and DTOs of Sprint 6A)
  describe("messages about list entries", () => {
    const fields = ["shipToCustomerNumbers", "defaultShipToCustomerNumber"] as const;

    for (const message of [
      "each value in shipToCustomerNumbers must be shorter than or equal to 20 characters",
      "each value in shipToCustomerNumbers must be a string",
      "All shipToCustomerNumbers's elements must be unique",
      "shipToCustomerNumbers must not be blank or start or end with whitespace",
      "shipToCustomerNumbers must contain at least 1 elements",
      "shipToCustomerNumbers CUST-9 does not belong to account CUST-1",
    ]) {
      it(`maps "${message}" to shipToCustomerNumbers`, () => {
        const result = splitValidationMessages([message], fields);

        assert.equal(Object.keys(result.fieldErrors).join(), "shipToCustomerNumbers");
        assert.deepEqual(result.otherMessages, []);
      });
    }

    it("keeps the original wording", () => {
      const result = splitValidationMessages(
        ["each value in memberCustomerNumbers must be a string"],
        ["memberCustomerNumbers"],
      );

      assert.deepEqual(result.fieldErrors, {
        memberCustomerNumbers: "Each value in memberCustomerNumbers must be a string.",
      });
    });

    it("does not map list messages of unknown fields", () => {
      const result = splitValidationMessages(
        ["each value in tags must be a string", "All tags's elements must be unique"],
        fields,
      );

      assert.deepEqual(result.fieldErrors, {});
      assert.equal(result.otherMessages.length, 2);
    });
  });
});

describe("fieldOfMessage", () => {
  it("finds the field of a plain, an 'each value in' and an 'All ...'s elements' message", () => {
    const fields = ["memberCustomerNumbers"] as const;

    assert.equal(fieldOfMessage("memberCustomerNumbers M1 is inactive", fields), "memberCustomerNumbers");
    assert.equal(fieldOfMessage("each value in memberCustomerNumbers must be a string", fields), "memberCustomerNumbers");
    assert.equal(fieldOfMessage("All memberCustomerNumbers's elements must be unique", fields), "memberCustomerNumbers");
    assert.equal(fieldOfMessage("Customer account X was changed at the same time.", fields), undefined);
  });
});

describe("splitValidationMessages with labels", () => {
  const fields = ["unitId", "amount", "validTo"] as const;

  it("replaces the API field name with a readable label", () => {
    const result = splitValidationMessages(
      ["unitId UNIT-MUENCHEN is inactive", "amount must be greater than 0"],
      fields,
      { unitId: "B2B unit" },
    );

    assert.deepEqual(result.fieldErrors, {
      unitId: "B2B unit UNIT-MUENCHEN is inactive.",
      amount: "Amount must be greater than 0.",
    });
  });

  it("keeps messages that do not start with the field name", () => {
    const result = splitValidationMessages(
      ["currency must be EUR, the currency of material MAT-002"],
      fields,
      { unitId: "B2B unit" },
    );

    assert.deepEqual(result.otherMessages, [
      "Currency must be EUR, the currency of material MAT-002.",
    ]);
  });
});
