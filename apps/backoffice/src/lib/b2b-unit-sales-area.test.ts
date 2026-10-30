import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountPartners,
  emptyUnitForm,
  inactivePartnerWarnings,
  partnerOptions,
  prefillForAccount,
  salesAreaStatusLookup,
  toCreateInput,
  toUpdateInput,
  unitToForm,
  validateB2bUnitForm,
  type B2bUnitFormValues,
} from "./b2b-unit-form.ts";
import type { B2bUnit } from "./b2b-units.ts";
import type { CustomerAccount } from "./customer-accounts.ts";
import type { Customer } from "./customers.ts";
import type { SalesArea } from "./sales-areas.ts";

// Sales area rules of the B2B unit form (Sprint 9C-A)

const DE = { salesOrganization: "1000", distributionChannel: "10", division: "00" };

const p = (customerNumber: string, isActive = true) => ({
  customerNumber,
  name: `Customer ${customerNumber}`,
  isActive,
});

// NOAREA is not assigned to 1000/10/00, PAUSED is assigned but inactive
const customer = (customerNumber: string, salesAreas = [{ ...DE, isActive: true }]): Customer => ({
  ...p(customerNumber),
  street: "s",
  postalCode: "1",
  city: "c",
  country: "DE",
  salesAreas,
});
const customers = [
  customer("ACC"),
  customer("SH1"),
  customer("BP1"),
  customer("NOAREA", []),
  customer("PAUSED", [{ ...DE, isActive: false }]),
];

const account: CustomerAccount = {
  accountCustomerNumber: "ACC",
  name: "Customer ACC",
  isActive: true,
  members: [p("SH1"), p("BP1"), p("NOAREA"), p("PAUSED")],
};
const partners = accountPartners(account);
const statusOf = salesAreaStatusLookup(customers, "1000/10/00");

const valid: B2bUnitFormValues = {
  unitId: "UNIT-1",
  name: "Hamburg Plant",
  salesArea: "1000/10/00",
  accountCustomerNumber: "ACC",
  soldToCustomerNumber: "ACC",
  billToCustomerNumber: "BP1",
  payerCustomerNumber: "ACC",
  shipToCustomerNumbers: ["SH1"],
  defaultShipToCustomerNumber: "SH1",
  isActive: true,
};

const savedUnit = (overrides: Partial<B2bUnit> = {}): B2bUnit => ({
  unitId: "UNIT-1",
  name: "Hamburg Plant",
  isActive: true,
  salesArea: DE,
  account: p("ACC"),
  soldTo: p("ACC"),
  billTo: p("PAUSED"),
  payer: p("ACC"),
  shipTos: [{ ...p("SH1"), isDefault: true }],
  defaultShipToCustomerNumber: "SH1",
  ...overrides,
});

const germany = (isActive = true): SalesArea => ({
  ...DE,
  salesOrganizationName: "B2B Lab Germany",
  distributionChannelName: "Direct Sales",
  divisionName: "Cross-Division",
  country: "DE",
  currency: "EUR",
  currencyDecimals: 2,
  isActive,
});

const createErrors = (change: Partial<B2bUnitFormValues>, salesAreas = [germany()]) =>
  validateB2bUnitForm({ ...valid, ...change }, { mode: "create", partners, salesAreas, statusOf });

describe("assignment lookup", () => {
  it("knows the assignment status of loaded customers", () => {
    assert.equal(statusOf("ACC"), "active");
    assert.equal(statusOf("PAUSED"), "inactive");
    assert.equal(statusOf("NOAREA"), "missing");
  });

  it("does not guess when the status is not known", () => {
    assert.equal(statusOf("GHOST"), undefined);
    assert.equal(salesAreaStatusLookup(customers, "")("ACC"), undefined);
    assert.equal(salesAreaStatusLookup(null, "1000/10/00")("ACC"), undefined);
  });
});

