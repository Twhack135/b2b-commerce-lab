# Manual acceptance test: Sprint 13A

Pricing procedures (ZDE001, ZPL001, ZJP001), the base price access sequence
ZBP1, the read-only viewer in the Backoffice and the new document pricing
`POST /pricing/calculate`, which runs **next to** the released pricing.

> Run this test **only** in the disposable acceptance environment. Never
> against the development database `b2b_erp` (port 5432) or the development
> apps (ports 3000–3002).

## 1. Start

```bash
cd apps/backoffice
npm run acceptance:env
```

Wait for "The acceptance environment is ready". Backoffice:
`http://127.0.0.1:3311`, ERP API: `http://127.0.0.1:3310`. The disposable
database has all migrations, including `20261105120000_add_pricing_procedures`.

Test data (created automatically):

| Market | Unit | Prices |
| ------ | ---- | ------ |
| DE 1000/10/00, EUR | UNIT-STUTTGART, UNIT-MUENCHEN (Sold-to CUST-1000) | MAT-001: list price 4500.00 (ZP01), special price 4400.00 (ZP03, Sold-to, from 2026-10-29). MAT-002: list price 199.00, 189.50 (ZP02, Sold-to, from 2026-01-01), 179.00 (ZP02, UNIT-MUENCHEN, from 2026-06-15) |
| PL 2000/10/00, PLN | UNIT-WARSZAWA | MAT-101: 45.50 (ZP01); MAT-001: **no price** |
| JP 3000/10/00, JPY | UNIT-OSAKA | MAT-001: 700000 (ZP01) |

## 2. Sending requests to the ERP API

The calculation has no page in the Backoffice yet (Sprint 13B). Send it with
`curl.exe`, which is part of Windows:

1. Create a folder, e.g. `C:\Temp\13a`, and save each request below as a
   file there (Notepad, encoding UTF-8).
2. Open PowerShell in that folder and run:

   ```powershell
   curl.exe -s -X POST http://127.0.0.1:3310/pricing/calculate -H "Content-Type: application/json" --data-binary "@stuttgart.json"
   ```

   The answer is JSON. For better reading append
   `| ConvertFrom-Json | ConvertTo-Json -Depth 10`.

`stuttgart.json`:

```json
{ "salesOrganization": "1000", "distributionChannel": "10", "division": "00",
  "unitId": "UNIT-STUTTGART", "pricingDate": "2026-11-15",
  "items": [ { "materialNumber": "MAT-001", "quantity": 2 },
             { "materialNumber": "MAT-002", "quantity": 10 } ] }
```

## 3. Test cases

**P1 – Viewer in the Backoffice**
1. Open `http://127.0.0.1:3311/pricing` and scroll to "Pricing Procedures".
2. Expected: three buttons ZDE001 (1000/10/00), ZJP001 (3000/10/00) and
   ZPL001 (2000/10/00). ZDE001 shows revision 1 and the steps 5 "List price"
   (Statistical), 10 "Base price" (Mandatory, Customer visible) and 100 "Net
   value" (Sum of steps 10–99).
3. Open "Accesses" at step 10. Expected order: 10 ZP03 B2B Unit, 20 ZP02 B2B
   Unit, 30 ZP03 Sold-to, 40 ZP02 Sold-to, 50 ZP01 Sales area.
4. Click ZJP001 and ZPL001: the same steps. There is nothing to edit.
5. At 390 px width (F12, device toolbar): no sideways scrolling.

**P2 – Stuttgart order: same result as the order simulation**
1. Send `stuttgart.json`.
2. Expected: `"status": "COMPLETE"`, procedure `ZDE001` revision 1,
   currency EUR with 2 decimals, `"totals": { "netValue": "10695.00" }`.
   Item 10 (MAT-001): step 5 list price 4500.00 → 9000.00 (statistical),
   step 10 ZP03 Sold-to 4400.00 → 8800.00, step 100 net value 8800.00. Item
   20 (MAT-002): ZP02 Sold-to 189.50 → 1895.00.
3. In the Backoffice, Sales Orders → New → simulate the same order (unit
   UNIT-STUTTGART, date 2026-11-15, 2 × MAT-001, 10 × MAT-002). Expected:
   the same total 10695.00 EUR.

**P3 – Explanation of the base price**
1. In the answer of P2, item 10, step 10, look at `accesses`.
2. Expected: 10 and 20 `NOT_FOUND`, 30 `APPLIED` (the special price),
   40 `NOT_FOUND`, 50 `FOUND_NOT_USED` (the list price exists, but an earlier
   access won).

**P4 – Unit price and validity date (München)**
1. Copy `stuttgart.json` to `muenchen.json`, set `"unitId": "UNIT-MUENCHEN"`
   and only the item `MAT-002` with quantity 10.
2. Expected for 2026-11-15: step 10 ZP02 **B2B_UNIT** 179.00 → 1790.00.
3. Change `"pricingDate"` to `"2026-06-14"`. Expected: ZP02 **SOLD_TO**
   189.50 → 1895.00 (the unit price is valid from 2026-06-15 only).

**P5 – Missing price in Poland: INCOMPLETE, no conversion**
`poland.json`:

