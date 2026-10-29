import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { B2bUnit } from "./b2b-units.ts";
import {
  addItem,
  addItemAfter,
  canStepQuantity,
  isValidQuantity,
  nextItemKey,
  quantityEnter,
  stepQuantity,
  emptySimulationForm,
  hasErrors,
  inactiveDefaultShipTo,
  inputKey,
  itemNumberAt,
  MAX_ITEMS,
  removeItem,
  selectUnit,
  shipToOptions,
  toSimulationRequest,
  unitPartners,
  updateItem,
  validateSimulationForm,
  type OrderSimulationValues,
} from "./order-simulation-form.ts";

const p = (customerNumber: string, isActive = true) => ({
  customerNumber,
  name: `Customer ${customerNumber}`,
  isActive,
});

/** UNIT-STUTTGART as in the development data */
const stuttgart = (shipTos = [
  { ...p("CUST-1000"), isDefault: false },
  { ...p("CUST-1100"), isDefault: true },
  { ...p("CUST-1200"), isDefault: false },
], isActive = true): B2bUnit => ({
  unitId: "UNIT-STUTTGART",
  name: "Müller – Stuttgart",
  isActive,
  account: p("CUST-1000"),
  soldTo: p("CUST-1000"),
  billTo: p("CUST-1000"),
  payer: p("CUST-1000"),
  shipTos,
  defaultShipToCustomerNumber: "CUST-1100",
});

const units = [stuttgart()];

/** Order date = pricing date, as passed in by the page (today) */
const ORDER_DATE = "2026-10-29";

/** The Müller example order */
const mueller = (): OrderSimulationValues => ({
  unitId: "UNIT-STUTTGART",
  shipToCustomerNumber: "CUST-1100",
  requestedDeliveryDate: "",
  requestedShippingMethod: "STANDARD",
  customerReference: "PO-STR-2026-118",
  customerNote: "",
  items: [
    { key: 1, materialNumber: "MAT-001", quantity: "2" },
    { key: 2, materialNumber: "MAT-002", quantity: "10" },
  ],
});

describe("positions", () => {
  it("are numbered 10, 20, 30 by their order", () => {
    assert.deepEqual([0, 1, 2, 199].map(itemNumberAt), [10, 20, 30, 2000]);
  });

  it("start with one empty position", () => {
    assert.deepEqual(emptySimulationForm().items, [
      { key: 1, materialNumber: "", quantity: "1" },
    ]);
  });

  it("are added at the end with a new key, up to 200", () => {
    let values = mueller();
    values = addItem(values);
    assert.deepEqual(values.items.map((i) => i.key), [1, 2, 3]);
    for (let i = 0; i < 300; i++) values = addItem(values);
    assert.equal(values.items.length, MAX_ITEMS);
  });

  it("keep their order when one is removed, so the numbers move up", () => {
    let values = addItem(mueller());
    values = updateItem(values, 3, { materialNumber: "MAT-002", quantity: "5" });
    values = removeItem(values, 1);
    assert.deepEqual(
      values.items.map((i, index) => [itemNumberAt(index), i.materialNumber, i.quantity]),
      [
        [10, "MAT-002", "10"],
        [20, "MAT-002", "5"],
      ],
    );
  });

  it("empty the last position instead of removing it", () => {
    const values = removeItem({ ...mueller(), items: [mueller().items[0]] }, 1);
    assert.equal(values.items.length, 1);
    assert.equal(values.items[0].materialNumber, "");
  });

  it("keep the same material in several positions", () => {
    let values = addItem(mueller());
    values = updateItem(values, 3, { materialNumber: "MAT-002", quantity: "5" });
    assert.deepEqual(
      toSimulationRequest(values, ORDER_DATE).items,
      [
        { materialNumber: "MAT-001", quantity: 2 },
        { materialNumber: "MAT-002", quantity: 10 },
        { materialNumber: "MAT-002", quantity: 5 },
      ],
    );
  });

  it("only change the edited position", () => {
    const values = updateItem(mueller(), 2, { quantity: "12" });
    assert.deepEqual(values.items[0], mueller().items[0]);
    assert.equal(values.items[1].materialNumber, "MAT-002");
  });
});

