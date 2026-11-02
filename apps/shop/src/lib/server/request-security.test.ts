import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientAddress,
  trustedProxyHops,
  LOCAL_SESSION_COOKIE,
  sameOrigin,
  SECURE_SESSION_COOKIE,
  sessionCookie,
  sessionTokenFrom,
} from "./request-security.ts";

const headers = (values: Record<string, string | undefined>) => ({
  get: (name: string) => values[name] ?? null,
});
const cookies = (values: Record<string, string>) => ({
  get: (name: string) => (name in values ? { value: values[name] } : undefined),
});

describe("same-origin check (CSRF)", () => {
  it("accepts a POST from a page of this shop", () => {
    for (const [host, origin] of [
      ["127.0.0.1:3002", "http://127.0.0.1:3002"],
      ["localhost:3002", "http://localhost:3002"],
      ["shop.example.com", "https://shop.example.com"],
    ]) {
      assert.equal(sameOrigin(headers({ host, origin }))?.origin, origin);
      assert.ok(sameOrigin(headers({ host, origin, "sec-fetch-site": "same-origin" })));
    }
  });

  it("rejects other sites, missing headers and plain HTTP on a real domain", () => {
    for (const values of [
      { host: "127.0.0.1:3002" },
      { origin: "http://127.0.0.1:3002" },
      { host: "127.0.0.1:3002", origin: "http://evil.example" },
      { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3003" },
      { host: "127.0.0.1:3002", origin: "null" },
      { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002/path" },
      { host: "shop.example.com", origin: "http://shop.example.com" },
      { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002", "sec-fetch-site": "cross-site" },
      { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002", "sec-fetch-site": "same-site" },
    ]) {
      assert.equal(sameOrigin(headers(values)), null, JSON.stringify(values));
    }
  });
});

describe("session cookie", () => {
  it("is __Host- and Secure over HTTPS, plain on HTTP localhost, never elsewhere", () => {
    assert.deepEqual(sessionCookie(new URL("https://shop.example.com")), {
      name: SECURE_SESSION_COOKIE,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
    });
    assert.deepEqual(sessionCookie(new URL("http://127.0.0.1:3002")), {
      name: LOCAL_SESSION_COOKIE,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: false },
    });
    assert.equal(sessionCookie(new URL("http://shop.example.com")), null);
  });

  it("reads the local cookie only on this computer", () => {
    assert.equal(sessionTokenFrom(cookies({ [LOCAL_SESSION_COOKIE]: "a" }), "127.0.0.1:3002"), "a");
    assert.equal(sessionTokenFrom(cookies({ [LOCAL_SESSION_COOKIE]: "a" }), "shop.example.com"), undefined);
    assert.equal(sessionTokenFrom(cookies({ [SECURE_SESSION_COOKIE]: "b", [LOCAL_SESSION_COOKIE]: "a" }), "127.0.0.1:3002"), "b");
    assert.equal(sessionTokenFrom(cookies({}), "127.0.0.1:3002"), undefined);
  });
});

describe("client address (IP trust model)", () => {
  it("trusts no X-Forwarded-For without a configured proxy (any client can send it)", () => {
    assert.equal(trustedProxyHops({}), 0);
    assert.equal(clientAddress(headers({ "x-forwarded-for": "203.0.113.7" }), 0), undefined);
  });

  it("takes the entry the outermost trusted proxy added, never one the client sent", () => {
    // The client sent "6.6.6.6"; the one trusted proxy appended the real peer
    const spoofed = headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
    assert.equal(clientAddress(spoofed, 1), "203.0.113.7");
    assert.equal(clientAddress(headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.2, 10.0.0.1" }), 2), "198.51.100.2");
    assert.equal(clientAddress(headers({ "x-forwarded-for": "2001:db8::1" }), 1), "2001:db8::1");
  });

  it("answers undefined for missing, short or malformed values", () => {
    assert.equal(clientAddress(headers({}), 1), undefined);
    assert.equal(clientAddress(headers({ "x-forwarded-for": "203.0.113.7" }), 2), undefined);
    assert.equal(clientAddress(headers({ "x-forwarded-for": "evil<script>" }), 1), undefined);
  });

  it("treats an invalid proxy setting as no trusted proxy (fail closed)", () => {
    for (const value of ["", "-1", "1.5", "6", "yes", "10"]) {
      assert.equal(trustedProxyHops({ SHOP_TRUSTED_PROXY_HOPS: value }), 0, value);
    }
    assert.equal(trustedProxyHops({ SHOP_TRUSTED_PROXY_HOPS: "1" }), 1);
  });
});
