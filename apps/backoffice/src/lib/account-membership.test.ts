import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerAccount } from "./customer-accounts.ts";
import {
  candidateNote,
  memberCandidates,
  memberErrors,
  ownerOptions,
  validateMemberSelection,
} from "./account-membership.ts";

const c = (customerNumber: string, isActive = true) => ({
  customerNumber,
  name: `Customer ${customerNumber}`,
  isActive,
});

const customers = [c("ACC"), c("M1"), c("OLDM", false), c("FREE"), c("OFF", false), c("OTHER"), c("OM")];

const accounts: CustomerAccount[] = [
  { accountCustomerNumber: "ACC", name: "Customer ACC", isActive: true, members: [c("M1"), c("OLDM", false)] },
  { accountCustomerNumber: "OTHER", name: "Customer OTHER", isActive: true, members: [c("OM")] },
];

const statusOf = (accountNumber: string) =>
  Object.fromEntries(
    memberCandidates(customers, accounts, accountNumber).map((x) => [
      x.customerNumber,
      `${x.status}${x.isSelectable ? "" : " (locked)"}`,
    ]),
  );

describe("memberCandidates", () => {
  it("classifies every customer except the owner", () => {
    assert.deepEqual(statusOf("ACC"), {
      M1: "member",
      OLDM: "member",
      FREE: "available",
      OFF: "inactive (locked)",
      OTHER: "owner-of-other (locked)",
      OM: "member-of-other (locked)",
    });
  });

  it("works for a new account without members", () => {
    assert.deepEqual(statusOf("FREE"), {
      ACC: "owner-of-other (locked)",
      M1: "member-of-other (locked)",
      OLDM: "member-of-other (locked)",
      OFF: "inactive (locked)",
      OTHER: "owner-of-other (locked)",
      OM: "member-of-other (locked)",
    });
  });

  it("explains why a customer cannot be chosen", () => {
    const notes = Object.fromEntries(
      memberCandidates(customers, accounts, "ACC").map((x) => [x.customerNumber, candidateNote(x)]),
    );
    assert.deepEqual(notes, {
      M1: undefined,
      OLDM: "Inactive – kept as member",
      FREE: undefined,
      OFF: "Inactive customers cannot be added",
      OTHER: "Owns its own account",
      OM: "Member of account OTHER",
    });
  });
});

describe("ownerOptions", () => {
  it("offers existing owners and active customers without an account", () => {
    assert.deepEqual(
      ownerOptions(customers, accounts).map((o) => `${o.customerNumber}${o.hasAccount ? " (account)" : ""}`),
      ["ACC (account)", "FREE", "OTHER (account)"],
    );
  });
});

describe("validateMemberSelection", () => {
  const candidates = memberCandidates(customers, accounts, "ACC");

  it("accepts members, kept inactive members and free customers", () => {
    assert.equal(validateMemberSelection(["M1", "OLDM", "FREE"], candidates), undefined);
  });

  it("rejects customers of other accounts and inactive newcomers", () => {
    assert.equal(validateMemberSelection(["OM"], candidates), "OM cannot be added: member of account other.");
    assert.equal(validateMemberSelection(["OTHER"], candidates), "OTHER cannot be added: owns its own account.");
    assert.equal(validateMemberSelection(["OFF"], candidates), "OFF cannot be added: inactive customers cannot be added.");
    assert.equal(validateMemberSelection(["ACC"], candidates), "ACC cannot be a member of this account.");
  });
});

describe("memberErrors", () => {
  it("assigns ERP API messages to the customer they are about", () => {
    const errors = memberErrors([
      "memberCustomerNumbers CUST-0004 is still used as a partner in B2B unit NW-BREMEN, NW-HAMBURG",
      "memberCustomerNumbers OM is already a member of account OTHER",
      "memberCustomerNumbers GHOST does not exist",
      "memberCustomerNumbers OTHER owns its own account and cannot be a member of another account",
      "memberCustomerNumbers must not contain the account owner ACC",
      "The account was changed at the same time. Please reload and try again.",
    ]);

    assert.deepEqual(Object.fromEntries(errors), {
      "CUST-0004": "CUST-0004 is still used as a partner in B2B unit NW-BREMEN, NW-HAMBURG.",
      OM: "OM is already a member of account OTHER.",
      GHOST: "GHOST does not exist.",
      OTHER: "OTHER owns its own account and cannot be a member of another account.",
    });
  });
});
