import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import * as handlers from "./route.ts";

// Calls the route handler like Next.js would for /api/erp/<path...>, as a
// page of the Backoffice on this computer would send it (Host, Origin)
function call(
  method: string,
  path: string[],
  body?: unknown,
  query = "",
  headers: Record<string, string> = {},
) {
  const handler = handlers[method as keyof typeof handlers];
  const request = new Request(
    `http://localhost:3001/api/erp/${path.join("/")}${query}`,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Host: "localhost:3001",
        ...(method === "GET" || method === "HEAD" ? {} : { Origin: "http://localhost:3001" }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
    },
  );
  return handler(request, { params: Promise.resolve({ path }) });
}

/** Replaces the global fetch, so no real ERP API is needed */
function mockUpstream(response: () => Response | Promise<Response>) {
  return mock.method(globalThis, "fetch", async () => response());
}

function upstreamJson(status: number, body: unknown) {
  return () => Response.json(body, { status });
}

function upstreamCall(fetchMock: ReturnType<typeof mockUpstream>) {
  assert.equal(fetchMock.mock.callCount(), 1, "expected one upstream call");
  const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
  return { url, init };
}

const material = {
  materialNumber: "MAT-001",
  description: "Heat Pump",
  price: 4500,
  currency: "EUR",
};

beforeEach(() => {
  process.env.ERP_API_URL = "http://erp.test:3000";
});

afterEach(() => {
  mock.restoreAll();
  delete process.env.ERP_API_URL;
});

