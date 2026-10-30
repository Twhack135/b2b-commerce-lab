import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { B2bUnit } from "./b2b-units.ts";
import type { CustomerAccount } from "./customer-accounts.ts";
import {
  accountPartners,
  chooseDefaultShipTo,
  emptyUnitForm,
  inactivePartnerWarnings,
  partnerOptions,
  prefillForAccount,
  toCreateInput,
  toggleShipTo,
  toUpdateInput,
  unitToForm,
  validateB2bUnitForm,
  type B2bUnitFormValues,
} from "./b2b-unit-form.ts";

const p = (customerNumber: string, isActive = true) => ({
  customerNumber,
  name: `Customer ${customerNumber}`,
  isActive,
});

const account: CustomerAccount = {
  accountCustomerNumber: "ACC",
  name: "Customer ACC",
  isActive: true,
  members: [p("SH1"), p("SH2"), p("BP1"), p("OLD", false)],
};
const partners = accountPartners(account);

const valid: B2bUnitFormValues = {
  unitId: "UNIT-1",
  name: "Hamburg Plant",
  salesArea: "1000/10/00",
  accountCustomerNumber: "ACC",
  soldToCustomerNumber: "ACC",
  billToCustomerNumber: "BP1",
  payerCustomerNumber: "ACC",
  shipToCustomerNumbers: ["SH1", "SH2"],
  defaultShipToCustomerNumber: "SH1",
  isActive: true,
};

/** A saved unit as returned by the ERP API */
const savedUnit = (overrides: Partial<B2bUnit> = {}): B2bUnit => ({
  unitId: "UNIT-1",
  name: "Hamburg Plant",
  isActive: true,
  salesArea: { salesOrganization: "1000", distributionChannel: "10", division: "00" },
  account: p("ACC"),
  soldTo: p("ACC"),
  billTo: p("OLD", false),
  payer: p("ACC"),
  shipTos: [
    { ...p("SH1"), isDefault: true },
    { ...p("OLD", false), isDefault: false },
  ],
  defaultShipToCustomerNumber: "SH1",
  ...overrides,
});

const createErrors = (change: Partial<B2bUnitFormValues>) =>
  validateB2bUnitForm({ ...valid, ...change }, { mode: "create", partners });

describe("account partners and options", () => {
  it("lists the account owner first, then the members", () => {
    assert.deepEqual(
      accountPartners(account).map((x) => x.customerNumber),
      ["ACC", "SH1", "SH2", "BP1", "OLD"],
    );
    assert.deepEqual(accountPartners(undefined), []);
  });

  it("never offers an inactive customer for a new assignment", () => {
    const old = partnerOptions(partners).find((o) => o.customerNumber === "OLD");
    assert.equal(old?.isSelectable, false);
  });

  it("keeps an inactive customer that is already assigned selectable", () => {
    const old = partnerOptions(partners, ["OLD"]).find((o) => o.customerNumber === "OLD");
    assert.deepEqual(
      { isAssigned: old?.isAssigned, isSelectable: old?.isSelectable },
      { isAssigned: true, isSelectable: true },
    );
  });

  it("pre-fills all partner functions with an active account owner", () => {
    const values = prefillForAccount(emptyUnitForm(), account);
    assert.deepEqual(
      [
        values.soldToCustomerNumber,
        values.billToCustomerNumber,
        values.payerCustomerNumber,
        values.defaultShipToCustomerNumber,
      ],
      ["ACC", "ACC", "ACC", "ACC"],
    );
    assert.deepEqual(values.shipToCustomerNumbers, ["ACC"]);
  });

  it("does not pre-fill an inactive account owner", () => {
    const values = prefillForAccount(emptyUnitForm(), { ...account, isActive: false });
    assert.equal(values.accountCustomerNumber, "ACC");
    assert.equal(values.soldToCustomerNumber, "");
    assert.deepEqual(values.shipToCustomerNumbers, []);
  });
});