describe("unit and Ship-to", () => {
  it("selects the default Ship-to of the unit", () => {
    const values = selectUnit(emptySimulationForm(), stuttgart());
    assert.equal(values.unitId, "UNIT-STUTTGART");
    assert.equal(values.shipToCustomerNumber, "CUST-1100");
  });

  it("does not select another Ship-to if the default is inactive", () => {
    const unit = stuttgart([
      { ...p("CUST-1000"), isDefault: false },
      { ...p("CUST-1100", false), isDefault: true },
    ]);
    assert.equal(selectUnit(mueller(), unit).shipToCustomerNumber, "");
    assert.equal(inactiveDefaultShipTo(unit)?.customerNumber, "CUST-1100");
    assert.equal(inactiveDefaultShipTo(stuttgart()), undefined);
  });

  it("offers inactive Ship-tos only as not selectable", () => {
    const unit = stuttgart([{ ...p("CUST-1200", false), isDefault: false }]);
    assert.deepEqual(
      shipToOptions(unit).map((s) => [s.customerNumber, s.isSelectable]),
      [["CUST-1200", false]],
    );
  });

  it("shows the partners of the unit", () => {
    assert.deepEqual(unitPartners(stuttgart()), {
      soldTo: p("CUST-1000"),
      billTo: p("CUST-1000"),
      payer: p("CUST-1000"),
    });
    assert.equal(unitPartners(undefined), null);
  });
});

describe("validateSimulationForm", () => {
  const errorsOf = (changes: Partial<OrderSimulationValues>, list = units) =>
    validateSimulationForm({ ...mueller(), ...changes }, list, ORDER_DATE);

  it("accepts the Müller order", () => {
    assert.equal(hasErrors(errorsOf({})), false);
  });

  it("requires unit and Ship-to", () => {
    assert.deepEqual(
      errorsOf({ unitId: "", shipToCustomerNumber: "" }).header,
      {
        unitId: "Select a B2B unit.",
        shipToCustomerNumber: "Select a Ship-to.",
      },
    );
  });

  it("rejects an inactive unit and a Ship-to that is not allowed or inactive", () => {
    assert.match(errorsOf({}, [stuttgart(undefined, false)]).header.unitId ?? "", /inactive/);
    assert.match(errorsOf({ shipToCustomerNumber: "CUST-2000" }).header.shipToCustomerNumber ?? "", /not an allowed Ship-to/);
    const inactive = [stuttgart([{ ...p("CUST-1100", false), isDefault: true }])];
    assert.equal(errorsOf({}, inactive).header.shipToCustomerNumber, "Ship-to CUST-1100 is inactive.");
  });

  it("accepts no requested delivery date, the order date or a later date", () => {
    for (const requestedDeliveryDate of ["", ORDER_DATE, "2026-11-20", "2027-12-31"]) {
      assert.equal(errorsOf({ requestedDeliveryDate }).header.requestedDeliveryDate, undefined);
    }
  });

  it("rejects a requested delivery date before the order date or an impossible date", () => {
    assert.equal(
      errorsOf({ requestedDeliveryDate: "2026-10-28" }).header.requestedDeliveryDate,
      "The requested delivery date must not be before the order date.",
    );
    assert.equal(
      errorsOf({ requestedDeliveryDate: "2026-02-30" }).header.requestedDeliveryDate,
      "Enter a valid date or leave it empty.",
    );
  });

  it("limits the customer reference to 35 and the note to 1000 characters", () => {
    assert.equal(hasErrors(errorsOf({ customerReference: "P".repeat(35), customerNote: "N".repeat(1000) })), false);
    const errors = errorsOf({ customerReference: "P".repeat(36), customerNote: "N".repeat(1001) });
    assert.equal(errors.header.customerReference, "Use at most 35 characters.");
    assert.equal(errors.header.customerNote, "Use at most 1,000 characters.");
  });

  it("checks every position", () => {
    const errors = errorsOf({
      items: [
        { key: 1, materialNumber: "", quantity: "1" },
        { key: 2, materialNumber: "MAT-002", quantity: "0" },
        { key: 3, materialNumber: "MAT-002", quantity: "1.5" },
        { key: 4, materialNumber: "MAT-002", quantity: "100000" },
        { key: 5, materialNumber: "MAT-002", quantity: " " },
        { key: 6, materialNumber: "MAT-002", quantity: "99999" },
      ],
    });
    assert.deepEqual(errors.items, {
      1: { materialNumber: "Select a material." },
      2: { quantity: "1 to 99,999." },
      3: { quantity: "Enter a whole number." },
      4: { quantity: "1 to 99,999." },
      5: { quantity: "Enter a quantity." },
    });
  });

  it("requires at least one and at most 200 positions", () => {
    assert.equal(errorsOf({ items: [] }).itemList, "Add at least one item.");
    const many = Array.from({ length: 201 }, (_, i) => ({ key: i, materialNumber: "M", quantity: "1" }));
    assert.equal(errorsOf({ items: many }).itemList, "An order can have at most 200 items.");
  });
});

