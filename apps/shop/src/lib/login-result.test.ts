import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loginResult } from "./login-result.ts";

const SHOP = "http://127.0.0.1:3002";

describe("loginResult", () => {
  it("is signed in only when the shop sent the browser to the account page", () => {
    assert.deepEqual(loginResult(`${SHOP}/account`, SHOP), { kind: "signed-in" });
    assert.deepEqual(loginResult("http://evil.example/account", SHOP), { kind: "failed", reason: "unavailable" });
  });

  it("reads the generic reasons of the sign-in page", () => {
    for (const reason of ["invalid", "locked", "unavailable", "request"]) {
      assert.deepEqual(loginResult(`${SHOP}/login?error=${reason}`, SHOP), { kind: "failed", reason });
    }
  });

  it("treats everything unexpected as unavailable", () => {
    for (const url of [null, "", "not a url", `${SHOP}/login`, `${SHOP}/login?error=<script>`, `${SHOP}/api/auth/login`, `${SHOP}/`]) {
      assert.deepEqual(loginResult(url, SHOP), { kind: "failed", reason: "unavailable" }, String(url));
    }
  });
});
