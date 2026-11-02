import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PAGE_SIZE,
  deliveryBlockLabel,
  FIRST_PAGE,
  hasFilters,
  LatestRequest,
  listQuery,
  listView,
  NO_FILTERS,
  nextPage,
  type OverviewState,
  overviewQuery,
  pageNumber,
  parseOverviewUrl,
  previousPage,
  rangeLabel,
  salesAreaFilterChange,
  salesAreaFilterValue,
  STATUS_LABELS,
  summaryNetValue,
  summarySalesArea,
  withFilters,
} from "./sales-order-overview.ts";
import type { SalesOrderList, SalesOrderSummary } from "./sales-orders.ts";

const parse = (query: string) => parseOverviewUrl(new URLSearchParams(query));

const order = (change: Partial<SalesOrderSummary> = {}): SalesOrderSummary => ({
  salesOrderNumber: "1000000001",
  orderDate: "2026-11-15",
  createdAt: "2026-11-15T10:00:00.000Z",
  status: "OPEN",
  deliveryBlock: null,
  salesArea: { salesOrganization: "1000", distributionChannel: "10", division: "00" },
  soldTo: { customerNumber: "CUST-1000", name: "Müller Heiztechnik GmbH" },
  unit: { unitId: "UNIT-STUTTGART", name: "Müller – Stuttgart" },
  customerReference: "PO-STR-2026-118",
  itemCount: 2,
  netValue: "10695.00",
  currency: "EUR",
  currencyDecimals: 2,
  ...change,
});

const list = (items: SalesOrderSummary[], change: Partial<SalesOrderList> = {}): SalesOrderList => ({
  items,
  total: items.length,
  limit: DEFAULT_PAGE_SIZE,
  hasMore: false,
  nextCursor: null,
  ...change,
});

const ALL = {
  q: "müller",
  salesOrganization: "1000",
  distributionChannel: "10",
  division: "00",
  soldTo: "CUST-1000",
  unitId: "UNIT-STUTTGART",
  deliveryBlock: "SALES_REVIEW",
  orderDateFrom: "2026-11-01",
  orderDateTo: "2026-11-30",
} as const;

describe("overview URL", () => {
  it("is empty for page 1 without filters", () => {
    assert.deepEqual(parse(""), { state: FIRST_PAGE, ignored: [] });
    assert.equal(overviewQuery(FIRST_PAGE), "");
    assert.equal(listQuery(FIRST_PAGE), "");
  });

  it("restores every filter, the page size and the page", () => {
    const query =
      "q=m%C3%BCller&salesOrganization=1000&distributionChannel=10&division=00&soldTo=CUST-1000&unitId=UNIT-STUTTGART&deliveryBlock=SALES_REVIEW&orderDateFrom=2026-11-01&orderDateTo=2026-11-30&limit=50&after=1000000051&prev=1000000101";
    const { state, ignored } = parse(query);
    assert.deepEqual(ignored, []);
    assert.deepEqual(state, {
      filters: ALL,
      limit: 50,
      after: "1000000051",
      prev: ["1000000101"],
    });
    // The same URL again, so the page can be reloaded and shared
    assert.equal(overviewQuery(state), query);
  });

  it("sends filters, page size and cursor to the ERP API, but not the page history", () => {
    const { state } = parse("unitId=U1&limit=50&after=1000000051&prev=1000000101");
    assert.equal(listQuery(state), "unitId=U1&limit=50&after=1000000051");
  });

  it("encodes search text safely", () => {
    const state = withFilters(FIRST_PAGE, { q: "50% & more=x?" });
    assert.equal(listQuery(state), "q=50%25+%26+more%3Dx%3F");
    assert.equal(parse(overviewQuery(state)).state.filters.q, "50% & more=x?");
  });

  it("trims the search text", () => {
    assert.equal(parse("q=%20%20PO-1%20").state.filters.q, "PO-1");
  });

  describe("unusable values are ignored and never sent", () => {
    const cases: [string, string, Partial<OverviewState>][] = [
      ["unknown parameters", "page=2&sort=asc&requestId=x", {}],
      ["a repeated parameter", "q=a&q=b", {}],
      ["blank search", "q=%20%20", {}],
      ["search of 101 characters", `q=${"x".repeat(101)}`, {}],
      ["lower-case sales organization", "salesOrganization=abcd", {}],
      ["channel without sales organization", "distributionChannel=10", {}],
      ["division without channel", "salesOrganization=1000&division=00", {}],
      ["unknown delivery block", "deliveryBlock=CREDIT", {}],
      ["invalid date", "orderDateFrom=2026-02-30", {}],
      ["soldTo with spaces", "soldTo=%20CUST-1", {}],
      ["unitId of 21 characters", `unitId=${"U".repeat(21)}`, {}],
      ["limit 0", "limit=0", {}],
      ["limit 101", "limit=101", {}],
      ["limit 1e1", "limit=1e1", {}],
      ["malformed cursor", "after=abc", {}],
      ["history without page", "prev=1000000050", {}],
      ["history that does not descend", "after=1000000060&prev=1000000050", {}],
      ["malformed history", "after=1000000020&prev=x,1000000050", {}],
    ];
    for (const [name, query] of cases) {
      it(name, () => {
        const { state, ignored } = parse(query);
        assert.ok(ignored.length > 0, "expected an ignored parameter");
        // Only page 1 without the value is requested (sales organization of
        // the division case stays: it is valid on its own)
        const sent = listQuery(state);
        assert.ok(!/page|sort|requestId|after|prev/.test(sent), sent);
        assert.ok(sent === "" || sent === "salesOrganization=1000", sent);
      });
    }

    it("names what was ignored", () => {
      assert.deepEqual(parse("page=2&limit=0&q=a&q=b").ignored, [
        "page (unknown parameter)",
        "q (given more than once)",
        "limit (must be a whole number from 1 to 100)",
      ]);
    });

    it("keeps the valid filters next to invalid ones", () => {
      const { state } = parse("unitId=U1&orderDateFrom=2026-11-30&orderDateTo=2026-11-01");
      assert.equal(state.filters.unitId, "U1");
      assert.equal(state.filters.orderDateFrom, "2026-11-30");
      assert.equal(state.filters.orderDateTo, "");
    });
  });
});

