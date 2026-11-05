import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignmentLabel, stepDescription, stepFlags } from "./pricing-procedure-display.ts";
import type { PricingProcedureStep } from "./pricing-procedures.ts";

const type = (code: string) => ({ code, name: code, conditionClass: "PRICE", calculationType: "QUANTITY" }) as const;
const base: PricingProcedureStep = {
  stepNumber: 10,
  kind: "CONDITION",
  label: "Base price",
  accessSequence: {
    code: "ZBP1",
    name: "Base price",
    accesses: [
      { accessNumber: 10, conditionType: type("ZP03"), scope: "B2B_UNIT", materialSpecific: true },
      { accessNumber: 20, conditionType: type("ZP02"), scope: "B2B_UNIT", materialSpecific: true },
      { accessNumber: 30, conditionType: type("ZP03"), scope: "SOLD_TO", materialSpecific: true },
      { accessNumber: 50, conditionType: type("ZP01"), scope: "SALES_AREA", materialSpecific: true },
    ],
  },
  fromStep: null,
  toStep: null,
  statistical: false,
  mandatory: true,
  subtotalKey: null,
  customerVisible: true,
};

describe("pricing procedure display", () => {
  it("describes condition steps by their access sequence and condition types", () => {
    assert.equal(stepDescription(base), "ZBP1 Base price: ZP03, ZP02, ZP01");
  });

  it("describes subtotals by their calculation base", () => {
    const subtotal = { ...base, kind: "SUBTOTAL" as const, accessSequence: null, fromStep: 10, toStep: 99, subtotalKey: "NET_VALUE" };
    assert.equal(stepDescription(subtotal), "Sum of steps 10–99");
    assert.equal(stepDescription({ ...subtotal, toStep: null }), "Value of step 10");
  });

  it("lists the flags in a fixed order", () => {
    assert.deepEqual(stepFlags(base), ["Mandatory", "Customer visible"]);
    assert.deepEqual(stepFlags({ ...base, mandatory: false, statistical: true, customerVisible: false }), ["Statistical"]);
  });

  it("labels sales area assignments", () => {
    assert.equal(assignmentLabel({ salesOrganization: "1000", distributionChannel: "10", division: "00", customerProcedure: "*" }), "1000/10/00");
    assert.equal(assignmentLabel({ salesOrganization: "1000", distributionChannel: "10", division: "00", customerProcedure: "A" }), "1000/10/00 (customer procedure A)");
  });
});
