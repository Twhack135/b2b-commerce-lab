# ADR 0001: Dedicated shop BFF and ERP shop API boundary

Status: accepted (Sprint 11)

## Context

The lab has an ERP API (NestJS) with admin endpoints for master data,
prices and sales orders, and an internal Backoffice. Business customers
need their own shop. The ERP must stay the source of truth for customers,
B2B units, partner determination, pricing, simulation and sales orders.

## Decision

- The shop is a separate Next.js application, `apps/shop`. It acts as a
  **Backend for Frontend (BFF)**: the browser only talks to the shop.
- The ERP API gets a separate namespace **`/shop/v1`** in its own module
  (`src/shop`), with its own controllers, guards and response contracts.
  It reuses the ERP business services, never the admin controllers.
- The shop server calls only `/shop/v1`, never the admin endpoints. There
  is no generic proxy in the shop.
- **Authorization happens in the ERP** (shop API), close to the data, not
  only in the shop. The shop adds its own checks (session, CSRF), but a bug
  in the shop alone must not expose another customer's data.
- No microservices, no new infrastructure: same database, same ERP process,
  one more Next.js process.

## Current state (Sprint 11)

- `apps/shop`: shop frame, start page, `GET /api/health`.
- ERP: `ShopModule` with `GET /shop/v1/health` (technical status only),
  protected by the service key (ADR 0002).

## Future

Customer endpoints under `/shop/v1` (units, catalog, prices, cart,
simulation, orders), each with a user session and unit authorization
(ADR 0003, 0004).

## Rejected alternatives

- **BFF only, on the admin endpoints:** the shop server would need full ERP
  access, and authorization would live outside the source of truth.
- **Browser calls the ERP directly:** exposes the ERP to the network and
  requires CORS and credentials in the browser.
- **Separate shop service or database:** more operations, duplicated rules.
