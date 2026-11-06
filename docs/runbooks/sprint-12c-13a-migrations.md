# Runbook: the pending migrations 11 and 12 on `b2b_erp`

Brings the development database `b2b_erp` from 10 to 12 migrations:

| No. | Migration                                 | Sprint | Creates                                                                   |
| --- | ----------------------------------------- | ------ | ------------------------------------------------------------------------- |
| 11  | `20261105090000_add_shop_password_resets` | 12C    | empty table `shop_password_resets`                                        |
| 12  | `20261105120000_add_pricing_procedures`   | 13A    | 5 configuration tables with the pricing procedures ZDE001, ZPL001, ZJP001 |

**Run it only after explicit approval.** Nothing here is automated. Every
step that changes something (starting the container, the backup, the
migration, any recovery) is listed with its approval point. This runbook
replaces `shop-password-resets-migration.md` for the joint deployment.

## 0. What changes, and what does not

- Both migrations are **additive**: they only create new objects (one enum,
  six tables, indexes, foreign keys, CHECK constraints) and insert the
  pricing configuration (2 access sequences, 6 accesses, 3 procedures,
  9 steps, 3 determinations). No existing table, row, sequence, trigger or
  constraint is changed; no existing data is read or written.
- Each runs in **one transaction** (`BEGIN … COMMIT` in the file).
- **Order:** `prisma migrate deploy` applies pending migrations sorted by
  name, so 11 runs before 12, each in its own transaction. They do not
  depend on each other. If 12 fails, 11 stays applied (section 7).
- Nothing reads the new tables yet except the new endpoints
  (`/shop-users/:id/password-reset-link`, `/shop/v1/auth/password-reset`,
  `/pricing-procedures`, `/pricing/calculate`); the released pricing, the
  order simulation and the order creation are unchanged.
- Evidence on disposable databases with a restore of the verified backup of
  `b2b_erp`: migration 11 rehearsal 13/13, migrations 11 and 12 together
  15/15 (business data and sequence unchanged, no drift, atomic, fresh
  database from scratch).

## 1. Preconditions

1. Approval for this runbook (and, separately, for starting the container).
2. The repository is at the commit to deploy (at least `fd69746`), clean
   apart from local test files, and `npm run build` in `apps/erp-api` works.
3. No ERP API, Backoffice or shop runs against `b2b_erp` (ports 3000, 3001,
   3002 free). Disposable acceptance environments (ports 3310–3313, 55470)
   are not affected.

## 2. Start the database (approval)

```bash
docker compose up -d postgres
docker compose ps        # postgres: healthy
```

## 3. Preflight checks (read only)

Run SQL with:

```bash
docker compose exec -T postgres sh -c 'psql -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < query.sql
```

1. No other sessions:
   `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();` → `0`
2. Migration status: `cd apps/erp-api && npx prisma migrate status` lists
   **exactly** these two as not yet applied:
   `20261105090000_add_shop_password_resets`, `20261105120000_add_pricing_procedures`.
   Anything else: stop.
3. Fingerprint of the 18 business tables and the order number sequence
   (`fingerprint.sql`):

   ```sql
   SELECT t || ':' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', t), false, true, '')))[1]::text
            || ':' || (xpath('/row/h/text()', query_to_xml(format('SELECT md5(coalesce(string_agg(x::text, %L ORDER BY x::text), %L)) AS h FROM %I x', ',', '', t), false, true, '')))[1]::text
     FROM unnest(ARRAY['b2b_unit_ship_tos','b2b_units','condition_type_scopes','condition_types','currencies',
                       'customer_account_members','customer_sales_areas','customers','distribution_channels',
                       'divisions','materials','price_conditions','sales_areas','sales_order_item_conditions',
                       'sales_order_items','sales_order_partners','sales_orders','sales_organizations']) AS t
    ORDER BY t;
   SELECT 'sequence:' || last_value || ':' || is_called FROM sales_order_number_seq;
   ```

   Expected (recorded on 2026-11-02 after migration 10; the container has
   not run since):

   ```
   b2b_unit_ship_tos:5:7367b6e9879ab05d55113cb2d57126c4
   b2b_units:2:dd5f476f87c51590ae36d7d7931a4be4
   condition_type_scopes:5:acaf893d315551f307de1191ac1109c2
   condition_types:6:44749af2d955ae38b4d64b544b8cdb84
   currencies:3:ff79ba0e8c03e94be2efa7bf72141c0e
   customer_account_members:3:c99c83938095b25d73aaed7ba34d3d62
   customer_sales_areas:3:df64b270125392a9da80de079329d6c1
   customers:3:8ec249f11a0828582a5908c0aafb4cd6
   distribution_channels:1:4f2ab03dc11788ddd914a87e93ebdf7d
   divisions:1:2a01b6a3d0e2ba9ff00045ff49f5e53a
   materials:3:cc6fc46abd3ed4fd9d076c895f389672
   price_conditions:7:e65d1a8244ee4e4c4e998e34e30dd757
   sales_areas:3:0052df5153f08ece75f3b3b02f7d0e71
   sales_order_item_conditions:0:d41d8cd98f00b204e9800998ecf8427e
   sales_order_items:0:d41d8cd98f00b204e9800998ecf8427e
   sales_order_partners:0:d41d8cd98f00b204e9800998ecf8427e
   sales_orders:0:d41d8cd98f00b204e9800998ecf8427e
   sales_organizations:3:7c16bdfd65f2560142978897ede1e476
   sequence:1000000001:false
   ```

   Any difference: stop and find out why before going on.

