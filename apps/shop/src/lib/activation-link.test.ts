import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseActivationFragment, submitBlocker } from "./activation-link.ts";

const TOKEN = "A".repeat(20) + "b_-" + "9".repeat(20);

describe("parseActivationFragment", () => {
  it("reads a complete link", () => {
    assert.deepEqual(parseActivationFragment(`#token=${TOKEN}`), { kind: "token", token: TOKEN });
  });

  it("tells a missing token (e.g. after a reload) from a broken link", () => {
    assert.deepEqual(parseActivationFragment(""), { kind: "missing" });
    assert.deepEqual(parseActivationFragment("#"), { kind: "missing" });
    for (const hash of [`#token=${TOKEN.slice(1)}`, `#token=${TOKEN}x`, "#token=", `#${TOKEN}`, `#token=${TOKEN}&x=1`, "#token=<script>"]) {
      assert.deepEqual(parseActivationFragment(hash), { kind: "malformed" }, hash);
    }
  });
});

describe("submitBlocker", () => {
  const valid = "Radiators hum softly in Stuttgart 2026";

  it("says what is missing instead of only disabling the button", () => {
    assert.equal(submitBlocker("", ""), "Enter at least 15 characters (0 so far).");
    assert.equal(submitBlocker("short", ""), "Enter at least 15 characters (5 so far).");
    assert.equal(submitBlocker(valid, ""), "Repeat the password.");
    assert.equal(submitBlocker(valid, `${valid}!`), "The passwords do not match.");
    assert.equal(submitBlocker(valid, valid), null);
  });

  it("counts characters like the ERP password policy (NFKC, code points)", () => {
    assert.equal(submitBlocker("😀".repeat(15), "😀".repeat(15)), null);
    assert.match(submitBlocker("😀".repeat(14), "") ?? "", /14 so far/);
  });
});
