import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignableSalesAreas,
  assignmentStatus,
  findSalesArea,
  parseSalesAreaId,
  salesAreaId,
  salesAreaLabel,
  salesAreaName,
} from "./sales-area-display.ts";
import type { SalesArea } from "./sales-areas.ts";

const area = (
  salesOrganization: string,
  name: string,
  currency: string,
  currencyDecimals: number,
  isActive = true,
): SalesArea => ({
  salesOrganization,
  distributionChannel: "10",
  division: "00",
  salesOrganizationName: name,
  distributionChannelName: "Direct Sales",
  divisionName: "Cross-Division",
  country: "DE",
  currency,
  currencyDecimals,
  isActive,
});

// As configured by the ERP migration
const GERMANY = area("1000", "B2B Lab Germany", "EUR", 2);
const POLAND = area("2000", "B2B Lab Poland", "PLN", 2);
const JAPAN = area("3000", "B2B Lab Japan", "JPY", 0);
const areas = [GERMANY, POLAND, JAPAN];

describe("sales area keys", () => {
  it("turns a sales area into a compact id and back", () => {
    assert.equal(salesAreaId(GERMANY), "1000/10/00");
    assert.deepEqual(parseSalesAreaId("1000/10/00"), {
      salesOrganization: "1000",
      distributionChannel: "10",
      division: "00",
    });
  });

  for (const invalid of ["", "1000", "1000/10", "1000/10/00/x", "100/10/00", "1000-10-00", "de01/10/00"]) {
    it(`rejects the id "${invalid}"`, () => {
      assert.equal(parseSalesAreaId(invalid), null);
    });
  }

  it("finds and labels a configured sales area", () => {
    assert.equal(findSalesArea(areas, { ...GERMANY, salesOrganization: "2000" }), POLAND);
    assert.equal(findSalesArea(areas, { ...GERMANY, distributionChannel: "20" }), undefined);
    assert.equal(findSalesArea(null, GERMANY), undefined);
    assert.equal(salesAreaLabel(JAPAN), "3000 / 10 / 00 – B2B Lab Japan (JPY)");
    assert.equal(salesAreaName(areas, POLAND), "B2B Lab Poland");
    assert.equal(salesAreaName(null, POLAND), "2000/10/00");
  });
});

describe("customer assignments", () => {
  const assignments = [
    { ...GERMANY, isActive: true },
    { ...POLAND, isActive: false },
  ];

  it("tells active, inactive and missing assignments apart", () => {
    assert.equal(assignmentStatus(assignments, GERMANY), "active");
    assert.equal(assignmentStatus(assignments, POLAND), "inactive");
    assert.equal(assignmentStatus(assignments, JAPAN), "missing");
  });

  it("offers only active sales areas the customer is not assigned to", () => {
    assert.deepEqual(assignableSalesAreas(areas, assignments), [JAPAN]);
    assert.deepEqual(assignableSalesAreas([GERMANY, { ...JAPAN, isActive: false }], []), [GERMANY]);
  });
});
