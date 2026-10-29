import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { B2bUnit } from "./b2b-units.ts";
import type { ConditionType } from "./condition-types.ts";
import type { Customer } from "./customers.ts";
import type { Material } from "./materials.ts";
import {
  conditionToForm,
  conditionWarnings,
  conflictingConditionId,
  emptyConditionForm,
  filterConditions,
  toCreateInput,
  toUpdateInput,
  unitOptions,
  validatePriceConditionForm,
  validityStatus,
  type ConditionFilter,
  type PriceConditionFormValues,
} from "./price-condition-form.ts";
import type { PriceCondition } from "./price-conditions.ts";

const p = (customerNumber: string, isActive = true) => ({
  customerNumber,
  name: `Customer ${customerNumber}`,
  isActive,
});

const materials: Material[] = [
  { materialNumber: "MAT-001", description: "Heat Pump", price: 4500, currency: "EUR" },
  { materialNumber: "MAT-CH", description: "Valve", price: 20, currency: "CHF" },
];

const customers: Customer[] = [
  { ...p("CUST-1000"), street: "s", postalCode: "1", city: "c", country: "DE" },
  { ...p("OLD", false), street: "s", postalCode: "1", city: "c", country: "DE" },
];

const unit = (unitId: string, isActive = true, soldTo = p("CUST-1000")): B2bUnit => ({
  unitId,
  name: `Unit ${unitId}`,
  isActive,
  account: p("CUST-1000"),
  soldTo,
  billTo: p("CUST-1000"),
  payer: p("CUST-1000"),
  shipTos: [{ ...p("CUST-1000"), isDefault: true }],
  defaultShipToCustomerNumber: "CUST-1000",
});

const units = [unit("UNIT-S"), unit("UNIT-OFF", false), unit("UNIT-OLD", true, p("OLD", false))];

/** As configured by the migration: only ZP02 and ZP03 are usable */
const conditionType = (
  code: string,
  name: string,
  restriction: ConditionType["restriction"],
): ConditionType => ({
  code,
  name,
  conditionClass: "PRICE",
  calculationType: "QUANTITY",
  isActive: true,
  sortOrder: 0,
  allowedForConditionRecords: restriction === null,
  usableForPriceConditions: restriction === null,
  restriction,
});
const conditionTypes = [
  conditionType("ZP01", "List Price", "NOT_ALLOWED_FOR_CONDITION_RECORDS"),
  conditionType("ZP02", "Customer Net Price", null),
  conditionType("ZP03", "Special Price", null),
  conditionType("ZD01", "Customer Discount", "CALCULATION_NOT_SUPPORTED"),
];
const ZP02 = { code: "ZP02", name: "Customer Net Price", conditionClass: "PRICE", calculationType: "QUANTITY" } as const;

const context = { mode: "create" as const, materials, customers, units, conditionTypes };

const soldToValues: PriceConditionFormValues = {
  conditionTypeCode: "ZP02",
  materialNumber: "MAT-001",
  scope: "SOLD_TO",
  soldToCustomerNumber: "CUST-1000",
  unitId: "",
  amount: "4350,5",
  validFrom: "2026-01-01",
  validTo: "",
  isActive: true,
};

const unitValues: PriceConditionFormValues = {
  ...soldToValues,
  scope: "B2B_UNIT",
  soldToCustomerNumber: "",
  unitId: "UNIT-S",
};

/** A stored condition as returned by the ERP API */
const condition = (changes: Partial<PriceCondition> = {}): PriceCondition => ({
  conditionId: 7,
  conditionType: ZP02,
  materialNumber: "MAT-001",
  materialDescription: "Heat Pump",
  scope: "B2B_UNIT",
  soldTo: null,
  unit: { unitId: "UNIT-S", name: "Unit UNIT-S", isActive: true, soldTo: p("CUST-1000") },
  amount: "4200.00",
  currency: "EUR",
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  isActive: true,
  ...changes,
});

const errorsOf = (values: PriceConditionFormValues) =>
  validatePriceConditionForm(values, context);

describe("new condition values", () => {
  it("start today, open-ended and active", () => {
    assert.deepEqual(emptyConditionForm("2026-10-29"), {
      conditionTypeCode: "",
      materialNumber: "",
      scope: "",
      soldToCustomerNumber: "",
      unitId: "",
      amount: "",
      validFrom: "2026-10-29",
      validTo: "",
      isActive: true,
    });
  });

  it("are loaded from a stored condition", () => {
    assert.deepEqual(conditionToForm(condition({ validTo: null })), {
      ...unitValues,
      amount: "4200.00",
      validTo: "",
    });
  });
});