describe("allowed routes are forwarded", () => {
  it("GET /materials", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, [material]));

    const response = await call("GET", ["materials"]);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [material]);
    const { url, init } = upstreamCall(fetchMock);
    assert.equal(url, "http://erp.test:3000/materials");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
  });

  it("GET /materials/:materialNumber", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, material));

    const response = await call("GET", ["materials", "MAT-001"]);

    assert.equal(response.status, 200);
    assert.equal(upstreamCall(fetchMock).url, "http://erp.test:3000/materials/MAT-001");
  });

  it("POST /materials with the request body", async () => {
    const fetchMock = mockUpstream(upstreamJson(201, material));

    const response = await call("POST", ["materials"], material);

    assert.equal(response.status, 201);
    const { url, init } = upstreamCall(fetchMock);
    assert.equal(url, "http://erp.test:3000/materials");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), material);
  });

  it("PATCH /materials/:materialNumber with the request body", async () => {
    const changes = { price: 4999.99 };
    const fetchMock = mockUpstream(upstreamJson(200, { ...material, ...changes }));

    const response = await call("PATCH", ["materials", "MAT-001"], changes);

    assert.equal(response.status, 200);
    const { url, init } = upstreamCall(fetchMock);
    assert.equal(url, "http://erp.test:3000/materials/MAT-001");
    assert.equal(init.method, "PATCH");
    assert.deepEqual(JSON.parse(String(init.body)), changes);
  });

  const customer = {
    customerNumber: "CUST-0001",
    name: "Nordwind Heizungsbau GmbH",
    street: "Hafenstraße 12",
    postalCode: "20457",
    city: "Hamburg",
    country: "DE",
    isActive: true,
  };

  for (const [method, path, body, status] of [
    ["GET", ["customers"], undefined, 200],
    ["GET", ["customers", "CUST-0001"], undefined, 200],
    ["POST", ["customers"], customer, 201],
    ["PATCH", ["customers", "CUST-0001"], { isActive: false }, 200],
  ] as const) {
    it(`${method} /${path.join("/")}`, async () => {
      const fetchMock = mockUpstream(upstreamJson(status, customer));

      const response = await call(method, [...path], body);

      assert.equal(response.status, status);
      const { url, init } = upstreamCall(fetchMock);
      assert.equal(url, `http://erp.test:3000/${path.join("/")}`);
      assert.equal(init.method, method);
      assert.deepEqual(
        init.body === undefined ? undefined : JSON.parse(String(init.body)),
        body,
      );
    });
  }

  // Sprint 9C-A endpoints
  for (const [method, path, body, status] of [
    ["GET", ["currencies"], undefined, 200],
    ["GET", ["sales-organizations"], undefined, 200],
    ["GET", ["distribution-channels"], undefined, 200],
    ["GET", ["divisions"], undefined, 200],
    ["GET", ["sales-areas"], undefined, 200],
    ["POST", ["customers", "CUST-0001", "sales-areas"], { salesOrganization: "2000", distributionChannel: "10", division: "00" }, 201],
    ["PATCH", ["customers", "CUST-0001", "sales-areas", "1000", "10", "00"], { isActive: false }, 200],
  ] as const) {
    it(`${method} /${path.join("/")}`, async () => {
      const fetchMock = mockUpstream(upstreamJson(status, {}));

      const response = await call(method, [...path], body);

      assert.equal(response.status, status);
      const { url, init } = upstreamCall(fetchMock);
      assert.equal(url, `http://erp.test:3000/${path.join("/")}`);
      assert.equal(init.method, method);
      assert.deepEqual(
        init.body === undefined ? undefined : JSON.parse(String(init.body)),
        body,
      );
    });
  }

  // Sprint 6A endpoints
  const unitBody = {
    unitId: "NW-HAMBURG",
    name: "Nordwind Hamburg",
    salesOrganization: "1000",
    distributionChannel: "10",
    division: "00",
    accountCustomerNumber: "CUST-0001",
    soldToCustomerNumber: "CUST-0001",
    billToCustomerNumber: "CUST-0005",
    payerCustomerNumber: "CUST-0005",
    shipToCustomerNumbers: ["CUST-0001", "CUST-0004"],
    defaultShipToCustomerNumber: "CUST-0001",
  };

  for (const [method, path, body, status] of [
    ["GET", ["customer-accounts"], undefined, 200],
    ["GET", ["customer-accounts", "CUST-0001"], undefined, 200],
    ["PUT", ["customer-accounts", "CUST-0001", "members"], { memberCustomerNumbers: ["CUST-0004"] }, 200],
    ["GET", ["b2b-units"], undefined, 200],
    ["GET", ["b2b-units", "NW-HAMBURG"], undefined, 200],
    ["POST", ["b2b-units"], unitBody, 201],
    ["PATCH", ["b2b-units", "NW-HAMBURG"], { shipToCustomerNumbers: ["CUST-0004"], defaultShipToCustomerNumber: "CUST-0004" }, 200],
  ] as const) {
    it(`${method} /${path.join("/")}`, async () => {
      const fetchMock = mockUpstream(upstreamJson(status, {}));

      const response = await call(method, [...path], body);

      assert.equal(response.status, status);
      const { url, init } = upstreamCall(fetchMock);
      assert.equal(url, `http://erp.test:3000/${path.join("/")}`);
      assert.equal(init.method, method);
      assert.deepEqual(
        init.body === undefined ? undefined : JSON.parse(String(init.body)),
        body,
      );
    });
  }

  // Sprint 7A endpoints
  const conditionBody = {
    materialNumber: "MAT-002",
    scope: "B2B_UNIT",
    unitId: "UNIT-STUTTGART",
    amount: "189.00",
    currency: "EUR",
    validFrom: "2026-11-01",
    validTo: null,
  };

  for (const [method, path, body, status] of [
    ["GET", ["condition-types"], undefined, 200],
    ["GET", ["price-conditions"], undefined, 200],
    ["GET", ["price-conditions", "7"], undefined, 200],
    ["POST", ["price-conditions"], conditionBody, 201],
    ["PATCH", ["price-conditions", "7"], { amount: "185.50", isActive: false }, 200],
    ["POST", ["pricing", "price"], { materialNumber: "MAT-002", unitId: "UNIT-STUTTGART", pricingDate: "2026-11-15", quantity: 3 }, 200],
  ] as const) {
    it(`${method} /${path.join("/")}`, async () => {
      const fetchMock = mockUpstream(upstreamJson(status, {}));

      const response = await call(method, [...path], body);

      assert.equal(response.status, status);
      const { url, init } = upstreamCall(fetchMock);
      assert.equal(url, `http://erp.test:3000/${path.join("/")}`);
      assert.equal(init.method, method);
      assert.deepEqual(
        init.body === undefined ? undefined : JSON.parse(String(init.body)),
        body,
      );
    });
  }

  it("passes amounts through as exact strings", async () => {
    const fetchMock = mockUpstream(
      upstreamJson(200, { unitPrice: "0.10", netValue: "9999.90" }),
    );

    const response = await call("POST", ["pricing", "price"], { amount: "0.10" });

    assert.deepEqual(await response.json(), { unitPrice: "0.10", netValue: "9999.90" });
    assert.equal(String(upstreamCall(fetchMock).init.body), '{"amount":"0.10"}');
  });

  // Sprint 8A endpoint: read-only order simulation
  it("POST /sales-orders/simulate with the request body", async () => {
    const simulation = {
      unitId: "UNIT-STUTTGART",
      shipToCustomerNumber: "CUST-1100",
      pricingDate: "2026-11-15",
      requestedShippingMethod: "STANDARD",
      customerReference: "PO-STR-2026-118",
      customerNote: null,
      items: [
        { materialNumber: "MAT-001", quantity: 2 },
        { materialNumber: "MAT-002", quantity: 10 },
      ],
    };
    const fetchMock = mockUpstream(
      upstreamJson(200, { status: "INVALID", totals: null }),
    );

    const response = await call("POST", ["sales-orders", "simulate"], simulation);

    // A business-invalid simulation is a normal 200 answer
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "INVALID", totals: null });
    const { url, init } = upstreamCall(fetchMock);
    assert.equal(url, "http://erp.test:3000/sales-orders/simulate");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), simulation);
  });

  // Sprint 10C endpoints: creating and reading sales orders
  it("POST /sales-orders with the exact request body and answer", async () => {
    const request = {
      requestId: "8f0c6a1e-3b7d-4e7a-9c55-1f2a3b4c5d6e",
      salesOrganization: "1000",
      distributionChannel: "10",
      division: "00",
      unitId: "UNIT-STUTTGART",
      items: [{ materialNumber: "MAT-001", quantity: 2, expectedUnitPrice: "4400.00" }],
      expectedTotal: { netValue: "8800.00", currency: "EUR" },
    };
    const order = { salesOrderNumber: "1000000001", totals: { netValue: "8800.00" } };
    const fetchMock = mockUpstream(upstreamJson(201, order));

    const response = await call("POST", ["sales-orders"], request);

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), order);
    const { url, init } = upstreamCall(fetchMock);
    assert.equal(url, "http://erp.test:3000/sales-orders");
    assert.equal(init.method, "POST");
    // The body is passed on as sent, prices stay exact strings
    assert.equal(String(init.body), JSON.stringify(request));
  });

  it("passes 200 (repeated request) and the 409/422 business answers through", async () => {
    for (const [status, body] of [
      [200, { salesOrderNumber: "1000000001" }],
      [409, { code: "PRICE_CHANGED", changedItems: [{ itemNumber: 10 }] }],
      [409, { code: "IDEMPOTENCY_KEY_REUSED", salesOrderNumber: "1000000001" }],
      [409, { code: "CONCURRENT_UPDATE" }],
      [422, { code: "ORDER_INVALID", evaluation: { status: "INVALID" } }],
    ] as const) {
      mock.restoreAll();
      mockUpstream(upstreamJson(status, body));
      const response = await call("POST", ["sales-orders"], {});
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    }
  });

  it("GET /sales-orders/:salesOrderNumber for a 10-digit number", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, { salesOrderNumber: "1000000001" }));

    const response = await call("GET", ["sales-orders", "1000000001"]);

    assert.equal(response.status, 200);
    const { url, init } = upstreamCall(fetchMock);
    assert.equal(url, "http://erp.test:3000/sales-orders/1000000001");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
  });

  it("GET /sales-orders/:salesOrderNumber does not forward query strings", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, {}));

    await call("GET", ["sales-orders", "1000000001"], undefined, "?limit=5&x=1");

    assert.equal(upstreamCall(fetchMock).url, "http://erp.test:3000/sales-orders/1000000001");
  });

  it("encodes the account number inside the members path", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, {}));

    await call("PUT", ["customer-accounts", "A/B", "members"], { memberCustomerNumbers: [] });

    assert.equal(
      upstreamCall(fetchMock).url,
      "http://erp.test:3000/customer-accounts/A%2FB/members",
    );
  });
});

