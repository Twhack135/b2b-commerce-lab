-- CreateEnum
CREATE TYPE "price_condition_scope" AS ENUM ('B2B_UNIT', 'SOLD_TO');

-- CreateTable
CREATE TABLE "price_conditions" (
    "condition_id" SERIAL NOT NULL,
    "material_number" TEXT NOT NULL,
    "scope" "price_condition_scope" NOT NULL,
    "sold_to_customer_number" VARCHAR(20),
    "unit_id" VARCHAR(20),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_conditions_pkey" PRIMARY KEY ("condition_id")
);

-- CreateIndex
CREATE INDEX "price_conditions_material_number_idx" ON "price_conditions"("material_number");

-- CreateIndex
CREATE INDEX "price_conditions_sold_to_customer_number_idx" ON "price_conditions"("sold_to_customer_number");

-- CreateIndex
CREATE INDEX "price_conditions_unit_id_idx" ON "price_conditions"("unit_id");

-- AddForeignKey
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_material_number_fkey" FOREIGN KEY ("material_number") REFERENCES "materials"("material_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_sold_to_customer_number_fkey" FOREIGN KEY ("sold_to_customer_number") REFERENCES "customers"("customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "b2b_units"("unit_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddCheckConstraint (written by hand; Prisma cannot express CHECK constraints)
-- The key column of the scope is set, the other key column is empty
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_scope_key_check" CHECK (
    ("scope" = 'SOLD_TO' AND "sold_to_customer_number" IS NOT NULL AND "unit_id" IS NULL)
    OR ("scope" = 'B2B_UNIT' AND "unit_id" IS NOT NULL AND "sold_to_customer_number" IS NULL)
);

-- AddCheckConstraint (written by hand)
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_amount_check" CHECK ("amount" > 0);

-- AddCheckConstraint (written by hand)
-- valid_to is inclusive; NULL means open-ended
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_validity_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");

-- AddCheckConstraint (written by hand)
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- CreateExtension (written by hand)
-- btree_gist lets an exclusion constraint compare plain columns with "="
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- AddExclusionConstraint (written by hand; Prisma cannot express EXCLUDE constraints)
-- Active conditions for the same material and Sold-to must not overlap.
-- daterange(..., '[]') includes both dates; a NULL valid_to is unbounded.
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_sold_to_no_overlap" EXCLUDE USING gist (
    "material_number" WITH =,
    "sold_to_customer_number" WITH =,
    daterange("valid_from", "valid_to", '[]') WITH &&
) WHERE ("scope" = 'SOLD_TO' AND "is_active");

-- AddExclusionConstraint (written by hand)
-- Active conditions for the same material and B2B unit must not overlap
ALTER TABLE "price_conditions" ADD CONSTRAINT "price_conditions_unit_no_overlap" EXCLUDE USING gist (
    "material_number" WITH =,
    "unit_id" WITH =,
    daterange("valid_from", "valid_to", '[]') WITH &&
) WHERE ("scope" = 'B2B_UNIT' AND "is_active");