describe("validatePriceConditionForm", () => {
  it("accepts valid Sold-to and unit conditions", () => {
    assert.deepEqual(errorsOf(soldToValues), {});
    assert.deepEqual(errorsOf(unitValues), {});
    assert.deepEqual(errorsOf({ ...unitValues, validTo: "2026-01-01" }), {});
  });

  it("requires condition type, material, scope, amount and start", () => {
    assert.deepEqual(errorsOf({ ...emptyConditionForm(""), validFrom: "" }), {
      conditionTypeCode: "Select a condition type.",
      materialNumber: "Select a material.",
      scope: "Select whether the price is for a B2B unit or a Sold-to.",
      amount: "Amount is required.",
      validFrom: "Valid from is required.",
    });
  });

  it("requires the key of the chosen scope", () => {
    assert.equal(errorsOf({ ...soldToValues, soldToCustomerNumber: "" }).soldToCustomerNumber, "Select a Sold-to customer.");
    assert.equal(errorsOf({ ...unitValues, unitId: "" }).unitId, "Select a B2B unit.");
  });

  it("rejects an inactive Sold-to", () => {
    assert.match(errorsOf({ ...soldToValues, soldToCustomerNumber: "OLD" }).soldToCustomerNumber ?? "", /OLD is inactive/);
  });

  it("rejects an inactive unit and a unit with an inactive Sold-to", () => {
    assert.match(errorsOf({ ...unitValues, unitId: "UNIT-OFF" }).unitId ?? "", /UNIT-OFF is inactive/);
    assert.equal(
      errorsOf({ ...unitValues, unitId: "UNIT-OLD" }).unitId,
      "The Sold-to OLD of B2B unit UNIT-OLD is inactive.",
    );
  });

  it("checks amounts and dates", () => {
    assert.equal(errorsOf({ ...soldToValues, amount: "1.999" }).amount, "Use at most two decimal places.");
    assert.equal(errorsOf({ ...soldToValues, validFrom: "2026-02-30" }).validFrom, "Enter a valid date.");
    assert.equal(
      errorsOf({ ...soldToValues, validTo: "2025-12-31" }).validTo,
      "Valid to must not be before valid from.",
    );
    assert.match(errorsOf({ ...soldToValues, validTo: "31.12.2026" }).validTo ?? "", /valid date/);
  });

  describe("when editing", () => {
    const edit = (original: PriceCondition, values: PriceConditionFormValues) =>
      validatePriceConditionForm(values, { ...context, mode: "edit", original });

    it("keeps an active condition editable when its unit became inactive", () => {
      const original = condition({ unit: { ...condition().unit!, isActive: false } });
      const offline = units.map((u) => (u.unitId === "UNIT-S" ? unit("UNIT-S", false) : u));
      assert.deepEqual(
        validatePriceConditionForm(
          { ...conditionToForm(original), amount: "4100" },
          { ...context, units: offline, mode: "edit", original },
        ),
        {},
      );
    });

    it("checks the unit again when the condition is reactivated", () => {
      const original = condition({ isActive: false, unit: { ...condition().unit!, unitId: "UNIT-OFF" } });
      assert.match(
        edit(original, { ...conditionToForm(original), isActive: true }).unitId ?? "",
        /UNIT-OFF is inactive/,
      );
      // Saving it inactive is still possible
      assert.deepEqual(edit(original, conditionToForm(original)), {});
    });

    it("checks the Sold-to again when the condition is reactivated", () => {
      const original = condition({ scope: "SOLD_TO", unit: null, soldTo: p("OLD", false), isActive: false });
      assert.match(
        edit(original, { ...conditionToForm(original), isActive: true }).soldToCustomerNumber ?? "",
        /OLD is inactive/,
      );
    });

    it("does not check the fixed material and scope", () => {
      const original = condition({ materialNumber: "GONE" });
      assert.deepEqual(edit(original, conditionToForm(original)), {});
    });
  });
});

describe("API input", () => {
  it("sends only the key of the scope and the currency of the material", () => {
    assert.deepEqual(toCreateInput(soldToValues, materials), {
      conditionTypeCode: "ZP02",
      materialNumber: "MAT-001",
      scope: "SOLD_TO",
      soldToCustomerNumber: "CUST-1000",
      amount: "4350.50",
      currency: "EUR",
      validFrom: "2026-01-01",
      validTo: null,
      isActive: true,
    });
    assert.deepEqual(
      toCreateInput({ ...unitValues, materialNumber: "MAT-CH", validTo: "2026-06-30" }, materials),
      {
        conditionTypeCode: "ZP02",
        materialNumber: "MAT-CH",
        scope: "B2B_UNIT",
        unitId: "UNIT-S",
        amount: "4350.50",
        currency: "CHF",
        validFrom: "2026-01-01",
        validTo: "2026-06-30",
        isActive: true,
      },
    );
  });

  it("sends the changeable fields when editing; empty end means open-ended", () => {
    assert.deepEqual(toUpdateInput({ ...unitValues, amount: "0.1", isActive: false }), {
      amount: "0.10",
      validFrom: "2026-01-01",
      validTo: null,
      isActive: false,
    });
  });
});

