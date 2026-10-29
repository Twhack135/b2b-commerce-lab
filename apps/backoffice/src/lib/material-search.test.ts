import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientMaterialSearch,
  filterMaterials,
  materialLabel,
  type MaterialOption,
} from "./material-search.ts";

const m = (materialNumber: string, description: string): MaterialOption => ({
  materialNumber,
  description,
  currency: "EUR",
});

const materials = [
  m("MAT-002", "Thermostat"),
  m("MAT-001", "Heat Pump"),
  m("MAT-101", "Test Valve"),
  m("TH-500", "Wärmepumpe Kompakt"),
];

const numbers = (query: string) =>
  filterMaterials(materials, query).options.map((o) => o.materialNumber);

describe("filterMaterials", () => {
  it("lists all materials by number for an empty query", () => {
    assert.deepEqual(numbers(""), ["MAT-001", "MAT-002", "MAT-101", "TH-500"]);
    assert.deepEqual(numbers("   "), ["MAT-001", "MAT-002", "MAT-101", "TH-500"]);
  });

  it("searches number and description, ignoring case", () => {
    assert.deepEqual(numbers("thermo"), ["MAT-002"]);
    assert.deepEqual(numbers("HEAT"), ["MAT-001"]);
    assert.deepEqual(numbers("mat-10"), ["MAT-101"]);
    assert.deepEqual(numbers("wärme"), ["TH-500"]);
  });

  it("requires every word of the query", () => {
    assert.deepEqual(numbers("test valve"), ["MAT-101"]);
    assert.deepEqual(numbers("therm 002"), ["MAT-002"]);
    assert.deepEqual(numbers("therm 001"), []);
  });

  it("puts exact and prefix matches of the number first", () => {
    const list = [m("X-MAT-001", "Adapter for MAT-001"), m("MAT-0011", "Spare"), m("MAT-001", "Heat Pump")];
    assert.deepEqual(
      filterMaterials(list, "MAT-001").options.map((o) => o.materialNumber),
      ["MAT-001", "MAT-0011", "X-MAT-001"],
    );
  });

  it("returns nothing when no material matches", () => {
    assert.deepEqual(filterMaterials(materials, "pipe"), { options: [], total: 0 });
  });

  it("cuts long result lists and reports the total", () => {
    const many = Array.from({ length: 120 }, (_, i) => m(`M-${String(i).padStart(3, "0")}`, "Washer"));
    const result = filterMaterials(many, "washer");
    assert.equal(result.options.length, 50);
    assert.equal(result.total, 120);
  });

  it("is used through the MaterialSearch interface", async () => {
    const search = clientMaterialSearch(materials);
    // "pump" is also part of "Wärmepumpe"
    assert.deepEqual((await search("pump")).options.map((o) => o.materialNumber), ["MAT-001", "TH-500"]);
  });

  it("labels a material with number and description", () => {
    assert.equal(materialLabel(materials[1]), "MAT-001 – Heat Pump");
  });
});