describe("default ship-to behaviour", () => {
  it("makes the first ship-to of an empty list the default", () => {
    const values = toggleShipTo({ ...valid, shipToCustomerNumbers: [], defaultShipToCustomerNumber: "" }, "SH2");
    assert.deepEqual(values.shipToCustomerNumbers, ["SH2"]);
    assert.equal(values.defaultShipToCustomerNumber, "SH2");
  });

  it("adds further ship-tos without changing the default", () => {
    const values = toggleShipTo(valid, "BP1");
    assert.deepEqual(values.shipToCustomerNumbers, ["SH1", "SH2", "BP1"]);
    assert.equal(values.defaultShipToCustomerNumber, "SH1");
  });

  it("removes a ship-to that is not the default", () => {
    assert.deepEqual(toggleShipTo(valid, "SH2").shipToCustomerNumbers, ["SH1"]);
  });

  it("cannot remove the default ship-to", () => {
    assert.equal(toggleShipTo(valid, "SH1"), valid);
  });

  it("can remove the former default after choosing another default", () => {
    const values = toggleShipTo(chooseDefaultShipTo(valid, "SH2"), "SH1");
    assert.deepEqual(values.shipToCustomerNumbers, ["SH2"]);
    assert.equal(values.defaultShipToCustomerNumber, "SH2");
  });

  it("adds a ship-to that is chosen as default but not yet allowed", () => {
    const values = chooseDefaultShipTo(valid, "BP1");
    assert.deepEqual(values.shipToCustomerNumbers, ["SH1", "SH2", "BP1"]);
    assert.equal(values.defaultShipToCustomerNumber, "BP1");
  });

  it("always keeps exactly one default in the list across many changes", () => {
    let values = { ...valid, shipToCustomerNumbers: [] as string[], defaultShipToCustomerNumber: "" };
    for (const step of ["SH1", "SH2", "default:SH2", "SH1", "BP1", "SH2", "default:BP1", "SH2"]) {
      values = step.startsWith("default:")
        ? chooseDefaultShipTo(values, step.slice(8))
        : toggleShipTo(values, step);
      assert.ok(values.shipToCustomerNumbers.includes(values.defaultShipToCustomerNumber), step);
    }
    // ... -> [SH2, BP1] (default SH2, so "SH2" was ignored) -> default BP1 -> remove SH2
    assert.deepEqual(values.shipToCustomerNumbers, ["BP1"]);
    assert.equal(values.defaultShipToCustomerNumber, "BP1");
  });
});

