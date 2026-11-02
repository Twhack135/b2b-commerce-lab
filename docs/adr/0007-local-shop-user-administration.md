# ADR 0007: Local shop user administration and unit selection

Status: accepted and implemented (Sprint 12C)

## Context

Shop users (12A) can sign in since 12B, but were created with a command-line
tool. The Backoffice should manage them. The Backoffice and the ERP admin
API have **no administrator authentication**. Binding to 127.0.0.1 keeps
other computers out, but not other web pages in the browser of this
computer:

- **CSRF:** any page may send a form or a simple `POST` to
  `127.0.0.1:3001`. The Backoffice proxy forwarded bodies of any content
  type as JSON.
- **DNS rebinding:** a foreign domain that resolves to 127.0.0.1 can read
  and write the Backoffice and the ERP admin API as "its own" origin.
- **Clickjacking:** a foreign page could frame the Backoffice and trick a
  click on an admin action.

Activation links are passwords in all but name, so these gaps matter as
soon as the Backoffice can issue them.

## Decision

### Administration boundary (local development only)

- Shop users are managed through the **admin API** `/shop-users` of the
  ERP, not through the customer-facing `/shop/v1`. The shop BFF only knows
  fixed `/shop/v1` paths, so no customer can reach the administration.
- **No fake administrator login.** Instead, every layer refuses what a
  foreign web page could send:
  - ERP API: every request must carry a loopback Host header
    (`127.0.0.1`, `localhost`, `[::1]`), else 403 before any route runs.
  - Backoffice proxy: the same Host check; state-changing methods need
    `Origin` exactly `http://<Host>` and, if sent, `Sec-Fetch-Site:
    same-origin`; request bodies must be JSON; it forwards only listed
    routes with UUID checks for user and session IDs (no generic proxy).
  - Backoffice pages: `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
    `Referrer-Policy: no-referrer`, `nosniff`, no `X-Powered-By`.
  - All admin and shop answers: `Cache-Control: no-store`.
- The Backoffice shows a permanent notice on the shop user page: no
  administrator sign-in, this computer only.
- **The Backoffice is NOT safe for remote deployment** until administrator
  authentication and authorization exist (ADR 0006).

### What the administration can do

List and search users; create a user for an active customer account with
active units of that account (one transaction); change the display name;
disable and enable; assign and remove units (own account only, enforced by
the database as well); create a one-time activation link; list open
sessions (never tokens or hashes) and end one or all of them.

- **Activation links** are built by the ERP from `SHOP_PUBLIC_URL`
  (https, or http on this computer), with the token in the URL fragment.
  The admin API returns the link exactly once; the ERP stores only its
  hash. The Backoffice keeps it only in the state of a dialog: never in
  browser storage, the address bar or a log. A new link replaces an unused
  one.
- **Disabling** ends all sessions at once (database trigger, 12B).
  **Ending sessions** signs browsers out, but the user may sign in again;
  to withdraw access, disable the user.

### Unit selection in the shop

- New customer endpoint `GET /shop/v1/account`: the user, the units the
  ERP authorizes for this session, and the selected unit.
- The shop remembers the chosen unit in its own cookie (`shop_unit`, over
  HTTPS `__Host-shop_unit`; HttpOnly, SameSite=Lax, Path=/) and sends it as
  `X-Shop-Unit`. The cookie is **a preference, not an authorization**: the
  ERP selects it only if it is one of the session's authorized units,
  computed from the assignments on every request. Otherwise it selects the
  only unit, if there is exactly one, else none, and reports the rejected
  choice. No second authentication mechanism: the session alone decides
  who is acting.
- Choosing a unit is a same-origin form POST (`/api/units/select`) that is
  only remembered if the ERP confirms it. Sign-in and sign-out clear the
  remembered unit.
- Inactive units stay selectable for viewing and are marked view only
  (`canOrder: false`). `canOrder` and the selection are display information
  only: every future order endpoint must check ORDER authorization itself
  (active user, account and unit, the assignment), inside its own
  transaction (docs/roadmap.md, R1).
- A removed unit, a disabled user and an inactive account take effect with
  the next request.

### Audit trail: deliberately not yet

A minimal additive table of administration events was considered. Without
an administrator identity it could only record *what* happened, never
*who* did it, which would suggest an accountability that does not exist.
The existing data already records the essential moments (`created_at`,
`updated_at`, activation link created and used, session created, revoked).
An audit log belongs together with administrator authentication (ADR 0006,
item 4). No migration was needed for this sprint.

## Consequences

- The Host check also protects every existing admin route. Clients must
  address the ERP as `127.0.0.1`, `localhost` or `[::1]` (all apps do).
- The command-line tool `npm run shop:user` stays for scripts and tests.
- Before any deployment: administrator authentication and authorization,
  an audit log with the acting administrator, durable rate limits, HTTPS
  and a nonce-based CSP (ADR 0006).
