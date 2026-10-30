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
  scopesOf,
  soldToOptions,
  toCreateInput,
  toUpdateInput,
  unitOptions,
  validatePriceConditionForm,
  validityStatus,
  type ConditionFilter,
  type PriceConditionFormValues,
} from "./price-condition-form.ts";
import type { PriceCondition } from "./price-conditions.ts";
import type { SalesArea } from "./sales-areas.ts";

const p = (customerNumber: string, isActive = true) => ({
  customerNumber,
  name: `Customer ${customerNumber}`,
  isActive,
});

const DE = { salesOrganization: "1000", distributionChannel: "10", division: "00" };
const PL = { ...DE, salesOrganization: "2000" };
const JP = { ...DE, salesOrganization: "3000" };

const area = (key: typeof DE, currency: string, currencyDecimals: number, isActive = true): SalesArea => ({
  ...key,
  salesOrganizationName: `Org ${key.salesOrganization}`,
  distributionChannelName: "Direct Sales",
  divisionName: "Cross-Division",
  country: "DE",
  currency,
  currencyDecimals,
  isActive,
});
/** As configured: Germany EUR, Japan JPY (no decimals); Poland inactive for the tests */
const salesAreas = [area(DE, "EUR", 2), area(PL, "PLN", 2, false), area(JP, "JPY", 0)];

// Materials have no price of their own
const materials: Material[] = [
  { materialNumber: "MAT-001", description: "Heat Pump" },
  { materialNumber: "MAT-002", description: "Thermostat" },
];

const customer = (
  number: string,
  isActive: boolean,
  salesAreasOfCustomer: { key: typeof DE; isActive: boolean }[],
): Customer => ({
  ...p(number, isActive),
  street: "s",
  postalCode: "1",
  city: "c",
  country: "DE",
  salesAreas: salesAreasOfCustomer.map((a) => ({ ...a.key, isActive: a.isActive })),
});
// NOAREA is not assigned to Germany, PAUSED is inactive there
const customers: Customer[] = [
  customer("CUST-1000", true, [{ key: DE, isActive: true }, { key: JP, isActive: true }]),
  customer("OLD", false, [{ key: DE, isActive: true }]),
  customer("NOAREA", true, []),
  customer("PAUSED", true, [{ key: DE, isActive: false }]),
];

const unit = (unitId: string, isActive = true, soldTo = p("CUST-1000")): B2bUnit => ({
  unitId,
  name: `Unit ${unitId}`,
  isActive,
  salesArea: { salesOrganization: "1000", distributionChannel: "10", division: "00" },
  account: p("CUST-1000"),
  soldTo,
  billTo: p("CUST-1000"),
  payer: p("CUST-1000"),
  shipTos: [{ ...p("CUST-1000"), isDefault: true }],
  defaultShipToCustomerNumber: "CUST-1000",
});

const units = [
  unit("UNIT-S"),
  unit("UNIT-OFF", false),
  unit("UNIT-OLD", true, p("OLD", false)),
  { ...unit("UNIT-JP"), salesArea: JP },
];

/** As configured: ZP01 per sales area, ZP02 and ZP03 per Sold-to or unit */
const conditionType = (
  code: string,
  name: string,
  restriction: ConditionType["restriction"],
  allowedScopes: ConditionType["allowedScopes"] = [],
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
  allowedScopes,
});
const conditionTypes = [
  conditionType("ZP01", "List Price", null, ["SALES_AREA"]),
  conditionType("ZP02", "Customer Net Price", null, ["B2B_UNIT", "SOLD_TO"]),
  conditionType("ZP03", "Special Price", null, ["B2B_UNIT", "SOLD_TO"]),
  conditionType("ZD01", "Customer Discount", "CALCULATION_NOT_SUPPORTED"),
];
const ZP02 = { code: "ZP02", name: "Customer Net Price", conditionClass: "PRICE", calculationType: "QUANTITY" } as const;

const context = { mode: "create" as const, salesAreas, materials, customers, units, conditionTypes };

