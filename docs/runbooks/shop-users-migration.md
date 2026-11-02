# Runbook: migration 20261102120000_add_shop_users (Sprint 12A)

Applies the shop user tables to the development database `b2b_erp`. Run it
**only after explicit approval**. Nothing in this runbook is automated.

## What the migration does

- Creates the types `shop_user_status`, `shop_user_role` and the empty tables
  `shop_users`, `shop_user_units` with indexes, foreign keys and CHECKs.
- Changes no existing table, row, sequence or trigger; existing tables are
  only referenced (`customer_account_members` owner rows, `b2b_units`).
- Runs in **one transaction** (`BEGIN … COMMIT` in the file, because Prisma
  does not wrap migrations): if a statement fails, nothing is created.

## 1. Before the migration

1. The ERP API is stopped (it needs the new Prisma Client afterwards).
2. Back up the database to a file **outside the repository**:

   ```bash
   docker compose exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > <backup-folder>/b2b_erp-before-12a.dump
   ```

3. Verify the backup can be read (lists the contents, changes nothing):

   ```bash
   docker compose exec -T postgres pg_restore --list < <backup-folder>/b2b_erp-before-12a.dump | grep -c "TABLE DATA"
   ```

4. Record the fingerprint of all business tables (row counts and content
   hashes) and of the sales order number sequence.
5. Check the state: `cd apps/erp-api && npx prisma migrate status` must list
   exactly `20261102120000_add_shop_users` as not yet applied.

## 2. The migration

```bash
cd apps/erp-api && npx prisma migrate deploy
```

Then `npx prisma generate`, `npm run build` and `npm run start`.

## 3. Verification

- `npx prisma migrate status`: "Database schema is up to date"; 9 rows in
  `_prisma_migrations`.
- The fingerprint of all previous tables and the sequence is unchanged.
- `shop_users` and `shop_user_units` exist and are empty.
- The Backoffice works as before (materials, customers, units, prices,
  simulation, sales orders).

## 4. Recovery

Principles: decide on facts, prefer a **forward correction**, and never run a
restore, a drop or `prisma migrate resolve` without explicit approval.

| Situation | Action |
| --------- | ------ |
| `migrate deploy` fails | The transaction left nothing behind. Check that no `shop_%` objects exist; Prisma then marks the migration as failed. With approval: `npx prisma migrate resolve --rolled-back 20261102120000_add_shop_users`, fix the cause, run the runbook again. No restore needed. |
| Applied, but a problem is found while the tables are **empty** | Correct it with a new, rehearsed forward migration. Removing the empty objects is possible, but only with approval and after confirming they are empty. |
| Applied and the tables **contain shop users** | **Never drop the tables.** Correct it with a forward migration, rehearsed on a disposable copy with the same data. Shop users and assignments are master data that cannot be recreated from elsewhere. |
| Existing business data looks changed | Stop the ERP API and compare the fingerprints (the migration cannot change existing rows, so look for the real cause). A restore from the backup of step 1 replaces **all** later changes; it needs explicit approval, after exporting any data created since the backup. |

Before any forward migration: rehearse it on a disposable PostgreSQL with a
copy of the development data, exactly like this migration was rehearsed
(fingerprints before and after, Prisma drift check, ERP against the copy).
