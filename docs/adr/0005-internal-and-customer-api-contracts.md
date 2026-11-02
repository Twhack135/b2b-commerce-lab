# ADR 0005: Internal versus customer-facing API contracts

Status: accepted (Sprint 11)

## Decision

- **Admin API** (all existing routes, e.g. `/materials`, `/price-conditions`,
  `/sales-orders`): internal contracts for the Backoffice. They stay
  unchanged and are never exposed to customers or through the shop.
- **Shop API** (`/shop/v1/...`): separate, versioned contracts with their
  own response types. They contain only what a customer may see. Examples
  for later sprints:
  - prices as net price and total, without condition IDs, access sequence
    steps, other conditions or validity details;
  - partners of the customer's own unit only;
  - no request hashes, internal notes or diagnostic texts.
- Shop contracts are built from the business services, not by passing
  admin responses through. A field enters a shop contract only on purpose
  (allow list), and tests check the exact set of fields.
- Breaking changes create `/shop/v2`; `/shop/v1` stays until the shop has
  moved.

## Current state (Sprint 11)

`GET /shop/v1/health` answers `{ "status": "ok" }` only, without versions,
database or configuration details. Unknown `/shop/v1` routes answer 404.
`/shop/v1/../materials` is not resolved and also answers 404.
