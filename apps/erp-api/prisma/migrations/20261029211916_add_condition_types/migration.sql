-- Condition types (comparable to SAP KSCHL) and the condition type of every
-- price condition record. Additive: no row is deleted and no existing value
-- (amount, currency, validity, status) is changed.
--
-- Prisma generated the new column as NOT NULL right away, which fails for a
-- table with rows. The order was changed by hand: create the types, add the
-- column as nullable, backfill it, then make it NOT NULL.
--
-- Prisma does not run a migration in one transaction: a failing statement
-- would leave the earlier ones applied (tested). BEGIN and COMMIT make the
-- whole migration all-or-nothing, so a failure leaves nothing changed.
BEGIN;

-- CreateEnum
CREATE TYPE "condition_class" AS ENUM ('PRICE', 'DISCOUNT_SURCHARGE', 'FREIGHT', 'TAX');

-- CreateEnum
CREATE TYPE "calculation_type" AS ENUM ('QUANTITY', 'FIXED_AMOUNT', 'PERCENTAGE');

-- CreateTable
CREATE TABLE "condition_types" (
    "code" VARCHAR(4) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "condition_class" "condition_class" NOT NULL,
    "calculation_type" "calculation_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "allowed_for_condition_records" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "condition_types_pkey" PRIMARY KEY ("code")
);

-- AddCheckConstraint (written by hand; Prisma cannot express CHECK constraints)
-- Four uppercase letters or digits, as SAP condition types (e.g. ZP02)
ALTER TABLE "condition_types" ADD CONSTRAINT "condition_types_code_check" CHECK ("code" ~ '^[A-Z0-9]{4}$');

-- AddCheckConstraint (written by hand)
ALTER TABLE "condition_types" ADD CONSTRAINT "condition_types_name_check" CHECK (btrim("name") <> '');

-- InsertConfiguration (written by hand)
-- The initial condition types. This is configuration, not test data, so it
-- belongs to the migration and not to the seed. Only PRICE with QUANTITY can
-- be calculated yet; the others are listed so the setup is visible.
-- ZP01 is the list price; for now it comes from materials.price, so it is
-- not allowed for condition records. ZD01, ZF01 and ZT01 are not allowed
-- yet either; this configuration can be changed later.
INSERT INTO "condition_types" ("code", "name", "condition_class", "calculation_type", "is_active", "allowed_for_condition_records", "sort_order", "updated_at") VALUES
    ('ZP01', 'List Price',         'PRICE',              'QUANTITY',     true, false, 10, CURRENT_TIMESTAMP),
    ('ZP02', 'Customer Net Price', 'PRICE',              'QUANTITY',     true, true,  20, CURRENT_TIMESTAMP),
    ('ZP03', 'Special Price',      'PRICE',              'QUANTITY',     true, true,  30, CURRENT_TIMESTAMP),
    ('ZD01', 'Customer Discount',  'DISCOUNT_SURCHARGE', 'PERCENTAGE',   true, false, 40, CURRENT_TIMESTAMP),
    ('ZF01', 'Freight',            'FREIGHT',            'FIXED_AMOUNT', true, false, 50, CURRENT_TIMESTAMP),
    ('ZT01', 'Output Tax',         'TAX',                'PERCENTAGE',   true, false, 60, CURRENT_TIMESTAMP);

-- AlterTable (by hand: nullable first, so existing rows can be backfilled)
ALTER TABLE "price_conditions" ADD COLUMN "condition_type_code" VARCHAR(4);

-- Backfill (written by hand)
-- All existing records are negotiated customer net prices. Only the new
-- column is set; updated_at stays as it was, because the price itself did
-- not change.
UPDATE "price_conditions" SET "condition_type_code" = 'ZP02' WHERE "condition_type_code" IS NULL;

-- AlterTable (by hand)
ALTER TABLE "price_conditions" ALTER COLUMN "condition_type_code" SET NOT NULL;

-- CreateIndex
CREATE INDEX "price_conditions_condition_type_code_idx" ON "price_conditions"("condition_type_code");

-- AddForeignKey
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_condition_type_code_fkey" FOREIGN KEY ("condition_type_code") REFERENCES "condition_types"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