describe("GET /sales-orders (order list, Sprint 10D-B)", () => {
  const list = { items: [], total: 0, limit: 25, hasMore: false, nextCursor: null };

  it("forwards without query", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, list));

    const response = await call("GET", ["sales-orders"]);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), list);
    const { url, init } = upstreamCall(fetchMock);
    assert.equal(url, "http://erp.test:3000/sales-orders");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
  });

  it("forwards every documented parameter, encoded", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, list));
    const query =
      "?q=M%C3%BCller+%26+S%C3%B6hne&salesOrganization=1000&distributionChannel=10&division=00&soldTo=CUST-1000&unitId=UNIT-STUTTGART&deliveryBlock=SALES_REVIEW&orderDateFrom=2026-11-01&orderDateTo=2026-11-30&limit=100&after=1000000026";

    const response = await call("GET", ["sales-orders"], undefined, query);

    assert.equal(response.status, 200);
    assert.equal(upstreamCall(fetchMock).url, `http://erp.test:3000/sales-orders${query}`);
  });

  it("passes the 400 of the ERP API through, e.g. a date that does not exist", async () => {
    const body = { statusCode: 400, message: ["orderDateFrom must be a valid date"], error: "Bad Request" };
    mockUpstream(upstreamJson(400, body));

    const response = await call("GET", ["sales-orders"], undefined, "?orderDateFrom=2026-02-30");

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), body);
  });

  for (const [name, query, message] of [
    ["an unknown parameter", "?page=2", "Query parameter page is not supported."],
    ["a before cursor", "?before=1000000001", "Query parameter before is not supported."],
    ["an upstream URL", "?target=http://evil.test", "Query parameter target is not supported."],
    ["an inherited property name", "?__proto__=x", "Query parameter __proto__ is not supported."],
    ["a constructor property name", "?constructor=x", "Query parameter constructor is not supported."],
    ["a repeated parameter", "?limit=10&limit=20", "Query parameter limit must be given only once."],
    ["a repeated search", "?q=a&q=b", "Query parameter q must be given only once."],
    ["limit 0", "?limit=0", "Query parameter limit has an invalid value."],
    ["limit 101", "?limit=101", "Query parameter limit has an invalid value."],
    ["a malformed cursor", "?after=1000000001%26x%3D1", "Query parameter after has an invalid value."],
    ["an empty search", "?q=", "Query parameter q has an invalid value."],
    ["a search of 101 characters", `?q=${"x".repeat(101)}`, "Query parameter q has an invalid value."],
    ["a lower-case sales organization", "?salesOrganization=abcd", "Query parameter salesOrganization has an invalid value."],
    ["an unknown delivery block", "?deliveryBlock=CREDIT", "Query parameter deliveryBlock has an invalid value."],
    ["a date in another form", "?orderDateTo=30.11.2026", "Query parameter orderDateTo has an invalid value."],
    ["a soldTo with spaces", "?soldTo=%20CUST", "Query parameter soldTo has an invalid value."],
    ["a unitId of 21 characters", `?unitId=${"U".repeat(21)}`, "Query parameter unitId has an invalid value."],
  ] as const) {
    it(`rejects ${name} with 400 without calling the ERP API`, async () => {
      const fetchMock = mockUpstream(upstreamJson(200, list));

      const response = await call("GET", ["sales-orders"], undefined, query);

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { statusCode: 400, message });
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }

  it("still creates orders with POST and ignores a query string there", async () => {
    const fetchMock = mockUpstream(upstreamJson(201, {}));

    const response = await call("POST", ["sales-orders"], {}, "?limit=5");

    assert.equal(response.status, 201);
    assert.equal(upstreamCall(fetchMock).url, "http://erp.test:3000/sales-orders");
  });
});