4. Business checks: price condition #4 is ZP03, MAT-001, Sold-to CUST-1000,
   4400.00 EUR, active; 0 sales orders; the shop tables `shop_users`,
   `shop_user_units`, `shop_user_credentials`, `shop_activation_tokens`,
   `shop_sessions` are empty; 6 user triggers
   (`SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;`).

## 4. Backup and its verification

1. Back up outside the repository (approval as part of this runbook):

   ```bash
   ts=$(date +%Y%m%d-%H%M%S)
   f=/c/Users/kevin/b2b-commerce-lab-backups/b2b_erp-pre-12c-13a-$ts.dump
   docker compose exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$f"
   (cd "$(dirname "$f")" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256" && sha256sum -c "$(basename "$f").sha256")
   docker compose exec -T postgres pg_restore --list < "$f" | grep -c "TABLE DATA"    # 24
   ```

2. Restore into a **disposable** container and compare (never into `b2b_erp`):

   ```bash
   pw=$(node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")
   MSYS_NO_PATHCONV=1 docker run -d --rm --name b2b-restore-check -e POSTGRES_USER=erp_user -e POSTGRES_PASSWORD="$pw" \
     -e POSTGRES_DB=b2b_erp_restore_check --tmpfs /var/lib/postgresql -p 127.0.0.1:55480:5432 postgres:18
   # wait until pg_isready answers, then:
   docker exec -i b2b-restore-check pg_restore --no-owner --no-privileges --exit-on-error -U erp_user -d b2b_erp_restore_check < "$f"
   docker exec -i b2b-restore-check psql -At -U erp_user -d b2b_erp_restore_check < fingerprint.sql   # = step 3.3
   docker stop b2b-restore-check
   unset pw
   ```

   The restored fingerprint must equal step 3.3, with 10 migrations. If the
   backup cannot be verified: **stop, do not migrate.**

## 5. The migration (approval)

```bash
cd apps/erp-api
npx prisma migrate deploy
```

Expected output: "Applying migration `20261105090000_add_shop_password_resets`",
"Applying migration `20261105120000_add_pricing_procedures`", "All migrations
have been successfully applied." Then `npx prisma generate` and `npm run build`.

## 6. Post-migration checks (read only)

1. `npx prisma migrate status`: "Database schema is up to date!";
   `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) || '/' || count(*) FILTER (WHERE finished_at IS NULL) FROM _prisma_migrations;` → `12/0`.
2. `fingerprint.sql` gives exactly the values of step 3.3.
3. New objects:
   - `SELECT count(*) FROM shop_password_resets;` → `0`
   - `SELECT (SELECT count(*) FROM access_sequences)||'/'||(SELECT count(*) FROM access_sequence_accesses)||'/'||(SELECT count(*) FROM pricing_procedures)||'/'||(SELECT count(*) FROM pricing_procedure_steps)||'/'||(SELECT count(*) FROM pricing_procedure_determinations);` → `2/6/3/9/3`
   - every active sales area has a procedure:
     `SELECT count(*) FROM sales_areas a WHERE a.is_active AND NOT EXISTS (SELECT 1 FROM pricing_procedure_determinations d WHERE (d.sales_organization, d.distribution_channel, d.division) = (a.sales_organization, a.distribution_channel, a.division));` → `0`
   - still 6 user triggers; 30 tables in `public`.
4. No drift: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` → "This is an empty migration."
5. Smoke test with the built ERP API (GET only, nothing created):
   `/materials`, `/customers`, `/price-conditions`, `/sales-orders` answer as
   before; `/pricing-procedures` lists ZDE001, ZJP001, ZPL001. No shop users,
   links or sessions are created.
6. Leave the apps in the state they were in before (stopped).

## 7. Recovery

Principles: decide on facts, prefer a forward correction, and never run a
restore, a drop or `prisma migrate resolve` without explicit approval.

| Situation                                  | What it means                                                               | Action (each with approval)                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11 fails                                   | Its transaction left nothing; 12 did not run; Prisma marks 11 as failed     | Check that `shop_password_resets` does not exist; `npx prisma migrate resolve --rolled-back 20261105090000_add_shop_password_resets`; fix the cause; run this runbook again. No restore.                                                                                                                                                                                                    |
| 11 applied, 12 fails                       | 11 stays (independent, additive); nothing of 12 exists; 12 is marked failed | Check that `pricing_procedures` and `access_sequences` do not exist; `npx prisma migrate resolve --rolled-back 20261105120000_add_pricing_procedures`; fix; `npx prisma migrate deploy` again (only 12 is pending).                                                                                                                                                                         |
| Both applied, a problem in the new objects | New tables are empty (11) or configuration (12)                             | Forward correction with a new, rehearsed migration. Removing them is possible because no data depends on them: drop `pricing_procedure_determinations`, `pricing_procedure_steps`, `pricing_procedures`, `access_sequence_accesses`, `access_sequences`, type `pricing_step_kind`, then `shop_password_resets` (only while it is empty), and delete the two rows from `_prisma_migrations`. |
| Business data differs after the migration  | Not caused by these migrations (they write no existing table)               | Stop the ERP API, compare the fingerprints, find the cause. A restore from the backup of step 4 replaces **all** later changes; export anything created since first.                                                                                                                                                                                                                        |