describe("pagination", () => {
  it("goes forward with the cursor and keeps a history for going back", () => {
    const page1 = withFilters(FIRST_PAGE, { unitId: "U1" });
    const page2 = nextPage(page1, "1000000076");
    const page3 = nextPage(page2, "1000000051");
    assert.deepEqual([page2.after, page2.prev], ["1000000076", []]);
    assert.deepEqual([page3.after, page3.prev], ["1000000051", ["1000000076"]]);
    assert.deepEqual(
      [page1, page2, page3].map(pageNumber),
      [1, 2, 3],
    );
    assert.deepEqual(previousPage(page3), page2);
    assert.deepEqual(previousPage(page2), page1);
    assert.deepEqual(previousPage(page1), page1);
    // The history survives the URL
    assert.deepEqual(parse(overviewQuery(page3)).state, page3);
  });

  it("starts again on page 1 when search, a filter or the page size changes", () => {
    const page3 = nextPage(nextPage(withFilters(FIRST_PAGE, { q: "PO" }), "1000000076"), "1000000051");
    for (const changed of [
      withFilters(page3, { q: "PO-1" }),
      withFilters(page3, { deliveryBlock: "NONE" }),
      withFilters(page3, {}, 100),
    ]) {
      assert.equal(changed.after, null);
      assert.deepEqual(changed.prev, []);
      assert.equal(pageNumber(changed), 1);
    }
  });

  it("describes the shown range", () => {
    const page2 = nextPage(FIRST_PAGE, "1000000036");
    const items = Array.from({ length: 25 }, () => order());
    assert.equal(rangeLabel(page2, list(items, { total: 61 })), "26–50 of 61");
    assert.equal(rangeLabel(FIRST_PAGE, list([order()])), "1–1 of 1");
  });
});

describe("sales area filter", () => {
  it("maps the select value to the three filter parameters and back", () => {
    for (const value of ["", "1000", "1000/10", "1000/10/00"]) {
      const filters = { ...NO_FILTERS, ...salesAreaFilterChange(value) };
      assert.equal(salesAreaFilterValue(filters), value);
    }
    assert.deepEqual(salesAreaFilterChange("2000/10"), {
      salesOrganization: "2000",
      distributionChannel: "10",
      division: "",
    });
  });
});

describe("list view", () => {
  const filtered = withFilters(FIRST_PAGE, { q: "nothing" });

  it("tells 'no orders exist' from 'no orders match'", () => {
    assert.deepEqual(listView(FIRST_PAGE, { kind: "loaded", list: list([]) }), { kind: "no-orders" });
    assert.deepEqual(listView(filtered, { kind: "loaded", list: list([]) }), { kind: "no-matches" });
  });

  it("reports an empty later page separately", () => {
    const page2 = nextPage(FIRST_PAGE, "1000000001");
    assert.deepEqual(listView(page2, { kind: "loaded", list: list([], { total: 5 }) }), {
      kind: "page-empty",
    });
  });

  it("shows loading, errors and rejected queries", () => {
    assert.deepEqual(listView(FIRST_PAGE, { kind: "loading" }), { kind: "loading" });
    assert.deepEqual(
      listView(FIRST_PAGE, { kind: "error", status: 502, message: "The ERP API is not reachable." }),
      { kind: "error", message: "The ERP API is not reachable.", invalidQuery: false },
    );
    assert.equal(
      (listView(FIRST_PAGE, { kind: "error", status: 400, message: "x" }) as { invalidQuery: boolean })
        .invalidQuery,
      true,
    );
  });

  it("lists loaded orders", () => {
    const loaded = list([order()]);
    assert.deepEqual(listView(filtered, { kind: "loaded", list: loaded }), { kind: "orders", list: loaded });
  });

  it("knows whether filters are set", () => {
    assert.equal(hasFilters(NO_FILTERS), false);
    assert.equal(hasFilters(filtered.filters), true);
  });
});

describe("display", () => {
  it("formats net values in the decimals of the currency", () => {
    assert.equal(summaryNetValue(order()), "10,695.00 EUR");
    assert.equal(summaryNetValue(order({ netValue: "198.00", currency: "PLN" })), "198.00 PLN");
    assert.equal(
      summaryNetValue(order({ netValue: "1400000", currency: "JPY", currencyDecimals: 0 })),
      "1,400,000 JPY",
    );
  });

  it("labels delivery block, status and sales area", () => {
    assert.equal(deliveryBlockLabel(order()), "None");
    assert.equal(deliveryBlockLabel(order({ deliveryBlock: "SALES_REVIEW" })), "Sales review");
    assert.equal(STATUS_LABELS.OPEN, "Open");
    assert.equal(summarySalesArea(order()), "1000/10/00");
  });
});

describe("LatestRequest", () => {
  it("only accepts the answer of the latest request", () => {
    const requests = new LatestRequest();
    const old = requests.start();
    const current = requests.start();
    // The old answer arrives last; it must not replace the current result
    assert.equal(requests.isLatest(current), true);
    assert.equal(requests.isLatest(old), false);
  });
});