describe("validation when creating", () => {
  it("accepts a valid unit", () => {
    assert.deepEqual(createErrors({}), {});
  });

  it("accepts the same customer in every partner function", () => {
    assert.deepEqual(
      createErrors({
        billToCustomerNumber: "ACC",
        shipToCustomerNumbers: ["ACC"],
        defaultShipToCustomerNumber: "ACC",
      }),
      {},
    );
  });

  for (const [unitId, message] of [
    ["", "Unit ID is required."],
    ["  ", "Unit ID is required."],
    [" UNIT-1", "Unit ID must not start or end with a space."],
    ["UNIT-1 ", "Unit ID must not start or end with a space."],
    ["U".repeat(21), "Use at most 20 characters."],
  ]) {
    it(`rejects unit ID ${JSON.stringify(unitId)}`, () => {
      assert.equal(createErrors({ unitId }).unitId, message);
    });
  }

  it("rejects a blank or too long name", () => {
    assert.equal(createErrors({ name: "   " }).name, "Name is required.");
    assert.equal(createErrors({ name: "N".repeat(101) }).name, "Use at most 100 characters.");
  });

  it("requires an account and every partner function", () => {
    const errors = validateB2bUnitForm(emptyUnitForm(), { mode: "create", partners: [] });
    assert.deepEqual(Object.keys(errors).sort(), [
      "accountCustomerNumber",
      "billToCustomerNumber",
      "defaultShipToCustomerNumber",
      "name",
      "payerCustomerNumber",
      "salesArea",
      "shipToCustomerNumbers",
      "soldToCustomerNumber",
      "unitId",
    ]);
  });

  it("rejects partners outside the account", () => {
    const errors = createErrors({ billToCustomerNumber: "OM", shipToCustomerNumbers: ["SH1", "OM"] });
    assert.equal(errors.billToCustomerNumber, "OM does not belong to this account.");
    assert.equal(errors.shipToCustomerNumbers, "OM does not belong to this account.");
  });

  it("rejects new inactive partners", () => {
    const errors = createErrors({ payerCustomerNumber: "OLD", shipToCustomerNumbers: ["SH1", "OLD"] });
    assert.equal(errors.payerCustomerNumber, "OLD is inactive and cannot be assigned.");
    assert.equal(errors.shipToCustomerNumbers, "OLD is inactive and cannot be assigned.");
  });

  it("rejects a default ship-to outside the list", () => {
    assert.equal(
      createErrors({ defaultShipToCustomerNumber: "BP1" }).defaultShipToCustomerNumber,
      "The default Ship-to must be one of the selected Ship-to partners.",
    );
  });

  it("rejects an empty, duplicated or too long ship-to list", () => {
    assert.equal(createErrors({ shipToCustomerNumbers: [] }).shipToCustomerNumbers, "Select at least one Ship-to.");
    assert.equal(
      createErrors({ shipToCustomerNumbers: ["SH1", "SH1"] }).shipToCustomerNumbers,
      "Each Ship-to can only be selected once.",
    );
    const many = Array.from({ length: 51 }, (_, i) => `S${i}`);
    assert.equal(
      createErrors({ shipToCustomerNumbers: many, defaultShipToCustomerNumber: "S0" }).shipToCustomerNumbers,
      "Select at most 50 Ship-to partners.",
    );
  });
});

describe("validation when editing", () => {
  const original = savedUnit();
  const editErrors = (change: Partial<B2bUnitFormValues>) =>
    validateB2bUnitForm(
      { ...unitToForm(original), ...change },
      { mode: "edit", partners, original },
    );

  it("keeps inactive partners that were already assigned", () => {
    assert.deepEqual(editErrors({ name: "Renamed" }), {});
  });

  it("does not check the read-only unit ID", () => {
    assert.equal(editErrors({ unitId: "" }).unitId, undefined);
  });

  it("rejects an inactive customer in a different partner function", () => {
    // OLD is the Bill-to, but becomes Payer newly
    assert.equal(editErrors({ payerCustomerNumber: "OLD" }).payerCustomerNumber, "OLD is inactive and cannot be assigned.");
  });

  it("rejects an inactive ship-to as new default", () => {
    assert.equal(
      editErrors({ defaultShipToCustomerNumber: "OLD" }).defaultShipToCustomerNumber,
      "OLD is inactive and cannot become the default.",
    );
  });
});

describe("warnings and request bodies", () => {
  it("lists every inactive assigned partner", () => {
    assert.deepEqual(
      inactivePartnerWarnings(
        savedUnit({ shipTos: [{ ...p("SH1", false), isDefault: true }] }),
      ),
      [
        "Bill-to OLD (Customer OLD) is inactive.",
        "Default Ship-to SH1 (Customer SH1) is inactive.",
      ],
    );
    assert.deepEqual(
      inactivePartnerWarnings(savedUnit({ billTo: p("BP1"), shipTos: [{ ...p("SH1"), isDefault: true }] })),
      [],
    );
  });

  it("round-trips a saved unit through the form unchanged", () => {
    const unit = savedUnit();
    assert.deepEqual(toUpdateInput(unitToForm(unit)), {
      name: "Hamburg Plant",
      billToCustomerNumber: "OLD",
      payerCustomerNumber: "ACC",
      shipToCustomerNumbers: ["SH1", "OLD"],
      defaultShipToCustomerNumber: "SH1",
      isActive: true,
    });
  });

  it("trims the name but never the unit ID", () => {
    const input = toCreateInput({ ...valid, name: "  Plant  " });
    assert.equal(input.name, "Plant");
    assert.equal(input.unitId, "UNIT-1");
  });
});
