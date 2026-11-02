import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isJsonContentType, isLocalHost, isSafeMethod, isSameOrigin } from "./request-guard.ts";

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

describe("isLocalHost (DNS rebinding)", () => {
  it("serves requests addressed to this computer", () => {
    for (const host of ["127.0.0.1:3001", "localhost:3001", "LOCALHOST:3001", "[::1]:3001", "127.0.0.1"]) {
      assert.equal(isLocalHost(host), true, host);
    }
  });

  it("refuses foreign host names, also when they resolve to 127.0.0.1", () => {
    for (const host of [null, "", "attacker.example:3001", "localhost.attacker.example:3001", "127.0.0.1.nip.io:3001", "localhost.:3001", "127.0.0.2:3001", "127.0.0.1@attacker.example", "127.0.0.1:3001/x", "127.0.0.1:80"]) {
      assert.equal(isLocalHost(host), false, String(host));
    }
  });
});

describe("isSameOrigin (CSRF)", () => {
  it("accepts requests from the Backoffice's own pages", () => {
    assert.equal(isSameOrigin(headers({ host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" })), true);
    assert.equal(isSameOrigin(headers({ host: "localhost:3001", origin: "http://localhost:3001", "sec-fetch-site": "same-origin" })), true);
  });

  it("refuses other sites, missing headers and mismatches", () => {
    for (const values of [
      { host: "127.0.0.1:3001" },
      { origin: "http://127.0.0.1:3001" },
      { host: "127.0.0.1:3001", origin: "http://attacker.example" },
      { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3002" },
      { host: "127.0.0.1:3001", origin: "http://localhost:3001" },
      { host: "127.0.0.1:3001", origin: "https://127.0.0.1:3001" },
      { host: "127.0.0.1:3001", origin: "null" },
      { host: "attacker.example:3001", origin: "http://attacker.example:3001" },
      { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001", "sec-fetch-site": "cross-site" },
      { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001", "sec-fetch-site": "same-site" },
    ] as Record<string, string>[]) {
      assert.equal(isSameOrigin(headers(values)), false, JSON.stringify(values));
    }
  });
});

describe("methods and content types", () => {
  it("treats only GET and HEAD as safe", () => {
    assert.deepEqual(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map(isSafeMethod), [true, true, false, false, false, false, false]);
  });

  it("accepts JSON bodies only", () => {
    assert.equal(isJsonContentType("application/json"), true);
    assert.equal(isJsonContentType("application/json; charset=utf-8"), true);
    for (const type of [null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonp", "application/json-patch+json"]) {
      assert.equal(isJsonContentType(type), false, String(type));
    }
  });
});
