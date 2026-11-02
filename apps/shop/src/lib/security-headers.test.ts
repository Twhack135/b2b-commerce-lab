import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentSecurityPolicy, securityHeaders } from "./security-headers.ts";

describe("security headers", () => {
  it("forbids framing, plugins, foreign scripts and foreign connections", () => {
    const csp = contentSecurityPolicy(false);
    for (const directive of [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      assert.ok(csp.split("; ").includes(directive), directive);
    }
  });

  it("allows eval only in development (React development tools)", () => {
    assert.ok(!contentSecurityPolicy(false).includes("unsafe-eval"));
    assert.ok(contentSecurityPolicy(true).includes("script-src 'self' 'unsafe-inline' 'unsafe-eval'"));
  });

  it("sets the hardening headers", () => {
    const headers = Object.fromEntries(securityHeaders(false).map((h) => [h.key, h.value]));
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
    assert.ok(headers["Permissions-Policy"].includes("camera=()"));
  });
});
