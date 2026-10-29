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
