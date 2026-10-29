import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { COUNTRY_CODES } from "./country-codes.ts";

describe("country codes", () => {
  it("contains the 249 officially assigned ISO 3166-1 alpha-2 codes", () => {
    assert.equal(COUNTRY_CODES.length, 249);
    assert.equal(new Set(COUNTRY_CODES).size, 249);
    assert.ok(COUNTRY_CODES.every((code) => /^[A-Z]{2}$/.test(code)));
    assert.deepEqual([...COUNTRY_CODES].sort(), COUNTRY_CODES);
  });

  it("is identical to the list used by the ERP API", () => {
    // The ERP API validates the country, so both lists must stay in sync
    const erpApiFile = readFileSync(
      new URL("../../../erp-api/src/common/country-codes.ts", import.meta.url),
      "utf8",
    );
    const erpApiCodes = erpApiFile.match(/'[A-Z]{2}'/g)?.map((code) => code.slice(1, 3));

    assert.deepEqual(erpApiCodes, COUNTRY_CODES);
  });

  it("has a country name for every code", () => {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    const withoutName = COUNTRY_CODES.filter((code) => names.of(code) === code);

    assert.deepEqual(withoutName, []);
  });
});