describe("partner options in a sales area", () => {
  const options = partnerOptions(partners, [], statusOf);
  const option = (n: string) => options.find((o) => o.customerNumber === n);

  it("offers customers that are active in the sales area", () => {
    assert.equal(option("SH1")?.isSelectable, true);
  });

  it("never offers customers that are not active in the sales area", () => {
    assert.equal(option("NOAREA")?.isSelectable, false);
    assert.equal(option("NOAREA")?.salesAreaStatus, "missing");
    assert.equal(option("PAUSED")?.isSelectable, false);
    assert.equal(option("PAUSED")?.salesAreaStatus, "inactive");
  });

  it("keeps an already assigned partner selectable", () => {
    const paused = partnerOptions(partners, ["PAUSED"], statusOf).find((o) => o.customerNumber === "PAUSED");
    assert.equal(paused?.isSelectable, true);
  });

  it("pre-fills the owner only if it is active in the sales area", () => {
    assert.equal(prefillForAccount(emptyUnitForm(), account, statusOf).soldToCustomerNumber, "ACC");
    const notAssigned = salesAreaStatusLookup([customer("ACC", [])], "1000/10/00");
    const values = prefillForAccount(emptyUnitForm(), account, notAssigned);
    assert.equal(values.soldToCustomerNumber, "");
    assert.deepEqual(values.shipToCustomerNumbers, []);
  });
});

describe("validation", () => {
  it("requires a sales area when creating", () => {
    assert.equal(createErrors({ salesArea: "" }).salesArea, "Select a sales area.");
    assert.equal(createErrors({ salesArea: "1000-10-00" }).salesArea, "Select a sales area.");
    assert.equal(createErrors({}).salesArea, undefined);
  });

  it("rejects an inactive sales area", () => {
    assert.equal(
      createErrors({}, [germany(false)]).salesArea,
      "This sales area is inactive and cannot be used for new units.",
    );
  });

  it("rejects new partners that are not active in the sales area", () => {
    const errors = createErrors({ billToCustomerNumber: "PAUSED", shipToCustomerNumbers: ["SH1", "NOAREA"] });
    assert.equal(errors.billToCustomerNumber, "PAUSED is inactive in sales area 1000/10/00.");
    assert.equal(errors.shipToCustomerNumbers, "NOAREA is not assigned to sales area 1000/10/00.");
  });

  it("keeps unchanged partners of an active unit, but checks them on reactivation", () => {
    const edit = (original: B2bUnit, isActive: boolean) =>
      validateB2bUnitForm(
        { ...unitToForm(original), isActive },
        { mode: "edit", partners, original, statusOf },
      ).billToCustomerNumber;

    assert.equal(edit(savedUnit(), true), undefined);
    assert.equal(
      edit(savedUnit({ isActive: false }), true),
      "PAUSED is inactive in sales area 1000/10/00.",
    );
    // An inactive unit that stays inactive keeps its partners
    assert.equal(edit(savedUnit({ isActive: false }), false), undefined);
  });

  it("does not check the sales area of a saved unit again", () => {
    const errors = validateB2bUnitForm(unitToForm(savedUnit()), {
      mode: "edit",
      partners,
      original: savedUnit(),
      salesAreas: [germany(false)],
      statusOf,
    });
    assert.equal(errors.salesArea, undefined);
  });
});

describe("warnings and request bodies", () => {
  it("warns about partners that are no longer active in the sales area", () => {
    assert.deepEqual(inactivePartnerWarnings(savedUnit({ isActive: false }), statusOf), [
      "PAUSED (Customer PAUSED) is not active in sales area 1000/10/00.",
    ]);
    // Without assignment data only inactive customers are reported
    assert.deepEqual(inactivePartnerWarnings(savedUnit()), []);
  });

  it("sends the sales area as three fields, and only when creating", () => {
    const input = toCreateInput(valid);
    assert.deepEqual(
      {
        salesOrganization: input.salesOrganization,
        distributionChannel: input.distributionChannel,
        division: input.division,
      },
      DE,
    );
    assert.equal("salesOrganization" in toUpdateInput(valid), false);
    assert.equal("salesArea" in input, false);
  });

  it("shows the sales area of a saved unit", () => {
    assert.equal(unitToForm(savedUnit()).salesArea, "1000/10/00");
  });
});