describe("display helpers", () => {
  it("reads the conflicting condition from an overlap message", () => {
    assert.equal(
      conflictingConditionId([
        "The validity period overlaps with active price condition 12 (2026-01-01 to open-ended)",
      ]),
      12,
    );
    assert.equal(conflictingConditionId(["Something else"]), undefined);
  });

  it("derives the validity on a day, with both dates inclusive", () => {
    const c = condition();
    assert.equal(validityStatus(c, "2025-12-31"), "future");
    assert.equal(validityStatus(c, "2026-01-01"), "current");
    assert.equal(validityStatus(c, "2026-12-31"), "current");
    assert.equal(validityStatus(c, "2027-01-01"), "expired");
    assert.equal(validityStatus({ ...c, validTo: null }, "9999-12-31"), "current");
    assert.equal(validityStatus({ ...c, isActive: false }, "2026-06-01"), "inactive");
  });

  it("warns about inactive units and Sold-tos", () => {
    assert.deepEqual(conditionWarnings(condition()), []);
    assert.deepEqual(
      conditionWarnings(condition({ unit: { unitId: "U", name: "U", isActive: false, soldTo: p("OLD", false) } })),
      ["B2B unit U is inactive", "Sold-to OLD of the unit is inactive"],
    );
    assert.deepEqual(
      conditionWarnings(condition({ scope: "SOLD_TO", unit: null, soldTo: p("OLD", false) })),
      ["Sold-to OLD is inactive"],
    );
  });

  it("marks units that cannot get a new price", () => {
    assert.deepEqual(
      unitOptions(units).map((u) => [u.unitId, u.isSelectable, u.note]),
      [
        ["UNIT-S", true, undefined],
        ["UNIT-OFF", false, "inactive"],
        ["UNIT-OLD", false, "inactive Sold-to OLD"],
      ],
    );
  });
});

describe("filterConditions", () => {
  const all = [
    condition({ conditionId: 1 }),
    condition({ conditionId: 2, scope: "SOLD_TO", unit: null, soldTo: p("CUST-1000") }),
    condition({ conditionId: 3, materialNumber: "MAT-002", materialDescription: "Thermostat", isActive: false }),
  ];
  const none: ConditionFilter = { materialNumber: "", scope: "", status: "all", search: "" };
  const ids = (filter: Partial<ConditionFilter>) =>
    filterConditions(all, { ...none, ...filter }).map((c) => c.conditionId);

  it("filters by material, scope, status and search text", () => {
    assert.deepEqual(ids({}), [1, 2, 3]);
    assert.deepEqual(ids({ materialNumber: "MAT-002" }), [3]);
    assert.deepEqual(ids({ scope: "SOLD_TO" }), [2]);
    assert.deepEqual(ids({ status: "active" }), [1, 2]);
    assert.deepEqual(ids({ status: "inactive" }), [3]);
    assert.deepEqual(ids({ search: "thermo" }), [3]);
    assert.deepEqual(ids({ search: "unit-s" }), [1, 3]);
    assert.deepEqual(ids({ scope: "B2B_UNIT", status: "active" }), [1]);
  });
});

describe("condition types in the form", () => {
  it("requires a condition type for a new condition", () => {
    assert.equal(
      validatePriceConditionForm({ ...soldToValues, conditionTypeCode: "" }, context).conditionTypeCode,
      "Select a condition type.",
    );
  });

  it("accepts ZP02 and ZP03", () => {
    for (const conditionTypeCode of ["ZP02", "ZP03"]) {
      assert.equal(
        validatePriceConditionForm({ ...soldToValues, conditionTypeCode }, context).conditionTypeCode,
        undefined,
      );
    }
  });

  it("rejects types the ERP API reports as not usable, e.g. ZP01 and ZD01", () => {
    for (const conditionTypeCode of ["ZP01", "ZD01"]) {
      assert.equal(
        validatePriceConditionForm({ ...soldToValues, conditionTypeCode }, context).conditionTypeCode,
        `Condition type ${conditionTypeCode} cannot be used for new price conditions.`,
      );
    }
  });

  it("leaves the final check to the ERP API while the types are loading", () => {
    assert.equal(
      validatePriceConditionForm(
        { ...soldToValues, conditionTypeCode: "ZP01" },
        { ...context, conditionTypes: undefined },
      ).conditionTypeCode,
      undefined,
    );
  });

  it("does not check the fixed condition type when editing", () => {
    const original = condition({ conditionType: { ...ZP02, code: "ZOLD", name: "Retired" } });
    assert.deepEqual(
      validatePriceConditionForm(conditionToForm(original), { ...context, mode: "edit", original }),
      {},
    );
  });

  it("takes the condition type of a stored condition", () => {
    assert.equal(conditionToForm(condition()).conditionTypeCode, "ZP02");
  });

  it("filters and searches by condition type", () => {
    const zp03 = { ...ZP02, code: "ZP03", name: "Special Price" };
    const all = [condition({ conditionId: 1 }), condition({ conditionId: 2, conditionType: zp03 })];
    const base: ConditionFilter = { materialNumber: "", scope: "", status: "all", search: "" };
    const ids = (filter: Partial<ConditionFilter>) =>
      filterConditions(all, { ...base, ...filter }).map((c) => c.conditionId);
    assert.deepEqual(ids({}), [1, 2]);
    assert.deepEqual(ids({ conditionTypeCode: "ZP03" }), [2]);
    assert.deepEqual(ids({ conditionTypeCode: "" }), [1, 2]);
    assert.deepEqual(ids({ search: "special" }), [2]);
    assert.deepEqual(ids({ search: "zp02" }), [1]);
  });
});
