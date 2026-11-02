-- Shop users and their B2B unit authorizations (Sprint 12A).
--
-- A shop user is a person of a customer account (SAP: contact person of the
-- customer). The user references the account's owner row in
-- customer_account_members; an assignment references both the user and the
-- unit with the same account_customer_number, so the database never accepts
-- a unit of another customer account.
--
-- Only new objects are created (two types, two tables, indexes, foreign keys
-- and CHECK constraints); existing tables are referenced, never changed.
-- Prisma does not run a migration in a transaction, so this one does it
-- explicitly: if any statement fails, nothing is changed.

BEGIN;

-- CreateEnum
CREATE TYPE "shop_user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "shop_user_role" AS ENUM ('BUYER');

-- CreateTable
CREATE TABLE "shop_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_customer_number" VARCHAR(20) NOT NULL,
    "account_owner_ref" VARCHAR(20) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "status" "shop_user_status" NOT NULL DEFAULT 'ACTIVE',
    "role" "shop_user_role" NOT NULL DEFAULT 'BUYER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shop_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_user_units" (
    "user_id" UUID NOT NULL,
    "unit_id" VARCHAR(20) NOT NULL,
    "account_customer_number" VARCHAR(20) NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_user_units_pkey" PRIMARY KEY ("user_id","unit_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_users_email_key" ON "shop_users"("email");

-- CreateIndex
CREATE INDEX "shop_users_account_idx" ON "shop_users"("account_customer_number");

-- CreateIndex
CREATE UNIQUE INDEX "shop_users_id_account_key" ON "shop_users"("id", "account_customer_number");

-- CreateIndex
CREATE INDEX "shop_user_units_unit_idx" ON "shop_user_units"("unit_id", "account_customer_number");

-- AddForeignKey
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_account_fkey" FOREIGN KEY ("account_customer_number", "account_owner_ref") REFERENCES "customer_account_members"("customer_number", "account_customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shop_user_units" ADD CONSTRAINT "shop_user_units_user_fkey" FOREIGN KEY ("user_id", "account_customer_number") REFERENCES "shop_users"("id", "account_customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shop_user_units" ADD CONSTRAINT "shop_user_units_unit_fkey" FOREIGN KEY ("unit_id", "account_customer_number") REFERENCES "b2b_units"("unit_id", "account_customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- AddCheckConstraint (written by hand; Prisma cannot express CHECK constraints)
-- account_owner_ref is a copy of account_customer_number: the account foreign
-- key then points to the owner row, i.e. to an account, never to a member
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_account_owner_ref_check" CHECK ("account_owner_ref" = "account_customer_number");

-- The e-mail address is stored normalized (lower case, no spaces): printable
-- ASCII, exactly one @ and a dot in the domain. With the unique index this
-- makes addresses unique regardless of case.
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_email_check" CHECK ("email" = lower("email") AND "email" ~ '^[!-?A-~]+@[!-?A-~]+\.[!-?A-~]+$');

-- A display name is not blank, has no surrounding spaces and no control characters
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_display_name_check" CHECK ("display_name" = btrim("display_name") AND "display_name" <> '' AND "display_name" !~ '[[:cntrl:]]');

COMMIT;