describe("upstream URL is server-configured", () => {
  it("encodes the material number as a single path segment", async () => {
    const fetchMock = mockUpstream(upstreamJson(404, { message: "not found" }));

    await call("GET", ["materials", "../admin?x=1#y"]);

    assert.equal(
      upstreamCall(fetchMock).url,
      "http://erp.test:3000/materials/..%2Fadmin%3Fx%3D1%23y",
    );
  });

  it("does not forward query strings", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, []));

    await call("GET", ["materials"], undefined, "?target=http://evil.test");

    assert.equal(upstreamCall(fetchMock).url, "http://erp.test:3000/materials");
  });

  it("uses the default URL when ERP_API_URL is not set", async () => {
    delete process.env.ERP_API_URL;
    const fetchMock = mockUpstream(upstreamJson(200, []));

    await call("GET", ["materials"]);

    assert.equal(upstreamCall(fetchMock).url, "http://localhost:3000/materials");
  });

  it("ignores a trailing slash in ERP_API_URL", async () => {
    process.env.ERP_API_URL = "http://erp.test:3000/";
    const fetchMock = mockUpstream(upstreamJson(200, []));

    await call("GET", ["materials"]);

    assert.equal(upstreamCall(fetchMock).url, "http://erp.test:3000/materials");
  });
});

