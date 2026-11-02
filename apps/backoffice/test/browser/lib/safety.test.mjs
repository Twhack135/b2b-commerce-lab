import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import {
  assertPortsFree,
  assertTestApiUrl,
  assertTestContainerName,
  assertTestDatabaseUrl,
  assertTestPort,
  assertTestPorts,
  serviceEnvironment,
} from "./safety.mjs";

describe("assertTestPort", () => {
  it("accepts unprivileged ports that are not protected", () => {
    assert.equal(assertTestPort(3300, "api"), 3300);
    assert.equal(assertTestPort(55450, "database"), 55450);
  });

  for (const port of [3000, 3001, 3002, 5432]) {
    it(`never uses the development port ${port}`, () => {
      assert.throws(() => assertTestPort(port, "x"), /belongs to the development environment/);
    });
  }

  for (const port of [0, 80, 1023, 65536, 3300.5, Number.NaN]) {
    it(`rejects the invalid port ${port}`, () => {
      assert.throws(() => assertTestPort(port, "x"), /not a valid unprivileged port/);
    });
  }

  it("rejects two services on the same port", () => {
    assert.throws(() => assertTestPorts({ api: 3300, backoffice: 3300 }), /same port 3300/);
  });
});

describe("assertTestDatabaseUrl", () => {
  const url = (rest) => `postgresql://erp_user:pw@${rest}`;

  it("accepts the local disposable test database", () => {
    assert.doesNotThrow(() => assertTestDatabaseUrl(url("127.0.0.1:55450/b2b_erp_browser_test"), 55450));
  });

  for (const [name, value] of [
    ["the development database", url("127.0.0.1:5432/b2b_erp")],
    ["the development database name on the test port", url("127.0.0.1:55450/b2b_erp")],
    ["the development port", url("127.0.0.1:5432/b2b_erp_browser_test")],
    ["another port", url("127.0.0.1:55451/b2b_erp_browser_test")],
    ["another host", url("db.example.com:55450/b2b_erp_browser_test")],
    ["localhost (ambiguous between IPv4 and IPv6)", url("localhost:55450/b2b_erp_browser_test")],
    ["a name without _test", url("127.0.0.1:55450/b2b_erp_browser")],
    ["redirecting parameters", url("127.0.0.1:55450/b2b_erp_browser_test?host=127.0.0.1&port=5432")],
    ["another protocol", "mysql://u:p@127.0.0.1:55450/x_test"],
    ["no URL", "not a url"],
  ]) {
    it(`rejects ${name}`, () => {
      assert.throws(() => assertTestDatabaseUrl(value, 55450));
    });
  }
});

describe("assertTestApiUrl", () => {
  it("accepts exactly the test API", () => {
    assert.equal(assertTestApiUrl("http://127.0.0.1:3300", 3300), "http://127.0.0.1:3300");
  });

  for (const value of ["http://127.0.0.1:3000", "http://localhost:3300", "http://127.0.0.1:3301", "https://127.0.0.1:3300"]) {
    it(`rejects ${value}`, () => {
      assert.throws(() => assertTestApiUrl(value, 3300));
    });
  }

  it("rejects the development API even if configured as test port", () => {
    assert.throws(() => assertTestApiUrl("http://127.0.0.1:3000", 3000), /never use port 3000/);
  });
});

describe("assertTestContainerName", () => {
  it("accepts only container names of the runner", () => {
    assert.equal(assertTestContainerName("b2b-browser-test-1a2b3c4d"), "b2b-browser-test-1a2b3c4d");
    for (const name of [
      "b2b-commerce-lab-postgres-1",
      "b2b-browser-test-",
      "b2b-browser-test-1a2b",
      "b2b-browser-test-X Y",
      "b2b-browser-test-1a2b3c4d-other",
      "postgres",
    ]) {
      assert.throws(() => assertTestContainerName(name), /not a browser test container name/, name);
    }
  });
});

describe("serviceEnvironment", () => {
  it("removes everything that could redirect a service and sets the test values", () => {
    const env = serviceEnvironment(
      { PATH: "x", DATABASE_URL: "postgresql://dev", PGHOST: "db", PGPORT: "5432", ERP_API_URL: "http://127.0.0.1:3000", SHOP_SERVICE_KEY: "dev-key", SHOP_TRUSTED_PROXY_HOPS: "1", SHOP_PUBLIC_URL: "http://127.0.0.1:3002", PORT: "3000", HOST: "0.0.0.0" },
      { DATABASE_URL: "postgresql://test", PORT: "3300", HOST: "127.0.0.1" },
    );
    assert.deepEqual(env, { PATH: "x", DATABASE_URL: "postgresql://test", PORT: "3300", HOST: "127.0.0.1" });
  });
});

describe("assertPortsFree", () => {
  it("refuses a port that is in use and leaves its owner alone", async () => {
    const server = net.createServer().listen({ host: "127.0.0.1", port: 0 });
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    try {
      await assert.rejects(assertPortsFree({ api: port }), /already in use.*never stops processes/);
      // The owner keeps running
      assert.equal(server.listening, true);
    } finally {
      server.close();
    }
  });

  it("accepts a free port", async () => {
    const server = net.createServer().listen({ host: "127.0.0.1", port: 0 });
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    await new Promise((resolve) => server.close(resolve));
    await assert.doesNotReject(assertPortsFree({ api: port }));
  });
});
