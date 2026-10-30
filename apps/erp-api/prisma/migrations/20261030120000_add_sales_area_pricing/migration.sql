-- Market-specific pricing (Sprint 9C-B).
--
-- List prices become ZP01 condition records per sales area instead of the
-- global materials.price. Every price condition gets a sales area, and
-- foreign keys keep each condition inside its market (Sold-to assigned to
-- the sales area, unit belonging to it, currency of the sales organization).
-- Which scopes a condition type may be used with becomes configuration.
--
-- All existing data belongs to the German sales area 1000/10/00 (EUR):
-- - the existing price conditions keep their IDs, values, validity, status
--   and condition types and are placed in 1000/10/00
-- - for every material with a price, a ZP01 record in 1000/10/00 is created
--   with that price, valid from 1900-01-01 and open-ended, so pricing on any
--   date gives the same result as before
-- - materials.price and materials.currency stay (nullable, deprecated) and
--   are no longer used for pricing
-- No prices are created for other sales areas; nothing is converted.
--
-- Prisma does not run a migration in a transaction, so this one does it
-- explicitly: if any statement fails, nothing is changed.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preconditions: stop with a clear message instead of guessing
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    german_currency CHAR(3);
BEGIN
    SELECT currency_code INTO german_currency FROM sales_organizations WHERE code = '1000';
    IF german_currency IS NULL THEN
        RAISE EXCEPTION 'Sales organization 1000 is missing; apply migration 20261029233000_add_sales_areas first';
    END IF;
    IF EXISTS (SELECT 1 FROM materials WHERE currency <> german_currency) THEN
        RAISE EXCEPTION 'Materials with a currency other than % exist; they cannot become list prices of sales area 1000/10/00', german_currency;
    END IF;
    IF EXISTS (SELECT 1 FROM price_conditions WHERE currency <> german_currency) THEN
        RAISE EXCEPTION 'Price conditions with a currency other than % exist; they cannot be placed in sales area 1000/10/00', german_currency;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- New scope SALES_AREA
-- ---------------------------------------------------------------------------

-- PostgreSQL cannot use an enum value in the transaction that adds it
-- (ALTER TYPE ... ADD VALUE), so the type is replaced. The constraints that
-- use the column are dropped first and created again further below.
ALTER TABLE "price_conditions" DROP CONSTRAINT "price_conditions_scope_key_check";
ALTER TABLE "price_conditions" DROP CONSTRAINT "price_conditions_sold_to_no_overlap";
ALTER TABLE "price_conditions" DROP CONSTRAINT "price_conditions_unit_no_overlap";

CREATE TYPE "price_condition_scope_new" AS ENUM ('B2B_UNIT', 'SOLD_TO', 'SALES_AREA');
ALTER TABLE "price_conditions" ALTER COLUMN "scope" TYPE "price_condition_scope_new" USING ("scope"::text::"price_condition_scope_new");
DROP TYPE "price_condition_scope";
ALTER TYPE "price_condition_scope_new" RENAME TO "price_condition_scope";

-- ---------------------------------------------------------------------------
-- Configuration: scopes per condition type
-- ---------------------------------------------------------------------------

CREATE TABLE "condition_type_scopes" (
    "condition_type_code" VARCHAR(4) NOT NULL,
    "scope" "price_condition_scope" NOT NULL,

    CONSTRAINT "condition_type_scopes_pkey" PRIMARY KEY ("condition_type_code","scope")
);

ALTER TABLE "condition_type_scopes" ADD CONSTRAINT "condition_type_scopes_condition_type_code_fkey" FOREIGN KEY ("condition_type_code") REFERENCES "condition_types"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ZP01 List Price per sales area; ZP02 and ZP03 per Sold-to or B2B unit
INSERT INTO "condition_type_scopes" ("condition_type_code", "scope") VALUES
    ('ZP01', 'SALES_AREA'),
    ('ZP02', 'SOLD_TO'),
    ('ZP02', 'B2B_UNIT'),
    ('ZP03', 'SOLD_TO'),
    ('ZP03', 'B2B_UNIT');

-- ZP01 is a real, maintainable condition type from now on
UPDATE "condition_types" SET "allowed_for_condition_records" = true, "updated_at" = CURRENT_TIMESTAMP WHERE "code" = 'ZP01';

-- ---------------------------------------------------------------------------
-- Deprecated material prices
-- ---------------------------------------------------------------------------

ALTER TABLE "materials" ALTER COLUMN "price" DROP NOT NULL,
ALTER COLUMN "currency" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Sales area of price conditions
-- ---------------------------------------------------------------------------

-- Added without NOT NULL, filled, then made mandatory. There is deliberately
-- no default: every new condition must name its sales area explicitly.
ALTER TABLE "price_conditions" ADD COLUMN "sales_organization" CHAR(4),
ADD COLUMN "distribution_channel" CHAR(2),
ADD COLUMN "division" CHAR(2);

