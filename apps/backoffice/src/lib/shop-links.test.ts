import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shopLinks, shopLinkUrl } from "./shop-links.ts";

describe("shopLinkUrl", () => {
  it("accepts HTTPS addresses and plain HTTP on this computer", () => {
    assert.equal(shopLinkUrl("https://shop.example.com"), "https://shop.example.com");
    assert.equal(shopLinkUrl("https://shop.example.com/de/"), "https://shop.example.com/de");
    assert.equal(shopLinkUrl("http://127.0.0.1:3313/"), "http://127.0.0.1:3313");
    assert.equal(shopLinkUrl("http://localhost:3002"), "http://localhost:3002");
  });

  it("refuses everything else, so no unexpected target can be opened", () => {
    for (const value of [
      undefined,
      "",
      "shop.example.com",
      "http://shop.example.com",
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://127.0.0.1",
      "https://user:secret@shop.example.com",
      "https://shop.example.com/?ref=x",
      "https://shop.example.com/#x",
    ]) {
      assert.equal(shopLinkUrl(value), null, String(value));
    }
  });
});

describe("shopLinks", () => {
  it("lists both environments; unconfigured ones have no address", () => {
    assert.deepEqual(shopLinks({ SHOP_LINK_TEST_URL: "http://127.0.0.1:3313" }), [
      { key: "test", label: "Test shop", url: "http://127.0.0.1:3313" },
      { key: "production", label: "Production shop", url: null },
    ]);
    assert.deepEqual(
      shopLinks({}).map((link) => link.url),
      [null, null],
    );
  });
});
