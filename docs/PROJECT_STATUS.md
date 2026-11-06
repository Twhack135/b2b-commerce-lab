# Project status (paused 2026-11-06)

The project is on hold after Sprint 13A. Everything below is on
`origin/master`. Nothing of Sprint 13B exists.

## Architecture

| Part              | Technology                      | Role                                                                                         |
| ----------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/erp-api`    | NestJS, Prisma 7, PostgreSQL 18 | The ERP: master data, pricing, sales orders, shop users; admin API and shop API (`/shop/v1`) |
| `apps/backoffice` | Next.js 16                      | Internal administration on the admin API                                                     |
| `apps/shop`       | Next.js 16 (BFF)                | Customer shop; talks only to `/shop/v1` with a service key, never to the admin API           |

Decisions are in `docs/adr/` (0001–0008); the decided but unbuilt direction
is in `docs/roadmap.md`. The ERP decides prices, partners and
authorizations; the shop only sends wishes.

## Implemented

- Master data: materials, customers, B2B units with ship-to addresses,
  sales organizations, channels, divisions, sales areas, currencies (EUR,
  PLN, JPY).
- Pricing: condition types ZP01/ZP02/ZP03 with scopes, price conditions,
  released price determination (`POST /pricing/price`, B2B unit → Sold-to →
  sales area).
- Sales orders: simulation and creation in the Backoffice, immutable after
  saving (database triggers).
- Shop users (local, administrator-managed): activation links, sign-in with
  sessions, VIEW/ORDER per unit, administrator-issued password reset links
  (4 h). No self-registration, no forgot-password.
- **Sprint 13A (completed):** pricing procedures ZDE001/ZPL001/ZJP001 with
  the access sequence ZBP1, document pricing `POST /pricing/calculate` next
  to the released pricing, `GET /pricing-procedures` and a read-only viewer
  in the Backoffice (ADR 0008).

## Acceptance and tests

- Sprint 13A manual acceptance (`docs/testing/sprint-13a-manual-acceptance.md`):
  P1–P4 **passed**; P5–P8 **skipped by the user** (covered only by
  automated tests, not passed manually).
- Sprint 12C manual acceptance (`docs/testing/sprint-12c-manual-acceptance.md`):
  **A5** (password reset ends all sessions) not explicitly confirmed, **A6**
  (replaying a used reset link) not executed manually.
- Automated, all passed at the end of 13A: ERP 863 unit, 574 integration,
  2 E2E; Backoffice 626; Shop 24; browser runner safety 33; browser
  regression **273/273** (run twice).

## Development database `b2b_erp`

At 10 migrations; container `b2b-commerce-lab-postgres-1` stopped and
untouched since 2026-11-02. **Two migrations are pending:**

1. `20261105090000_add_shop_password_resets`
2. `20261105120000_add_pricing_procedures`

Both are additive and rehearsed on disposable restores (13/13 and 15/15
checks). Apply them only with
[`docs/runbooks/sprint-12c-13a-migrations.md`](runbooks/sprint-12c-13a-migrations.md):
preflight, verified backup, `migrate deploy`, post-checks, recovery. Until
then, password reset links and the pricing procedure endpoints fail on
`b2b_erp`; everything else works.

## Known risk for Sprint 13B

When the exclusion constraints on price conditions include the condition
type (needed for discounts), ZP02 and ZP03 can be valid on the same level at
the same time. The released `determinePrice` then refuses the data, while
ZBP1 takes ZP03. Before that change either the released endpoints switch to
ZBP1 or the constraint keeps prices exclusive per level. This needs its own
decision and approval (ADR 0008, roadmap R5).

## Resuming safely

1. `git pull`, `npm ci`, read this file, `docs/local-setup.md` and ADR 0008.
2. Run the tests only against disposable databases (the test and browser
   runners create their own); never `prisma migrate reset`, `db push` or
   `migrate dev` on `b2b_erp`.
3. With approval, apply the two pending migrations with the runbook (start
   the container, backup and verified restore, deploy, checks).
4. Optionally finish the open manual acceptance: 13A P5–P8, 12C A5/A6.
5. Plan Sprint 13B (discounts and surcharges, steps 200–299) starting with
   the ZP02/ZP03 decision above; plan → approval → implementation.
