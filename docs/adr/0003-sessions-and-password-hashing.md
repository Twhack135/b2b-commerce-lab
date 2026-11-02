# ADR 0003: Server-side sessions and password hashing

Status: accepted; implemented in Sprint 12B (with the deviations below)

## Decision

- **Opaque server-side sessions** instead of self-contained tokens (JWT):
  a random token of 256 bits; the database stores only its SHA-256 hash.
  Logout, deactivation of a user and withdrawn authorizations take effect
  immediately, because every request checks the session in the ERP.
- The session is owned by the ERP; the shop BFF keeps the token in a cookie
  and forwards it to `/shop/v1` together with the service key.
- Cookie: `__Host-` prefix, `HttpOnly`, `Secure` (except plain-HTTP
  localhost), `SameSite=Lax`, `Path=/`.
- New session ID after login (no session fixation); idle timeout of about
  30 minutes, absolute lifetime of about 10 hours; logout ends the session
  on the server.
- **Passwords:** hashed with **Argon2id** through a maintained library
  (parameters following current OWASP guidance), never stored or logged in
  plain text. The library is a new dependency and needs its own approval.
- Login: one generic error message, rate limits per account and per
  address, the same answer time for unknown accounts.
- First password through a one-time activation link created in the
  Backoffice; the Backoffice never shows a password.

## Implemented (Sprint 12B)

- Tables `shop_user_credentials` (Argon2id PHC string), `shop_activation_tokens`
  and `shop_sessions` (SHA-256 of the tokens only); migration
  `20261103090000_add_shop_authentication`.
- ERP `/shop/v1/auth`: `POST activation`, `POST login`, `GET session`,
  `POST logout`, all behind the service key; `session` needs the user's
  session (`X-Shop-Session`), which the BFF takes from its HttpOnly cookie.
- Activation links: 256-bit random, valid 24 hours and once; redeemed under
  a row lock in one transaction; never for disabled users, inactive
  accounts or users who already have a password; a new link replaces an
  unused one.
- Sessions: idle timeout 30 minutes, absolute lifetime 10 hours, checked
  with the user and account status on every request; sign-in ends the
  browser's previous session.
- Withdrawn access ends sessions **for good**: database triggers revoke all
  sessions when a user is disabled or a customer account (its owner
  customer) is deactivated, on every path (API, direct database changes,
  future imports). Reactivating restores no old session. A sign-in creates
  its session under a lock on the user and the owner customer (FOR SHARE),
  so a concurrent deactivation either waits and then revokes it, or the
  sign-in waits and is refused.
- Login: one generic error; unknown users are checked against a dummy hash
  (same time).
- Rate limits (15-minute windows): 5 unsuccessful sign-ins per e-mail
  address; 30 per trusted client address; requests without a trusted
  client address share one limit of 50 (activation: 10 per trusted address,
  20 shared). Attempts are counted **before** they are checked, so
  concurrent requests cannot exceed a limit; successful attempts do not
  count. The limits are **development only**: they live in the memory of
  one ERP process, start again after a restart and are not shared between
  processes (no durable or distributed rate limiting).
- Client addresses: the BFF trusts no `X-Forwarded-For` unless
  `SHOP_TRUSTED_PROXY_HOPS` names the number of trusted reverse proxies;
  it then uses the entry the outermost trusted proxy added. Forged headers
  only end up in the shared limit.
- Shop BFF: route handlers `/api/auth/login|logout|activate` with an Origin
  check (CSRF) and `Cache-Control: no-store`; pages `/login`, `/activate`,
  `/account`.

## Deviations from the decision above

1. **Argon2id from Node.js itself** (`node:crypto`, Node 24.7 or later;
   verified with Node 26.13 and the test vector of RFC 9106) instead of a
   third-party library: maintained with Node.js, no native build scripts,
   no new dependency. The ERP refuses to start without it; its
   `package.json` declares `engines.node >=24.7.0`.
   Parameters: 19 MiB, 2 passes, parallelism 1 (OWASP); stored as a PHC
   string, so they can be raised later.
2. **Cookie name on plain-HTTP localhost:** browsers accept the `__Host-`
   prefix only with `Secure`, so local HTTP uses `shop_session` (HttpOnly,
   SameSite=Lax, Path=/) and only on loopback addresses; over HTTPS it is
   `__Host-shop_session` with `Secure`. No sign-in over plain HTTP elsewhere.
3. **Activation links** first came from a local command-line tool
   (`npm run shop:user` in `apps/erp-api`). Since Sprint 12C the Backoffice
   creates them through the local admin API (docs/adr/0007); the tool
   stays for scripts and tests. No customer-facing endpoint issues links.
4. **Password policy:** NIST SP 800-63B Rev. 4 for passwords as the only
   factor: at least 15 characters, at most 128, no composition rules,
   Unicode NFKC, common values and the e-mail address refused.

## Not yet implemented

Password reset, e-mail delivery, cleanup of expired sessions and tokens,
an audit log, and durable rate limits shared by several ERP processes
(required before any deployment, docs/adr/0006).