describe("blocked routes are never forwarded", () => {
  for (const [method, path] of [
    ["GET", ["pricing"]],
    ["GET", ["materials", "MAT-001", "history"]],
    ["GET", ["customers", "CUST-0001", "partners"]],
    ["GET", ["customers", ".."]],
    ["GET", ["materials", ".."]],
    ["GET", ["materials", "."]],
    ["GET", ["materials", ""]],
    ["POST", ["prisma"]],
    // Sprint 6A resources: only the exact implemented paths
    ["GET", ["customer-accounts", "CUST-0001", "units"]],
    ["GET", ["customer-accounts", "CUST-0001", "members", "CUST-0004"]],
    ["PUT", ["customer-accounts", "..", "members"]],
    ["PUT", ["customer-accounts", "", "members"]],
    ["GET", ["b2b-units", "NW-HAMBURG", "ship-tos"]],
    ["POST", ["b2b-units", "NW-HAMBURG", "ship-tos"]],
    ["GET", ["b2b-units", ".."]],
    ["GET", ["customer-account-members"]],
    ["GET", ["b2b-unit-ship-tos"]],
    // Sprint 7A resources: only the exact implemented paths
    ["POST", ["pricing"]],
    ["POST", ["pricing", "simulate"]],
    ["POST", ["pricing", "price", "MAT-002"]],
    ["GET", ["price-conditions", "7", "history"]],
    ["GET", ["price-conditions", ".."]],
    ["PATCH", ["price-conditions", ""]],
    ["GET", ["price-condition"]],
    // Condition types: only the read-only list
    ["GET", ["condition-types", "ZP02"]],
    ["PATCH", ["condition-types", "ZP02"]],
    ["GET", ["condition-type"]],
    // Sales orders: only simulation, creation, the list (Sprint 10D-B) and
    // reading one order by its 10-digit number; no changes or status actions
    ["GET", ["sales-orders", "4711"]],
    ["GET", ["sales-orders", "100000000"]],
    ["GET", ["sales-orders", "10000000011"]],
    ["GET", ["sales-orders", "100000000a"]],
    ["GET", ["sales-orders", "%31000000001"]],
    ["POST", ["sales-orders", "simulate", "x"]],
    ["POST", ["sales-orders", "place"]],
    ["POST", ["sales-orders", "1000000001", "delivery-block", "release"]],
    ["POST", ["sales-orders", "1000000001", "release-delivery-block"]],
    ["GET", ["sales-orders", "1000000001", "confirmation"]],
    ["PATCH", ["sales-orders", "1000000001", "status"]],
    // Sprint 9C-A resources: only the exact implemented paths
    ["GET", ["currencies", "EUR"]],
    ["GET", ["sales-areas", "1000"]],
    ["GET", ["sales-areas", "1000", "10", "00"]],
    ["GET", ["sales-organizations", "1000"]],
    ["GET", ["customer-sales-areas"]],
    ["POST", ["customers", "CUST-0001", "sales-areas", "1000"]],
    ["PATCH", ["customers", "CUST-0001", "sales-areas", "1000", "10"]],
    ["PATCH", ["customers", "CUST-0001", "sales-areas", "1000", "10", "00", "x"]],
    ["PATCH", ["customers", "CUST-0001", "sales-areas", "..", "10", "00"]],
    ["POST", ["customers", "..", "sales-areas"]],
  ] as const) {
    it(`${method} /${path.join("/")} -> 404`, async () => {
      const fetchMock = mockUpstream(upstreamJson(200, {}));

      const response = await call(method, [...path]);

      assert.equal(response.status, 404);
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }
});

describe("blocked methods are never forwarded", () => {
  for (const [method, path, allow] of [
    ["DELETE", ["materials", "MAT-001"], "GET, PATCH"],
    ["PUT", ["materials", "MAT-001"], "GET, PATCH"],
    ["POST", ["materials", "MAT-001"], "GET, PATCH"],
    ["PATCH", ["materials"], "GET, POST"],
    ["DELETE", ["materials"], "GET, POST"],
    ["HEAD", ["materials"], "GET, POST"],
    ["OPTIONS", ["materials"], "GET, POST"],
    ["DELETE", ["customers", "CUST-0001"], "GET, PATCH"],
    ["PUT", ["customers", "CUST-0001"], "GET, PATCH"],
    ["POST", ["customers", "CUST-0001"], "GET, PATCH"],
    ["PATCH", ["customers"], "GET, POST"],
    ["DELETE", ["customers"], "GET, POST"],
    // Sprint 6A resources
    ["POST", ["customer-accounts"], "GET"],
    ["PUT", ["customer-accounts"], "GET"],
    ["DELETE", ["customer-accounts", "CUST-0001"], "GET"],
    ["PATCH", ["customer-accounts", "CUST-0001"], "GET"],
    ["PUT", ["customer-accounts", "CUST-0001"], "GET"],
    ["GET", ["customer-accounts", "CUST-0001", "members"], "PUT"],
    ["POST", ["customer-accounts", "CUST-0001", "members"], "PUT"],
    ["PATCH", ["customer-accounts", "CUST-0001", "members"], "PUT"],
    ["DELETE", ["customer-accounts", "CUST-0001", "members"], "PUT"],
    ["DELETE", ["b2b-units", "NW-HAMBURG"], "GET, PATCH"],
    ["PUT", ["b2b-units", "NW-HAMBURG"], "GET, PATCH"],
    ["POST", ["b2b-units", "NW-HAMBURG"], "GET, PATCH"],
    ["PATCH", ["b2b-units"], "GET, POST"],
    ["PUT", ["b2b-units"], "GET, POST"],
    ["DELETE", ["b2b-units"], "GET, POST"],
    // Sprint 7A resources: no DELETE, no PUT, the price check only by POST
    ["POST", ["condition-types"], "GET"],
    ["PUT", ["condition-types"], "GET"],
    ["PATCH", ["condition-types"], "GET"],
    ["DELETE", ["condition-types"], "GET"],
    ["DELETE", ["price-conditions", "7"], "GET, PATCH"],
    ["PUT", ["price-conditions", "7"], "GET, PATCH"],
    ["POST", ["price-conditions", "7"], "GET, PATCH"],
    ["PATCH", ["price-conditions"], "GET, POST"],
    ["DELETE", ["price-conditions"], "GET, POST"],
    ["GET", ["pricing", "price"], "POST"],
    ["PUT", ["pricing", "price"], "POST"],
    ["PATCH", ["pricing", "price"], "POST"],
    ["DELETE", ["pricing", "price"], "POST"],
    // The simulation only by POST
    ["GET", ["sales-orders", "simulate"], "POST"],
    ["PUT", ["sales-orders", "simulate"], "POST"],
    ["PATCH", ["sales-orders", "simulate"], "POST"],
    ["DELETE", ["sales-orders", "simulate"], "POST"],
    // Orders are created, listed (Sprint 10D-B) and read one by one, never
    // changed or deleted
    ["PUT", ["sales-orders"], "POST, GET"],
    ["PATCH", ["sales-orders"], "POST, GET"],
    ["DELETE", ["sales-orders"], "POST, GET"],
    ["HEAD", ["sales-orders"], "POST, GET"],
    ["OPTIONS", ["sales-orders"], "POST, GET"],
    ["DELETE", ["sales-orders", "1000000001"], "GET"],
    ["PATCH", ["sales-orders", "1000000001"], "GET"],
    ["PUT", ["sales-orders", "1000000001"], "GET"],
    ["POST", ["sales-orders", "1000000001"], "GET"],
    // Sprint 9C-A: configuration is read-only, assignments are never deleted
    ["POST", ["currencies"], "GET"],
    ["PATCH", ["sales-areas"], "GET"],
    ["DELETE", ["sales-areas"], "GET"],
    ["POST", ["sales-organizations"], "GET"],
    ["PUT", ["distribution-channels"], "GET"],
    ["DELETE", ["divisions"], "GET"],
    ["GET", ["customers", "CUST-0001", "sales-areas"], "POST"],
    ["PUT", ["customers", "CUST-0001", "sales-areas"], "POST"],
    ["DELETE", ["customers", "CUST-0001", "sales-areas"], "POST"],
    ["GET", ["customers", "CUST-0001", "sales-areas", "1000", "10", "00"], "PATCH"],
    ["DELETE", ["customers", "CUST-0001", "sales-areas", "1000", "10", "00"], "PATCH"],
    ["PUT", ["customers", "CUST-0001", "sales-areas", "1000", "10", "00"], "PATCH"],
  ] as const) {
    it(`${method} /${path.join("/")} -> 405`, async () => {
      const fetchMock = mockUpstream(upstreamJson(200, {}));

      const response = await call(method, [...path]);

      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), allow);
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }
});

describe("upstream responses", () => {
  for (const [status, body] of [
    [400, { statusCode: 400, message: ["price must have at most two decimal places"], error: "Bad Request" }],
    [404, { statusCode: 404, message: "Material MAT-404 not found", error: "Not Found" }],
    [409, { statusCode: 409, message: "Material MAT-001 already exists", error: "Conflict" }],
  ] as const) {
    it(`passes ${status} through unchanged`, async () => {
      mockUpstream(upstreamJson(status, body));

      const response = await call("POST", ["materials"], material);

      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), body);
    });
  }

  for (const status of [500, 503]) {
    it(`sanitizes ${status} responses`, async () => {
      mockUpstream(
        upstreamJson(status, {
          message: "PrismaClientKnownRequestError: connection to 127.0.0.1:5432 failed",
          stack: "at PrismaService.query (prisma.service.ts:12)",
        }),
      );

      const response = await call("GET", ["materials"]);
      const text = await response.text();

      assert.equal(response.status, status);
      assert.match(text, /internal error/);
      assert.doesNotMatch(text, /Prisma|5432|stack/i);
    });
  }

  it("returns 502 when the ERP API is unreachable", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed");
    });

    const response = await call("GET", ["materials"]);

    assert.equal(response.status, 502);
    assert.match((await response.json()).message, /not reachable/);
  });

  it("returns 504 when the ERP API does not answer in time (result unknown)", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    const response = await call("POST", ["sales-orders"], {});

    assert.equal(response.status, 504);
    assert.match((await response.json()).message, /may still have been processed/);
  });

  it("waits longer for creating a sales order than for other requests", async () => {
    const timeouts: number[] = [];
    mock.method(AbortSignal, "timeout", (ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    });
    mockUpstream(upstreamJson(200, {}));

    await call("POST", ["sales-orders"], {});
    await call("POST", ["sales-orders", "simulate"], {});
    await call("GET", ["sales-orders", "1000000001"]);

    assert.deepEqual(timeouts, [30_000, 10_000, 10_000]);
  });

  it("returns 502 when no server listens on the ERP API port", async () => {
    // Real network call to a closed local port, without mocking fetch
    process.env.ERP_API_URL = "http://127.0.0.1:9";

    const response = await call("GET", ["materials"]);

    assert.equal(response.status, 502);
  });
});

