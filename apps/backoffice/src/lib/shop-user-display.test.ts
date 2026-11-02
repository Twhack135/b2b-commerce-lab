import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { B2bUnit } from "./b2b-units.ts";
import type { CustomerAccount } from "./customer-accounts.ts";
import {
  accountChoices,
  activationBlocker,
  assignableUnits,
  filterCounts,
  filterShopUsers,
  formatTimestamp,
  inactiveUnits,
} from "./shop-user-display.ts";
import type { ShopUserDetail, ShopUserSummary } from "./shop-users.ts";

const user = (overrides: Partial<ShopUserSummary>): ShopUserSummary => ({
  id: "u1",
  email: "anna.weber@mueller.example",
  displayName: "Anna Weber",
  status: "ACTIVE",
  role: "BUYER",
  account: { customerNumber: "CUST-1000", name: "Müller Heiztechnik GmbH", isActive: true },
  access: "GRANTED",
  activation: "ACTIVATED",
  unitCount: 2,
  activeSessionCount: 0,
  createdAt: "2026-11-20T09:00:00.000Z",
  updatedAt: "2026-11-20T09:00:00.000Z",
  ...overrides,
});

const unit = (unitId: string, account: string, isActive = true) =>
  ({ unitId, name: unitId, isActive, account: { customerNumber: account, name: account, isActive: true } }) as B2bUnit;

describe("filterShopUsers", () => {
  const anna = user({});
  const ben = user({ id: "u2", email: "ben@mueller.example", displayName: "Ben Braun", status: "DISABLED", access: "USER_DISABLED" });
  const piotr = user({
    id: "u3",
    email: "piotr@warszawa.example",
    displayName: "Piotr Nowak",
    account: { customerNumber: "PL-1000", name: "Warszawa Ogrzewanie", isActive: false },
    access: "ACCOUNT_INACTIVE",
  });
  const all = [anna, ben, piotr];

  it("searches name, e-mail address and account, ignoring case", () => {
    assert.deepEqual(filterShopUsers(all, "  BEN ", "all"), [ben]);
    assert.deepEqual(filterShopUsers(all, "pl-1000", "all"), [piotr]);
    assert.deepEqual(filterShopUsers(all, "müller", "all"), [anna, ben]);
    assert.deepEqual(filterShopUsers(all, "", "all"), all);
  });

  it("filters by current access: disabled users and inactive accounts have none", () => {
    assert.deepEqual(filterShopUsers(all, "", "access"), [anna]);
    assert.deepEqual(filterShopUsers(all, "", "no-access"), [ben, piotr]);
    assert.deepEqual(filterCounts(all), { all: 3, access: 1, "no-access": 2 });
  });
});

describe("unit choices", () => {
  const units = [
    unit("UNIT-STUTTGART", "CUST-1000"),
    unit("UNIT-MUENCHEN", "CUST-1000"),
    unit("UNIT-ALT", "CUST-1000", false),
    unit("UNIT-WARSZAWA", "PL-1000"),
  ];

  it("offers only active, unassigned units of the user's own account", () => {
    assert.deepEqual(assignableUnits(units, "CUST-1000").map((u) => u.unitId), ["UNIT-MUENCHEN", "UNIT-STUTTGART"]);
    assert.deepEqual(assignableUnits(units, "CUST-1000", ["UNIT-MUENCHEN"]).map((u) => u.unitId), ["UNIT-STUTTGART"]);
    assert.deepEqual(assignableUnits(units, "PL-1000").map((u) => u.unitId), ["UNIT-WARSZAWA"]);
    assert.deepEqual(assignableUnits(units, "JP-1000"), []);
  });

  it("lists inactive units of the account separately", () => {
    assert.deepEqual(inactiveUnits(units, "CUST-1000").map((u) => u.unitId), ["UNIT-ALT"]);
    assert.deepEqual(inactiveUnits(units, "CUST-1000", ["UNIT-ALT"]), []);
    assert.deepEqual(inactiveUnits(units, "PL-1000"), []);
  });
});

describe("accountChoices", () => {
  it("lists active accounts first", () => {
    const account = (accountCustomerNumber: string, isActive: boolean) =>
      ({ accountCustomerNumber, name: accountCustomerNumber, isActive, members: [] }) as CustomerAccount;
    assert.deepEqual(
      accountChoices([account("PL-1000", false), account("JP-1000", true), account("CUST-1000", true)]).map((a) => a.accountCustomerNumber),
      ["CUST-1000", "JP-1000", "PL-1000"],
    );
  });
});

describe("activationBlocker", () => {
  const detail = (overrides: Partial<ShopUserDetail>) =>
    ({ ...user({ activation: "NOT_INVITED" }), units: [], sessions: [], activationDetails: { activatedAt: null, openLink: null }, ...overrides }) as ShopUserDetail;

  it("explains why no link can be created", () => {
    assert.equal(activationBlocker(detail({})), null);
    assert.equal(activationBlocker(detail({ activation: "LINK_EXPIRED" })), null);
    assert.equal(activationBlocker(detail({ activation: "ACTIVATED" })), "The user has already set a password.");
    assert.match(activationBlocker(detail({ status: "DISABLED" })) ?? "", /Enable the user/);
    assert.match(
      activationBlocker(detail({ account: { customerNumber: "CUST-1000", name: "M", isActive: false } })) ?? "",
      /inactive/,
    );
  });
});

describe("formatTimestamp", () => {
  it("shows minutes in UTC", () => {
    assert.equal(formatTimestamp("2026-11-20T09:05:59.999Z"), "2026-11-20 09:05 UTC");
  });
});