const soldToValues: PriceConditionFormValues = {
  salesArea: "1000/10/00",
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
  salesArea: DE,
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
      // Germany unless the user chooses another sales area
      salesArea: "1000/10/00",
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
      scope: "Select the level of the price.",
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
  it("sends the sales area and only the key of the scope, never a currency", () => {
    assert.deepEqual(toCreateInput(soldToValues, 2), {
      ...DE,
      conditionTypeCode: "ZP02",
      materialNumber: "MAT-001",
      scope: "SOLD_TO",
      soldToCustomerNumber: "CUST-1000",
      amount: "4350.50",
      validFrom: "2026-01-01",
      validTo: null,
      isActive: true,
    });
    assert.deepEqual(
      toCreateInput({ ...unitValues, materialNumber: "MAT-002", validTo: "2026-06-30" }, 2),
      {
        ...DE,
        conditionTypeCode: "ZP02",
        materialNumber: "MAT-002",
        scope: "B2B_UNIT",
        unitId: "UNIT-S",
        amount: "4350.50",
        validFrom: "2026-01-01",
        validTo: "2026-06-30",
        isActive: true,
      },
    );
  });

  it("sends a list price without Sold-to and unit", () => {
    assert.deepEqual(
      toCreateInput(
        { ...soldToValues, conditionTypeCode: "ZP01", scope: "SALES_AREA", soldToCustomerNumber: "", amount: "4500" },
        2,
      ),
      {
        ...DE,
        conditionTypeCode: "ZP01",
        materialNumber: "MAT-001",
        scope: "SALES_AREA",
        amount: "4500.00",
        validFrom: "2026-01-01",
        validTo: null,
        isActive: true,
      },
    );
  });

  it("sends JPY amounts without decimal places", () => {
    const values = { ...soldToValues, salesArea: "3000/10/00", amount: "0700000" };
    assert.equal(toCreateInput(values, 0).amount, "700000");
    assert.equal(toCreateInput(values, 0).salesOrganization, "3000");
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
      unitOptions(units, "1000/10/00").map((u) => [u.unitId, u.isSelectable, u.note]),
      [
        ["UNIT-S", true, undefined],
        ["UNIT-OFF", false, "inactive"],
        ["UNIT-OLD", false, "inactive Sold-to OLD"],
      ],
    );
  });
});

