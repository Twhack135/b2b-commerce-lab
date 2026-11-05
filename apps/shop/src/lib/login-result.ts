// How the sign-in form reads the answer of /api/auth/login when it is sent
// with JavaScript (Sprint 12C acceptance, UX-002). The route answers with a
// redirect, as for the plain form: to /account on success, otherwise back
// to /login?error=<reason>. No imports, so it can be tested with `node --test`.

/** The reasons the sign-in page knows; anything else is "unavailable" */
export const LOGIN_FAILURES = ["invalid", "locked", "unavailable", "request"] as const;
export type LoginFailure = (typeof LOGIN_FAILURES)[number];

export type LoginResult = { kind: "signed-in" } | { kind: "failed"; reason: LoginFailure };

/** The result from the address the browser was finally sent to (null: network error) */
export function loginResult(finalUrl: string | null, shopOrigin: string): LoginResult {
  let url: URL;
  try {
    url = new URL(finalUrl ?? "");
  } catch {
    return { kind: "failed", reason: "unavailable" };
  }
  // Only an answer from this shop counts
  if (url.origin !== shopOrigin) return { kind: "failed", reason: "unavailable" };
  if (url.pathname === "/account") return { kind: "signed-in" };
  const reason = url.pathname === "/login" ? url.searchParams.get("error") : null;
  return { kind: "failed", reason: LOGIN_FAILURES.find((known) => known === reason) ?? "unavailable" };
}
