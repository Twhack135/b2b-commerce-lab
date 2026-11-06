# Runbook: migration 20261105090000_add_shop_password_resets (Sprint 12C)

> **Superseded for the deployment:** migrations 11 and 12 are pending together;
> use `sprint-12c-13a-migrations.md`. This file describes migration 11 alone.

Adds the table for administrator-issued password reset links to the
development database `b2b_erp`. Run it **only after explicit approval**.
Nothing in this runbook is automated. Until then, `b2b_erp` keeps its 10
migrations; the Backoffice answers "Create password reset link" with an
error there, everything else works as before.

## What the migration does

- Creates the empty table `shop_password_resets` (SHA-256 hashes of reset
  tokens, 4-hour lifetime enforced by a CHECK constraint, at most one open
  link per user) with indexes and a foreign key to `shop_users`.
- Changes no existing table, row, sequence or trigger. Activation links stay
  in `shop_activation_tokens`; the two kinds can never be used for each
  other.
- Runs in **one transaction** (`BEGIN … COMMIT` in the file): if a statement
  fails, nothing is created.

## 1. Before the migration

1. Stop the ERP API, the Backoffice and the shop.
2. Back up the database to a file **outside the repository**
   (`pg_dump -Fc`, see `shop-users-migration.md`), record a SHA-256 checksum
   and verify the backup with `pg_restore --list` and a restore into a
   disposable PostgreSQL database.
3. Record the fingerprint of all tables (row counts, content hashes) and of
   the sales order number sequence.
4. `cd apps/erp-api && npx prisma migrate status` must list exactly
   `20261105090000_add_shop_password_resets` as not yet applied.

## 2. The migration

```bash
cd apps/erp-api && npx prisma migrate deploy
```

Then `npx prisma generate` and `npm run build`.

## 3. Verification

- `npx prisma migrate status`: "Database schema is up to date"; 11 rows in
  `_prisma_migrations`.
- All previous tables and the sequence have an unchanged fingerprint.
- `shop_password_resets` exists and is empty.

## 4. Recovery

As in `shop-users-migration.md`: decide on facts, prefer a forward
correction, never restore, drop or `prisma migrate resolve` without
explicit approval. While the table is empty, removing it again is possible
(with approval); reset links are short-lived and can always be issued anew.