```json
{ "salesOrganization": "2000", "distributionChannel": "10", "division": "00",
  "unitId": "UNIT-WARSZAWA", "pricingDate": "2026-11-15",
  "items": [ { "materialNumber": "MAT-101", "quantity": 4 },
             { "materialNumber": "MAT-001", "quantity": 1 } ] }
```

Expected: HTTP 200, `"status": "INCOMPLETE"`, procedure `ZPL001`, item 10
PRICED with 182.00 PLN, item 20 INCOMPLETE with `netValue: null`, totals
`null`, and a message `MANDATORY_CONDITION_MISSING` for item 20, step 10. No
EUR price is converted.

**P6 – Japan: JPY without decimals**
Request like P5 with `"salesOrganization": "3000"`, `"unitId": "UNIT-OSAKA"`,
one item MAT-001 with quantity 3. Expected: procedure `ZJP001`, currency JPY
with 0 decimals, rate `"700000"`, net value `"2100000"` (no decimal point).

**P7 – Refusals like the released price determination**
1. Send `stuttgart.json` with `"salesOrganization": "2000"` (the unit is in
   Germany). Expected: HTTP 422 with the message that the unit does not
   belong to the sales area, word for word as `POST /pricing/price` gives:

   ```powershell
   curl.exe -s -X POST http://127.0.0.1:3310/pricing/price -H "Content-Type: application/json" --data-binary "@price-check.json"
   ```

   with `price-check.json` = `{ "salesOrganization": "2000", "distributionChannel": "10", "division": "00", "unitId": "UNIT-STUTTGART", "materialNumber": "MAT-001", "pricingDate": "2026-11-15" }`.
2. Send `stuttgart.json` with `"quantity": 0` for one item. Expected: HTTP 400.

**P8 – Released pricing unchanged**
1. Backoffice → Pricing → "Check price": UNIT-STUTTGART, MAT-001, 2026-11-15.
   Expected: 4400.00 EUR from ZP03 (as before Sprint 13A), with the analysis
   B2B unit → Sold-to → sales area.
2. Backoffice → Sales Orders: the list is unchanged; `POST /pricing/calculate`
   created no order.

## 4. Pass/Fail checklist

| ID | Test case | Pass | Fail | Note |
| -- | --------- | :--: | :--: | ---- |
| P1 | Viewer: three procedures, steps, flags, accesses, read-only, mobile | ☐ | ☐ | |
| P2 | Stuttgart: 10695.00 EUR, same as the simulation | ☐ | ☐ | |
| P3 | Explanation of the accesses | ☐ | ☐ | |
| P4 | Unit price and validity date | ☐ | ☐ | |
| P5 | Poland: INCOMPLETE with message, no conversion | ☐ | ☐ | |
| P6 | Japan: JPY without decimals | ☐ | ☐ | |
| P7 | Refusals like `POST /pricing/price` | ☐ | ☐ | |
| P8 | Released price check and orders unchanged | ☐ | ☐ | |

## 5. Cleanup

Press **Ctrl+C** in the terminal of the acceptance environment; it removes
the database, the apps and the logs. Delete the folder `C:\Temp\13a` if you
created it. Check that `docker ps -a` lists no container starting with
`b2b-browser-test-` (the development container `b2b-commerce-lab-postgres-1`
stays untouched).

## 6. Results of the manual acceptance (2026-11-06)

Executed in the disposable acceptance environment, against the local
commits up to `cb64320`.

| ID | Test case | Manual result |
| -- | --------- | ------------- |
| P1 | Pricing procedure viewer | **Passed** |
| P2 | Stuttgart pricing, 10695.00 EUR | **Passed** |
| P3 | ZBP1 access sequence and price explanation | **Passed** |
| P4 | München pricing and pricing-date validity | **Passed** |
| P5 | Poland: INCOMPLETE, no conversion | **Skipped by the user** – not executed manually |
| P6 | Japan: JPY without decimals | **Skipped by the user** – not executed manually |
| P7 | Refusals like `POST /pricing/price` | **Skipped by the user** – not executed manually |
| P8 | Released price check and orders unchanged | **Skipped by the user** – not executed manually |

P5–P8 are not marked as passed. Their behavior is covered by automated
tests only (not a substitute for the manual acceptance):

- ERP integration tests `apps/erp-api/test/integration/document-pricing-api.int-spec.ts`
  (Poland INCOMPLETE with message, JPY without decimals, refusals with the
  same messages as `POST /pricing/price`, nothing stored) and
  `pricing-procedures.int-spec.ts`; regression fixtures
  `apps/erp-api/src/pricing/price-determination.regression.spec.ts`
  against the released price determination.
- Browser suite "Pricing procedures (Sprint 13A)" in
  `apps/backoffice/test/browser/suites/pricing-procedures.mjs`.

Automated results at the end of Sprint 13A: ERP 863 unit, 574 integration
and 2 E2E tests; Backoffice 626; Shop 24; browser runner safety 33; full
browser regression **273/273, run twice** (with and without a new build). All
passed.

Still open from Sprint 12C (`docs/testing/sprint-12c-manual-acceptance.md`):
follow-up **A5** (password reset and the end of all sessions) is not
explicitly confirmed, and **A6** (replaying a used reset link) was not
executed manually.