describe("toSimulationRequest", () => {
  it("sends the requested delivery date, but never as pricing date", () => {
    const request = toSimulationRequest({ ...mueller(), requestedDeliveryDate: "2026-12-15" }, ORDER_DATE);
    assert.equal(request.requestedDeliveryDate, "2026-12-15");
    assert.equal(request.pricingDate, ORDER_DATE);
  });

  it("uses the order date as pricing date; the form has no date of its own", () => {
    assert.equal("pricingDate" in mueller(), false);
    assert.equal("pricingDate" in emptySimulationForm(), false);
    assert.equal(toSimulationRequest(mueller(), "2026-12-24").pricingDate, "2026-12-24");
  });

  it("sends exactly the fields of the ERP API with the explicit Ship-to", () => {
    assert.deepEqual(toSimulationRequest(mueller(), ORDER_DATE), {
      unitId: "UNIT-STUTTGART",
      shipToCustomerNumber: "CUST-1100",
      pricingDate: "2026-10-29",
      requestedDeliveryDate: null,
      requestedShippingMethod: "STANDARD",
      customerReference: "PO-STR-2026-118",
      customerNote: null,
      items: [
        { materialNumber: "MAT-001", quantity: 2 },
        { materialNumber: "MAT-002", quantity: 10 },
      ],
    });
  });

  it("never sends Sold-to, Bill-to or Payer", () => {
    const keys = Object.keys(toSimulationRequest(mueller(), ORDER_DATE));
    for (const field of ["soldToCustomerNumber", "billToCustomerNumber", "payerCustomerNumber"]) {
      assert.equal(keys.includes(field), false);
    }
  });

  it("sends empty optional texts as null and a whitespace note unchanged", () => {
    const request = toSimulationRequest({ ...mueller(), customerReference: "", customerNote: "   " }, ORDER_DATE);
    assert.equal(request.customerReference, null);
    // The ERP API decides that whitespace is no note
    assert.equal(request.customerNote, "   ");
  });
});

describe("inputKey (outdated results)", () => {
  const changes: [string, (v: OrderSimulationValues) => OrderSimulationValues][] = [
    ["the unit", (v) => ({ ...v, unitId: "UNIT-MUENCHEN" })],
    ["the Ship-to", (v) => ({ ...v, shipToCustomerNumber: "CUST-1200" })],
    ["the shipping method", (v) => ({ ...v, requestedShippingMethod: "EXPRESS" })],
    ["the customer reference", (v) => ({ ...v, customerReference: "PO-2" })],
    ["the customer note", (v) => ({ ...v, customerNote: "x" })],
    ["the requested delivery date", (v) => ({ ...v, requestedDeliveryDate: "2026-12-01" })],
    ["a material", (v) => updateItem(v, 1, { materialNumber: "MAT-101" })],
    ["a quantity", (v) => updateItem(v, 2, { quantity: "11" })],
    ["the number of items", (v) => addItem(v)],
    ["the item order", (v) => ({ ...v, items: [...v.items].reverse() })],
  ];

  for (const [name, edit] of changes) {
    it(`changes when ${name} changes`, () => {
      assert.notEqual(inputKey(edit(mueller()), ORDER_DATE), inputKey(mueller(), ORDER_DATE));
    });
  }

  it("changes when the order date changes, e.g. at midnight", () => {
    assert.notEqual(inputKey(mueller(), "2026-10-30"), inputKey(mueller(), ORDER_DATE));
  });

  it("stays the same for the same input", () => {
    assert.equal(inputKey(mueller(), ORDER_DATE), inputKey(mueller(), ORDER_DATE));
    assert.equal(inputKey(updateItem(mueller(), 2, { quantity: " 10 " }), ORDER_DATE), inputKey(mueller(), ORDER_DATE));
  });
});

