import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import * as handlers from "./route.ts";

// Calls the route handler like Next.js would for /api/erp/<path...>
function call(method: string, path: string[], body?: unknown, query = "") {
  const handler = handlers[method as keyof typeof handlers];
  const request = new Request(
    `http://localhost:3001/api/erp/${path.join("/")}${query}`,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
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

  // Sprint 6A endpoints
  const unitBody = {
    unitId: "NW-HAMBURG",
    name: "Nordwind Hamburg",
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

  it("encodes the account number inside the members path", async () => {
    const fetchMock = mockUpstream(upstreamJson(200, {}));

    await call("PUT", ["customer-accounts", "A/B", "members"], { memberCustomerNumbers: [] });

    assert.equal(
      upstreamCall(fetchMock).url,
      "http://erp.test:3000/customer-accounts/A%2FB/members",
    );
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
    ["GET", ["sales-orders"]],
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
    // Sprint 8A resources: only the simulation exists, no sales orders yet
    ["GET", ["sales-orders"]],
    ["POST", ["sales-orders"]],
    ["GET", ["sales-orders", "4711"]],
    ["POST", ["sales-orders", "simulate", "x"]],
    ["POST", ["sales-orders", "place"]],
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

  it("returns 502 when no server listens on the ERP API port", async () => {
    // Real network call to a closed local port, without mocking fetch
    process.env.ERP_API_URL = "http://127.0.0.1:9";

    const response = await call("GET", ["materials"]);

    assert.equal(response.status, 502);
  });
});