describe("sales areas and markets", () => {
  it("offers only the units of the sales area", () => {
    assert.deepEqual(unitOptions(units, "3000/10/00").map((u) => u.unitId), ["UNIT-JP"]);
    assert.deepEqual(unitOptions(units, "2000/10/00"), []);
  });

  it("offers only customers active in the sales area as Sold-to", () => {
    assert.deepEqual(
      soldToOptions(customers, "1000/10/00").map((c) => [c.customerNumber, c.isSelectable, c.note ?? null]),
      [
        ["CUST-1000", true, null],
        ["OLD", false, "inactive"],
        ["NOAREA", false, "not assigned to the sales area"],
        ["PAUSED", false, "inactive in the sales area"],
      ],
    );
    assert.deepEqual(
      soldToOptions(customers, "3000/10/00").filter((c) => c.isSelectable).map((c) => c.customerNumber),
      ["CUST-1000"],
    );
  });

  it("requires an active sales area", () => {
    assert.equal(errorsOf({ ...soldToValues, salesArea: "" }).salesArea, "Select a sales area.");
    assert.equal(
      errorsOf({ ...soldToValues, salesArea: "2000/10/00" }).salesArea,
      "This sales area is inactive and cannot get new prices.",
    );
  });

  it("rejects customers and units of another market", () => {
    assert.equal(
      errorsOf({ ...soldToValues, soldToCustomerNumber: "NOAREA" }).soldToCustomerNumber,
      "Customer NOAREA is not assigned to sales area 1000/10/00.",
    );
    assert.equal(
      errorsOf({ ...soldToValues, soldToCustomerNumber: "PAUSED" }).soldToCustomerNumber,
      "Customer PAUSED is inactive in sales area 1000/10/00.",
    );
    assert.equal(
      errorsOf({ ...unitValues, unitId: "UNIT-JP" }).unitId,
      "B2B unit UNIT-JP belongs to sales area 3000/10/00, not 1000/10/00.",
    );
    assert.deepEqual(errorsOf({ ...unitValues, salesArea: "3000/10/00", unitId: "UNIT-JP", amount: "700000" }), {});
  });

  it("uses the configured scopes of the condition type", () => {
    assert.deepEqual(scopesOf(conditionTypes[0]), ["SALES_AREA"]);
    assert.deepEqual(scopesOf(conditionTypes[1]), ["B2B_UNIT", "SOLD_TO"]);
    assert.deepEqual(scopesOf(undefined), []);
    const listPrice = { ...soldToValues, conditionTypeCode: "ZP01", scope: "SALES_AREA" as const, soldToCustomerNumber: "" };
    assert.deepEqual(errorsOf(listPrice), {});
    assert.equal(
      errorsOf({ ...soldToValues, conditionTypeCode: "ZP01" }).scope,
      "Condition type ZP01 cannot be used for the level Sold-to.",
    );
    assert.equal(
      errorsOf({ ...listPrice, conditionTypeCode: "ZP02" }).scope,
      "Condition type ZP02 cannot be used for the level Sales area.",
    );
  });

  it("checks the amount with the decimal places of the currency", () => {
    const japan = { ...unitValues, salesArea: "3000/10/00", unitId: "UNIT-JP" };
    assert.equal(
      errorsOf({ ...japan, amount: "700000.50" }).amount,
      "Enter a whole amount: this currency has no decimal places.",
    );
    assert.equal(errorsOf({ ...japan, amount: "700000" }).amount, undefined);
    assert.equal(errorsOf({ ...soldToValues, amount: "4400.50" }).amount, undefined);
  });

  it("loads the sales area of a stored condition", () => {
    assert.equal(conditionToForm(condition({ salesArea: JP })).salesArea, "3000/10/00");
  });
});

describe("filterConditions", () => {
  const all = [
    condition({ conditionId: 1 }),
    condition({ conditionId: 2, scope: "SOLD_TO", unit: null, soldTo: p("CUST-1000") }),
    condition({ conditionId: 3, materialNumber: "MAT-002", materialDescription: "Thermostat", isActive: false }),
  ];
  const none: ConditionFilter = { salesArea: "", materialNumber: "", scope: "", status: "all", search: "" };
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

  // A list price has neither a Sold-to nor a unit
  const listPrice = condition({
    conditionId: 4,
    conditionType: { ...ZP02, code: "ZP01", name: "List Price" },
    scope: "SALES_AREA",
    soldTo: null,
    unit: null,
  });
  const japan = condition({ conditionId: 5, salesArea: JP, amount: "700000", currency: "JPY" });

  it("handles list prices without Sold-to and unit", () => {
    const filtered = filterConditions([...all, listPrice], { ...none, search: "list" });
    assert.deepEqual(filtered.map((c) => c.conditionId), [4]);
    assert.deepEqual(conditionWarnings(listPrice), []);
    assert.deepEqual(
      filterConditions([...all, listPrice], { ...none, scope: "SALES_AREA" }).map((c) => c.conditionId),
      [4],
    );
  });

  it("filters and searches by sales area", () => {
    const both = [...all, japan];
    assert.deepEqual(
      filterConditions(both, { ...none, salesArea: "3000/10/00" }).map((c) => c.conditionId),
      [5],
    );
    assert.deepEqual(
      filterConditions(both, { ...none, salesArea: "1000/10/00" }).map((c) => c.conditionId),
      [1, 2, 3],
    );
    assert.deepEqual(filterConditions(both, { ...none, search: "3000/" }).map((c) => c.conditionId), [5]);
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

  it("rejects types the ERP API reports as not usable, e.g. ZD01", () => {
    for (const conditionTypeCode of ["ZD01"]) {
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