describe("shop users (Sprint 12C)", () => {
  const USER = "3f8b2c1e-6a0d-4c1b-9f2e-1d2c3b4a5e6f";
  const SESSION = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

  for (const [method, path, body] of [
    ["GET", ["shop-users"], undefined],
    ["GET", ["shop-users", USER], undefined],
    ["POST", ["shop-users"], { accountCustomerNumber: "CUST-1000", email: "a@b.example", displayName: "A" }],
    ["PATCH", ["shop-users", USER], { status: "DISABLED" }],
    ["PUT", ["shop-users", USER, "units", "UNIT-STUTTGART"], undefined],
    ["DELETE", ["shop-users", USER, "units", "UNIT-STUTTGART"], undefined],
    ["POST", ["shop-users", USER, "activation-link"], undefined],
    ["POST", ["shop-users", USER, "sessions", SESSION, "revoke"], undefined],
    ["POST", ["shop-users", USER, "sessions", "revoke-all"], undefined],
  ] as const) {
    it(`${method} /${path.join("/")} is forwarded and never cached`, async () => {
      const fetchMock = mockUpstream(upstreamJson(200, { ok: true }));

      const response = await call(method, [...path], body);

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const { url, init } = upstreamCall(fetchMock);
      assert.equal(url, `http://erp.test:3000/${path.join("/")}`);
      assert.equal(init.method, method);
      assert.equal(init.body, body === undefined ? undefined : JSON.stringify(body));
    });
  }

  for (const path of [
    ["shop-users", "not-a-uuid"],
    ["shop-users", `${USER}x`],
    ["shop-users", USER, "units"],
    ["shop-users", USER, "sessions"],
    ["shop-users", USER, "sessions", "not-a-uuid", "revoke"],
    ["shop-users", USER, "password"],
    ["shop-users", USER, "credentials"],
    ["shop-users", USER, "activation-link", "x"],
  ]) {
    it(`GET/POST /${path.join("/")} -> 404`, async () => {
      const fetchMock = mockUpstream(upstreamJson(200, {}));
      assert.equal((await call("GET", path)).status, 404);
      assert.equal((await call("POST", path)).status, 404);
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }

  it("never reads activation links with GET", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, {}));
    const response = await call("GET", ["shop-users", USER, "activation-link"]);
    assert.equal(response.status, 405);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});

describe("local-only boundary (Sprint 12C)", () => {
  it("refuses requests addressed to another host name (DNS rebinding)", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, []));
    for (const host of ["attacker.example:3001", "localhost.attacker.example:3001", "127.0.0.1.nip.io:3001"]) {
      const read = await call("GET", ["shop-users"], undefined, "", { Host: host });
      assert.equal(read.status, 403, host);
      assert.equal(read.headers.get("Cache-Control"), "no-store");
      const write = await call("POST", ["shop-users", "3f8b2c1e-6a0d-4c1b-9f2e-1d2c3b4a5e6f", "activation-link"], undefined, "", { Host: host, Origin: `http://${host}` });
      assert.equal(write.status, 403, host);
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("forwards changes only from the Backoffice's own pages (CSRF)", async () => {
    const fetchMock = mockUpstream(upstreamJson(201, {}));
    const body = { accountCustomerNumber: "CUST-1000", email: "a@b.example", displayName: "A" };
    for (const headers of [
      { Origin: "" },
      { Origin: "http://attacker.example" },
      { Origin: "http://127.0.0.1:3001" },
      { Origin: "null" },
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
    ] as Record<string, string>[]) {
      const response = await call("POST", ["shop-users"], body, "", headers);
      assert.equal(response.status, 403, JSON.stringify(headers));
    }
    // Also the existing admin routes, e.g. a price condition
    assert.equal((await call("POST", ["price-conditions"], {}, "", { Origin: "http://attacker.example" })).status, 403);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal((await call("POST", ["shop-users"], body, "", { "Sec-Fetch-Site": "same-origin" })).status, 201);
  });

  it("accepts JSON bodies only (no form or text/plain requests)", async () => {
    const fetchMock = mockUpstream(upstreamJson(201, {}));
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const response = await call("POST", ["shop-users"], { email: "a@b.example" }, "", { "Content-Type": type });
      assert.equal(response.status, 415, type);
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("never caches answers, also errors and refusals", async () => {
    mockUpstream(upstreamJson(422, { message: "x" }));
    for (const response of [
      await call("GET", ["shop-users", "x", "y", "z"]),
      await call("POST", ["shop-users"], {}),
      await call("DELETE", ["materials"]),
    ]) {
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  });
});
