import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readShopServerConfig } from "./config.ts";

const KEY = "a".repeat(64);

describe("shop server configuration", () => {
  it("accepts a loopback ERP API and a key of at least 32 characters", () => {
    for (const url of ["http://127.0.0.1:3000", "http://127.0.0.1:3300/", "http://localhost:3000", "http://[::1]:3000"]) {
      const config = readShopServerConfig({ ERP_API_URL: url, SHOP_SERVICE_KEY: KEY });
      assert.equal(config.ok, true, url);
    }
    assert.deepEqual(readShopServerConfig({ ERP_API_URL: "http://127.0.0.1:3000/", SHOP_SERVICE_KEY: KEY }), {
      ok: true,
      erpApiUrl: "http://127.0.0.1:3000",
      serviceKey: KEY,
    });
  });

  it("fails closed without a usable key", () => {
    for (const key of [undefined, "", "short", "a".repeat(31), `${"a".repeat(31)} b`]) {
      const config = readShopServerConfig({ ERP_API_URL: "http://127.0.0.1:3000", SHOP_SERVICE_KEY: key });
      assert.equal(config.ok, false, String(key));
    }
  });

  it("only calls an ERP API on this computer (local development)", () => {
    for (const url of [
      undefined,
      "",
      "not a url",
      "https://127.0.0.1:3000",
      "http://erp.example.com:3000",
      "http://10.0.0.5:3000",
      "http://127.0.0.1.evil.test:3000",
      "http://user:pw@127.0.0.1:3000",
      "http://127.0.0.1:3000/admin",
      "http://127.0.0.1:3000/?x=1",
      "file:///etc/passwd",
    ]) {
      const config = readShopServerConfig({ ERP_API_URL: url, SHOP_SERVICE_KEY: KEY });
      assert.equal(config.ok, false, String(url));
    }
  });

  it("names the problem without revealing the key", () => {
    const config = readShopServerConfig({ ERP_API_URL: "http://127.0.0.1:3000", SHOP_SERVICE_KEY: "secret-but-short" });
    assert.equal(config.ok, false);
    assert.ok(!JSON.stringify(config).includes("secret-but-short"));
  });
});
