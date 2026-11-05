# ADR 0008: Pricing procedures and access sequences

Status: accepted; Sprint 13A implemented (foundation). 13B (discounts and
surcharges), 13C (taxes, freight, totals) and Sprint 14 (orders, shop) build
on it.

## Context

Until Sprint 12 the ERP determined one price per item with a fixed access
sequence by level: B2B unit, then Sold-to, then the list price of the sales
area (`determinePrice`, used by `POST /pricing/price`, the order simulation
and order creation). A realistic B2B price consists of more: a base price,
discounts and surcharges, freight, taxes and subtotals, configured per
market. SAP SD solves this with condition types, access sequences and
pricing procedures; we adopt the concepts, not their full complexity.

## Decision

### Configuration (migration `20261105120000_add_pricing_procedures`)

| Table | Purpose |
| ----- | ------- |
| `access_sequences`, `access_sequence_accesses` | Ordered accesses (condition type + level); the first access with a valid record wins. An access may only name combinations allowed for condition records (`condition_type_scopes`). `material_specific` prepares material-independent discounts (13B). |
| `pricing_procedures` | One procedure per market: `ZDE001` (1000/10/00, EUR), `ZPL001` (2000/10/00, PLN), `ZJP001` (3000/10/00, JPY). `revision` names the configuration a result was calculated with. |
| `pricing_procedure_steps` | Steps in the order of their numbers: `CONDITION` (reads records through an access sequence) or `SUBTOTAL` (sum of earlier steps). Flags: statistical, mandatory, customer visible; calculation base from/to step. CHECK constraints keep each kind consistent. |
| `pricing_procedure_determinations` | Sales area + customer procedure → procedure. `'*'` applies to every customer; customer-specific keys (e.g. tax-exempt customers) can be added later without a table change. |

The configuration is **versioned through migrations** and read-only in the
admin API and the Backoffice (Sprint 13).

Revision 1, identical for the three markets:

| Step | Kind | Label | Access sequence | Flags |
| ---- | ---- | ----- | --------------- | ----- |
| 5 | CONDITION | List price | ZLP1 (ZP01 sales area) | statistical |
| 10 | CONDITION | Base price | ZBP1 | mandatory, customer visible |
| 100 | SUBTOTAL | Net value (`NET_VALUE`) | steps 10–99 | customer visible |

**ZBP1 Base price:** 10 ZP03/B2B unit, 20 ZP02/B2B unit, 30 ZP03/Sold-to,
40 ZP02/Sold-to, 50 ZP01/sales area: B2B unit before Sold-to before sales
area, and within a level the special price ZP03 before the customer net
price ZP02.

Reserved step ranges: 200–299 discounts and surcharges with exclusion
groups (13B), 800 freight on the header (13C), 900 tax (13C), 950 gross
(13C).

### Calculation (`apps/erp-api/src/pricing/engine`)

- **One access sequence evaluation** (`access-sequence.ts`) for everything:
  validity (inclusive dates, active records), one sales area, its currency,
  its decimal places, and the refusal of ambiguous data. The released
  `determinePrice` uses it with one access per level for any price type; the
  procedures use it with their typed access sequences. There is no second
  implementation of the pricing rules.
- **Procedure calculation** (`procedure.ts`), a pure function: condition
  value = rate × quantity, rounded to the document currency; subtotals are
  sums of the rounded, non-statistical lines; a missing mandatory record
  makes the item `INCOMPLETE`. Every line explains the record used and the
  result of each access (`APPLIED`, `FOUND_NOT_USED`, `NOT_FOUND`).
  Configurations Sprint 13A cannot calculate (other calculation types,
  material-independent accesses) are refused, never approximated.
- **No currency conversion**: records of another sales area or currency are
  a hard error, as before.

### API

- `GET /pricing-procedures`, `GET /pricing-procedures/:code` (read-only).
- `POST /pricing/calculate`: a whole document (sales area, unit, pricing
  date, up to 200 items with whole quantities) with the procedure of its
  sales area. 200 with `status: COMPLETE` or `INCOMPLETE` and structured
  messages (`MANDATORY_CONDITION_MISSING`); 422 for the same unit and sales
  area problems as `POST /pricing/price`, and when no active procedure is
  determined. It stores nothing and runs **next to** the released pricing:
  `POST /pricing/price`, `/sales-orders/simulate` and `/sales-orders` are
  unchanged.
- Admin API only (local, ADR 0006/0007). The shop gets a customer-facing
  price contract with an allow list in Sprint 14 (ADR 0005); internal
  conditions are never exposed to it.

## Compatibility and tradeoffs

- **Same results today.** The database prevents overlapping valid records of
  one level regardless of the condition type, so the level order of
  `determinePrice` and the typed order of ZBP1 select the same record for
  all existing data. Proven by comparison tests (`POST /pricing/calculate`
  against `POST /pricing/price` and the order simulation) and by regression
  fixtures against a frozen copy of the released `determinePrice`.
- **Known future decision (13B):** when the exclusion constraints include the
  condition type (needed for discounts next to prices), ZP02 and ZP03 can be
  valid on the same level at the same time. `determinePrice` then refuses
  the data (two valid records on one level), while ZBP1 takes ZP03. Before
  that change the released endpoints must either switch to ZBP1 or the
  constraint must keep prices exclusive per level; this needs its own
  approval.
- Configuration in tables instead of code: more migrations, but every
  market can change without a deployment of new rules, and results name the
  revision. Editing in the Backoffice is deliberately postponed.
- Whole quantities only in 13A; `rate × quantity` leaves room for quantity
  and price units later (e.g. price per 100 pieces).
- Stored sales orders are untouched (immutable since 10C); orders switch to
  the procedure calculation only in Sprint 14, with their own result table.