describe("quantity stepper", () => {
  it("steps by exactly 1 within 1 to 99,999", () => {
    assert.equal(stepQuantity("10", 1), "11");
    assert.equal(stepQuantity("10", -1), "9");
    assert.equal(stepQuantity("2", -1), "1");
    assert.equal(stepQuantity("99998", 1), "99999");
  });

  it("never steps below 1 or above 99,999", () => {
    assert.equal(stepQuantity("1", -1), "1");
    assert.equal(stepQuantity("99999", 1), "99999");
    assert.equal(stepQuantity("0", -1), "1");
    assert.equal(stepQuantity("0", 1), "1");
    assert.equal(stepQuantity("150000", 1), "99999");
    assert.equal(stepQuantity("150000", -1), "99999");
  });

  it("turns empty or invalid input into 1, never NaN", () => {
    for (const text of ["", "   ", "abc", "1.5", "-3", "2 pcs"]) {
      assert.equal(stepQuantity(text, 1), "1", `+ on "${text}"`);
      assert.equal(stepQuantity(text, -1), "1", `- on "${text}"`);
    }
  });

  it("ignores surrounding spaces of a typed quantity", () => {
    assert.equal(stepQuantity(" 7 ", 1), "8");
  });

  it("disables minus at 1 and plus at 99,999", () => {
    assert.equal(canStepQuantity("1", -1), false);
    assert.equal(canStepQuantity("1", 1), true);
    assert.equal(canStepQuantity("99999", 1), false);
    assert.equal(canStepQuantity("99999", -1), true);
    assert.equal(canStepQuantity("0", -1), false);
    assert.equal(canStepQuantity("150000", 1), false);
  });

  it("keeps both buttons usable for empty or invalid input", () => {
    for (const text of ["", "x", "1.5"]) {
      assert.equal(canStepQuantity(text, 1), true);
      assert.equal(canStepQuantity(text, -1), true);
    }
  });

  it("validates quantities", () => {
    assert.deepEqual(
      ["1", "99999", " 5 ", "0", "100000", "", "1.5"].map(isValidQuantity),
      [true, true, true, false, false, false, false],
    );
  });
});

describe("Enter in a quantity input", () => {
  const three = (): OrderSimulationValues => ({
    ...mueller(),
    items: [
      { key: 1, materialNumber: "MAT-001", quantity: "2" },
      { key: 2, materialNumber: "MAT-002", quantity: "10" },
      { key: 5, materialNumber: "MAT-002", quantity: "5" },
    ],
  });

  it("moves to the next existing item from an earlier item", () => {
    assert.deepEqual(quantityEnter(three(), 1), { kind: "focus-next", key: 2 });
    assert.deepEqual(quantityEnter(three(), 2), { kind: "focus-next", key: 5 });
  });

  it("moves on from an earlier item even if that item is incomplete", () => {
    const values = updateItem(three(), 1, { materialNumber: "", quantity: "" });
    assert.deepEqual(quantityEnter(values, 1), { kind: "focus-next", key: 2 });
  });

  it("adds a new item after a complete last item", () => {
    assert.deepEqual(quantityEnter(three(), 5), { kind: "add", key: 6 });
    assert.equal(nextItemKey(three()), 6);
  });

  it("does not add an item without material or with an invalid quantity", () => {
    const noMaterial = updateItem(three(), 5, { materialNumber: "" });
    const result = quantityEnter(noMaterial, 5);
    assert.equal(result.kind, "blocked");
    assert.match(result.kind === "blocked" ? result.reason : "", /Select a material/);
    for (const quantity of ["", "0", "1.5", "100000"]) {
      const invalid = quantityEnter(updateItem(three(), 5, { quantity }), 5);
      assert.equal(invalid.kind, "blocked", quantity);
    }
  });

  it("does not add an item beyond 200 and says so", () => {
    let values = mueller();
    while (values.items.length < MAX_ITEMS) values = addItem(values);
    const last = values.items.at(-1)!;
    values = updateItem(values, last.key, { materialNumber: "MAT-001" });
    const result = quantityEnter(values, last.key);
    assert.deepEqual(result, {
      kind: "blocked",
      reason: "The maximum of 200 items is reached. No item was added.",
    });
  });

  it("adds only one row for repeated Enter on the same item", () => {
    let values = three();
    values = addItemAfter(values, 5);
    values = addItemAfter(values, 5);
    values = addItemAfter(values, 5);
    assert.deepEqual(values.items.map((i) => i.key), [1, 2, 5, 6]);
    assert.deepEqual(values.items.map((_, i) => itemNumberAt(i)), [10, 20, 30, 40]);
  });

  it("keeps the same material in separate items", () => {
    const values = addItemAfter(three(), 5);
    assert.deepEqual(values.items.map((i) => i.materialNumber), ["MAT-001", "MAT-002", "MAT-002", ""]);
  });
});
