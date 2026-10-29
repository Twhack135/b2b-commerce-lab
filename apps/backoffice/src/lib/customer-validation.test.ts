import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateCustomerForm,
  type CustomerFormValues,
} from "./customer-validation.ts";

const valid: CustomerFormValues = {
  customerNumber: "CUST-0001",
  name: "Nordwind Heizungsbau GmbH",
  street: "Hafenstraße 12",
  postalCode: "20457",
  city: "Hamburg",
  country: "DE",
  isActive: true,
};

function errorsFor(
  change: Partial<CustomerFormValues>,
  mode: "create" | "edit" = "create",
) {
  return validateCustomerForm({ ...valid, ...change }, mode);
}

describe("valid customers", () => {
  it("returns no errors for a valid customer", () => {
    assert.deepEqual(validateCustomerForm(valid, "create"), {});
  });

  it("accepts an inactive customer", () => {
    assert.deepEqual(errorsFor({ isActive: false }), {});
  });

  it("accepts values at the maximum length", () => {
    assert.deepEqual(
      errorsFor({
        customerNumber: "C".repeat(20),
        name: "N".repeat(100),
        street: "S".repeat(100),
        postalCode: "1".repeat(10),
        city: "C".repeat(60),
      }),
      {},
    );
  });
});

describe("customer number", () => {
  for (const customerNumber of ["", "   ", "\t"]) {
    it(`rejects blank ${JSON.stringify(customerNumber)}`, () => {
      assert.equal(
        errorsFor({ customerNumber }).customerNumber,
        "Customer number is required.",
      );
    });
  }

  for (const customerNumber of [" CUST-1", "CUST-1 "]) {
    it(`rejects ${JSON.stringify(customerNumber)} instead of trimming it`, () => {
      assert.match(
        errorsFor({ customerNumber }).customerNumber ?? "",
        /start or end with a space/,
      );
    });
  }

  it("rejects more than 20 characters", () => {
    assert.equal(
      errorsFor({ customerNumber: "C".repeat(21) }).customerNumber,
      "Use at most 20 characters.",
    );
  });

  it("is not checked when editing, because it cannot be changed", () => {
    assert.equal(
      errorsFor({ customerNumber: "" }, "edit").customerNumber,
      undefined,
    );
  });
});

describe("name, street and city", () => {
  for (const [field, label, max] of [
    ["name", "Name", 100],
    ["street", "Street", 100],
    ["city", "City", 60],
  ] as const) {
    it(`rejects a whitespace-only ${field}`, () => {
      assert.equal(errorsFor({ [field]: "   " })[field], `${label} is required.`);
    });

    it(`rejects a ${field} longer than ${max}`, () => {
      assert.equal(
        errorsFor({ [field]: "x".repeat(max + 1) })[field],
        `Use at most ${max} characters.`,
      );
    });

    it(`checks the trimmed ${field} length`, () => {
      assert.equal(errorsFor({ [field]: ` ${"x".repeat(max)} ` })[field], undefined);
    });
  }
});

describe("postal code", () => {
  for (const postalCode of ["20457", "1070", "SW1A 1AA", "00-950", " 20457 "]) {
    it(`accepts ${JSON.stringify(postalCode)}`, () => {
      assert.equal(errorsFor({ postalCode }).postalCode, undefined);
    });
  }

  it("rejects a blank postal code", () => {
    assert.equal(errorsFor({ postalCode: "  " }).postalCode, "Postal code is required.");
  });

  for (const postalCode of ["20457#", "-20457", "20457-", "20_457"]) {
    it(`rejects ${JSON.stringify(postalCode)}`, () => {
      assert.equal(
        errorsFor({ postalCode }).postalCode,
        "Use only letters, digits, spaces and hyphens.",
      );
    });
  }

  it("rejects more than 10 characters", () => {
    assert.equal(
      errorsFor({ postalCode: "12345678901" }).postalCode,
      "Use at most 10 characters.",
    );
  });
});

describe("country", () => {
  for (const country of ["DE", "AT", "CH", "US", "ZW"]) {
    it(`accepts ${country}`, () => {
      assert.equal(errorsFor({ country }).country, undefined);
    });
  }

  it("asks to select a country when none is chosen", () => {
    assert.equal(errorsFor({ country: "" }).country, "Select a country.");
  });

  for (const country of ["XX", "XK", "UK", "EU", "de", "DEU"]) {
    it(`rejects ${country}`, () => {
      assert.equal(errorsFor({ country }).country, "Select a valid country.");
    });
  }
});
