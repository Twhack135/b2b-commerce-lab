# Roadmap: decided direction, not implemented

These are architecture decisions for later sprints (recorded after the
Sprint 12C review). **Nothing here exists yet.** Each item gets its own
plan, approval, ADR and, where needed, an additive migration rehearsed on
disposable databases before it is implemented.

## Ground rules for all items

- **Backward compatibility of sales orders.** Stored sales orders stay
  exactly as they are (immutable, database triggers since 10C). Existing
  admin API fields and answers do not change; new fields are additive.
  Order creation through the Backoffice keeps its current results; the
  existing regression scenarios (e.g. Stuttgart 10695.00 EUR, Osaka JPY
  without decimals) must produce identical documents.
- **Additive migrations only**, applied to `b2b_erp` only with a verified
  backup and explicit approval (runbook).
- **The ERP decides.** The shop never sends prices, partners, sales areas
  or authorizations; it sends wishes (unit, material, quantity) that the
  ERP checks on every request.

## R1 – Order authorization in future order endpoints

Applies to every shop endpoint that creates or changes something for a
unit (cart changes, simulation for ordering, checkout).

- Requires **ORDER** for the unit, checked **independently by the
  endpoint itself**: active user, active account (owner customer), the
  assignment, and an **active unit**. The `canOrder` flag of
  `/shop/v1/account`, the selected unit and the shop's cookie are display
  information only and never authorize anything.
- The check runs **inside the order transaction** with row locks on the
  assignment, the unit, the user and the owner customer (`FOR SHARE`), so a
  concurrent deactivation or unassignment either waits or wins; never both.
  `ShopUsersService.isAuthorizedForUnit` (today without a transaction) gets
  a transactional variant for this.
- Inactive units remain **VIEW** only: order history and documents stay
  visible, new orders are refused (403/404 without detail, ADR 0004).
- Authorization matrix tests: user A never reaches units, carts or orders of
  user B or of another account (lists, details, simulation, creation).

## R2 – Persistent default unit and switching in the shop header

- A **default unit per shop user**, chosen by the user (or set in the
  Backoffice), stored in PostgreSQL, e.g. `is_default` on
  `shop_user_units` with a partial unique index (one default per user). It
  is used only while the assignment exists and the user may view the unit;
  otherwise the current rule applies (only unit, else choose).
- **Unit switcher in the shop header** (all pages): a same-origin POST, as
  today; the ERP confirms the unit before it is used.
- The current selection moves from the preference cookie to the
  **server-side session** (e.g. `shop_sessions.selected_unit_id`, validated
  on every request), so selection, sign-out and revocation share one source
  of truth. Still no second authentication mechanism.

## R3 – Shopping carts per shop user and B2B unit

- Carts are **persisted in PostgreSQL**, one open cart per shop user **and**
  unit (`shop_carts` with a composite foreign key that keeps the unit in
  the user's account, unique open cart per user/unit; `shop_cart_items`
  with material and quantity).
- A cart stores wishes, **never binding prices**: prices are determined by
  the ERP whenever the cart is shown or simulated, and again at checkout
  (with the price confirmation of 10C).
- Viewing a cart needs VIEW, changing it and checking out need ORDER (R1).
  A withdrawn unit or a disabled user makes the cart inaccessible at once;
  it is kept and becomes usable again only with a renewed authorization.
- Switching units switches carts; carts are never merged across units or
  accounts. Old carts are cleaned up after a retention period.

## R4 – Pricing procedures (SAP-inspired) for DE, PL and JP

**Status:** foundation implemented in Sprint 13A (docs/adr/0008): access
sequences, procedures ZDE001/ZPL001/ZJP001 with base price, statistical list
price and net value, determination per sales area, `POST /pricing/calculate`
next to the released pricing. Discounts and surcharges follow in 13B, taxes,
freight and totals in 13C, the orders in Sprint 14.

- A **pricing procedure** per sales area (procedure determination by
  sales area, customer pricing procedure and document type), versioned and
  configured, not coded: ordered steps with condition types, subtotal
  lines, "from/to step" references for percentages, requirements,
  statistical and manual flags.
- Initial procedures for Germany (EUR), Poland (PLN) and Japan (JPY,
  0 decimals), rounding per currency and step.
- Each order line records the procedure and its version; stored orders
  keep their own condition lines (snapshot) and are never recalculated.

## R5 – Exclusive base price from the existing precedence

- Exactly **one base price** per item: access sequence ZBP1 (approved for
  Sprint 13A): ZP03 B2B unit, ZP02 B2B unit, ZP03 Sold-to, ZP02 Sold-to,
  ZP01 list price; the first valid record wins. The level order of the
  released price determination (B2B unit, Sold-to, sales area) is kept;
  within a level ZP03 comes before ZP02. Base prices never stack.
- **Status:** implemented in Sprint 13A (docs/adr/0008); same results as the
  released determination for all current data (comparison tests).

## R6 – Configurable discounts, surcharges, taxes, shipping and subtotals

- **Discounts and surcharges** as condition classes: percentage, amount per
  unit, absolute, quantity scales; on item or header level.
- **Stacking rules**: exclusion groups (best of group or first of group),
  explicit exclusions, maximum discount; order of application defined by
  the procedure steps.
- **Taxes** as tax condition types with tax classification of customer and
  material: Germany 19 %/7 % VAT, Poland 23 %/8 %/5 % VAT, Japan 10 %/8 %
  consumption tax. Tax rates are master data with validity dates.
- **Shipping/freight** conditions (e.g. by shipping method, weight or
  value, free above a threshold).
- **Subtotals**: gross, discounts, net value, freight, tax, total; shown in
  the Backoffice and, as an allow-listed customer view, in the shop
  (ADR 0005: no condition IDs or internal steps for customers).
- Every change of the configuration is versioned and auditable; a pricing
  analysis explains each step (like the existing price analysis).