-- updated_at is left unchanged: the business content of the records does not change
UPDATE "price_conditions" SET "sales_organization" = '1000', "distribution_channel" = '10', "division" = '00';

ALTER TABLE "price_conditions" ALTER COLUMN "sales_organization" SET NOT NULL,
ALTER COLUMN "distribution_channel" SET NOT NULL,
ALTER COLUMN "division" SET NOT NULL;

CREATE UNIQUE INDEX "sales_organizations_code_currency_key" ON "sales_organizations"("code", "currency_code");
CREATE INDEX "price_conditions_sales_area_material_idx" ON "price_conditions"("sales_organization", "distribution_channel", "division", "material_number");
CREATE INDEX "price_conditions_sold_to_sales_area_idx" ON "price_conditions"("sold_to_customer_number", "sales_organization", "distribution_channel", "division");
CREATE INDEX "price_conditions_unit_sales_area_idx" ON "price_conditions"("unit_id", "sales_organization", "distribution_channel", "division");
CREATE INDEX "price_conditions_currency_idx" ON "price_conditions"("sales_organization", "currency");
CREATE INDEX "price_conditions_condition_type_scope_idx" ON "price_conditions"("condition_type_code", "scope");

-- Market consistency. Composite foreign keys with a NULL column (e.g. no
-- unit_id for a Sold-to condition) are not checked, so each key only
-- applies to its own scope.
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_sales_area_fkey" FOREIGN KEY ("sales_organization", "distribution_channel", "division") REFERENCES "sales_areas"("sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- The Sold-to is assigned to the sales area
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_sold_to_sales_area_fkey" FOREIGN KEY ("sold_to_customer_number", "sales_organization", "distribution_channel", "division") REFERENCES "customer_sales_areas"("customer_number", "sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- The unit belongs to the sales area
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_unit_sales_area_fkey" FOREIGN KEY ("unit_id", "sales_organization", "distribution_channel", "division") REFERENCES "b2b_units"("unit_id", "sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- The currency is the currency of the sales organization. ON UPDATE RESTRICT
-- also keeps a sales organization from changing its currency while
-- conditions in the old currency exist.
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_currency_fkey" FOREIGN KEY ("sales_organization", "currency") REFERENCES "sales_organizations"("code", "currency_code") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- The condition type may be used with the scope (configuration)
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_condition_type_scope_fkey" FOREIGN KEY ("condition_type_code", "scope") REFERENCES "condition_type_scopes"("condition_type_code", "scope") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Constraints that use the scope, created again for three scopes
-- ---------------------------------------------------------------------------

-- The key column of the scope is set, the other key columns are empty
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_scope_key_check" CHECK (
    ("scope" = 'SOLD_TO' AND "sold_to_customer_number" IS NOT NULL AND "unit_id" IS NULL)
    OR ("scope" = 'B2B_UNIT' AND "unit_id" IS NOT NULL AND "sold_to_customer_number" IS NULL)
    OR ("scope" = 'SALES_AREA' AND "sold_to_customer_number" IS NULL AND "unit_id" IS NULL)
);

-- Active conditions with the same sales area, material and key must not
-- overlap. daterange(..., '[]') includes both dates; a NULL valid_to is
-- unbounded. As before, the condition type is deliberately not part of the
-- rule: one active price per key and day.
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_sold_to_no_overlap" EXCLUDE USING gist (
    "sales_organization" WITH =,
    "distribution_channel" WITH =,
    "division" WITH =,
    "material_number" WITH =,
    "sold_to_customer_number" WITH =,
    daterange("valid_from", "valid_to", '[]') WITH &&
) WHERE ("scope" = 'SOLD_TO' AND "is_active");

ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_unit_no_overlap" EXCLUDE USING gist (
    "sales_organization" WITH =,
    "distribution_channel" WITH =,
    "division" WITH =,
    "material_number" WITH =,
    "unit_id" WITH =,
    daterange("valid_from", "valid_to", '[]') WITH &&
) WHERE ("scope" = 'B2B_UNIT' AND "is_active");

ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_sales_area_no_overlap" EXCLUDE USING gist (
    "sales_organization" WITH =,
    "distribution_channel" WITH =,
    "division" WITH =,
    "material_number" WITH =,
    daterange("valid_from", "valid_to", '[]') WITH &&
) WHERE ("scope" = 'SALES_AREA' AND "is_active");

-- ---------------------------------------------------------------------------
-- ZP01 list prices of the German sales area from the material prices
-- ---------------------------------------------------------------------------

-- In material order, so the new condition IDs are predictable
INSERT INTO "price_conditions" (
    "material_number", "scope", "amount", "currency", "valid_from", "valid_to",
    "is_active", "condition_type_code", "sales_organization",
    "distribution_channel", "division", "updated_at"
)
SELECT "material_number", 'SALES_AREA', "price", "currency", DATE '1900-01-01', NULL,
    true, 'ZP01', '1000', '10', '00', CURRENT_TIMESTAMP
FROM "materials"
WHERE "price" IS NOT NULL
ORDER BY "material_number";

COMMIT;
