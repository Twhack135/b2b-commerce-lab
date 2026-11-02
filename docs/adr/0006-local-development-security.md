# ADR 0006: Local development security and deployment restrictions

Status: accepted (Sprint 11)

## Context

The admin endpoints of the ERP API and the Backoffice have no
authentication. Binding to 127.0.0.1 protects them on a developer
computer, but it is **not** sufficient for a customer-facing shop.

## Decision: until all security requirements are met

- Everything runs **on this computer only**: ERP API 127.0.0.1:3000,
  Backoffice 127.0.0.1:3001, Shop 127.0.0.1:3002, PostgreSQL 127.0.0.1:5432.
- The ERP API **refuses to start** with any `HOST` other than `127.0.0.1`,
  `::1` or `localhost`. There is deliberately no override.
- The shop only accepts an ERP address on this computer (`http://127.0.0.1`,
  `localhost` or `[::1]`) and calls only `/shop/v1`.
- **Fail closed:** a missing or weak `SHOP_SERVICE_KEY` (fewer than 32
  visible characters) closes `/shop/v1` (503) and the shop reports the ERP
  as unavailable. Reasons appear only in server logs. The admin API and
  the Backoffice keep working without the key.
- Secrets live only in ignored files (`.env`, `apps/shop/.env.local`) and
  are never printed; the examples (`.env.example`) contain no values.
  Shop secrets have no `NEXT_PUBLIC_` prefix and are read only in server
  code (`import "server-only"`) at request time, never during the build.
- Security headers: the shop sends a Content Security Policy (no framing,
  no foreign scripts or connections, no plugins), `nosniff`, `DENY`
  framing, a referrer policy and no `X-Powered-By`. The ERP API sends
  `nosniff` and no `X-Powered-By`; `/shop/v1` answers are not cached.
- Browser tests run in an isolated environment; the development ports
  3000, 3001, 3002 and 5432 are never used by tests.

## The Backoffice is not safe for remote deployment

The Backoffice manages shop users and issues activation links since
Sprint 12C, still **without administrator authentication**. It may only
run on this computer. Sprint 12C adds protection against foreign web pages
in the local browser (Host check against DNS rebinding, Origin check
against CSRF, no framing; docs/adr/0007). These checks are no substitute
for a sign-in: anyone who can reach port 3001 or 3000 can administer.

## Required before the shop may leave local development

1. User sessions and unit authorization (ADR 0003, 0004) with the
   authorization test matrix.
2. Authentication and authorization for the Backoffice and the admin API
   (including the shop user administration), or a network that makes them
   unreachable from outside.
3. HTTPS with HSTS, secure cookies, a nonce-based Content Security Policy.
4. Durable, shared rate limiting of sign-in, activation and price queries
   (the sign-in limits of Sprint 12B live in the memory of one ERP process
   and are development only), a trusted reverse proxy that sets the client
   address (`SHOP_TRUSTED_PROXY_HOPS`), and an audit log for logins, orders
   and authorization changes.
5. Secret management for the service key and its rotation.
6. A security review of the deployment.
