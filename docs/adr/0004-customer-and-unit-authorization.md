# ADR 0004: Customer and B2B unit authorization

Status: accepted; data model (12A), session checks (12B), administration
and unit selection (12C, docs/adr/0007)

## Business scenario

A buyer of Müller Heiztechnik GmbH orders for the units UNIT-STUTTGART
and UNIT-MUENCHEN. She sees only their prices, Ship-tos and orders, never
those of another customer. (SAP comparison: a contact person of the
customer, or a B2B customer of a B2B unit in SAP Commerce.)

## Decision

- A shop user belongs to exactly one **customer account** (the existing
  account of `customer_account_members`).
- Users are **explicitly assigned to B2B units** of their own account. The
  database enforces that a user can only be assigned units of their own
  account (composite foreign key, as for the existing Ship-tos).
- Everything else is derived from the unit and never accepted from the
  client: sales area, Sold-to, Bill-to, Payer; Ship-tos only from the unit's
  list; the pricing date is the server's date.
- **Order visibility:** a user sees the orders of the units assigned to
  them, with the user who created each order.
- Every `/shop/v1` customer request checks: valid session, active user,
  active account, the unit is assigned to the user (and active for new
  orders). Failures answer 404 for foreign objects.
- Tests: an authorization matrix where user A must never reach units or
  orders of user B (lists, details, simulation, creation).

## Current state (Sprint 12C)

Shop users, their unit assignments (12A) and sessions (12B) exist. The
Backoffice assigns units of the user's own account only (also enforced by
the database). `GET /shop/v1/account` returns the units authorized for
the session on every request and accepts the shop's remembered unit only
if it is one of them; inactive units are view only. Catalog, prices and
orders of the shop, and with them the full authorization matrix for
lists, details, simulation and creation, follow in later sprints.

## State in Sprint 11

No authorization tables, no users. The existing data model already derives
partners and sales area from the unit and checks Ship-tos against the
unit, which this design builds on.
