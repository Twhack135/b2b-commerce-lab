# ADR 0003: Server-side sessions and future password hashing

Status: accepted, not implemented (planned after Sprint 11)

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

## Current state (Sprint 11)

Nothing of this exists: no user table, no password storage, no session,
no login page. The shop must not imitate a sign-in until this ADR is
implemented.
