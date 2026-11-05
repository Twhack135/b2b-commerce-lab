-- Pricing procedures (Sprint 13A, docs/adr/0008): access sequences, pricing
-- procedures with their steps, and the determination of the procedure per
-- sales area. Comparable to the SAP SD pricing configuration, without its
-- full complexity.
--
-- Only new objects are created, and their configuration is inserted: the
-- base price access sequence ZBP1, the list price access sequence ZLP1, and
-- one procedure per market (ZDE001 Germany, ZPL001 Poland, ZJP001 Japan).
-- Existing tables and data are not changed; the existing price
-- determination (POST /pricing/price, the order simulation and order
-- creation) does not read these tables. Prisma does not run a migration in a
-- transaction, so this one does it explicitly.

BEGIN;

-- CreateEnum
CREATE TYPE "pricing_step_kind" AS ENUM ('CONDITION', 'SUBTOTAL');

-- CreateTable
CREATE TABLE "access_sequences" (
    "code" VARCHAR(4) NOT NULL,
    "name" VARCHAR(60) NOT NULL,

    CONSTRAINT "access_sequences_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "access_sequence_accesses" (
    "access_sequence_code" VARCHAR(4) NOT NULL,
    "access_number" INTEGER NOT NULL,
    "condition_type_code" VARCHAR(4) NOT NULL,
    "scope" "price_condition_scope" NOT NULL,
    "material_specific" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "access_sequence_accesses_pkey" PRIMARY KEY ("access_sequence_code","access_number")
);

-- CreateTable
CREATE TABLE "pricing_procedures" (
    "code" VARCHAR(6) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "revision" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pricing_procedures_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "pricing_procedure_steps" (
    "procedure_code" VARCHAR(6) NOT NULL,
    "step_number" INTEGER NOT NULL,
    "kind" "pricing_step_kind" NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "access_sequence_code" VARCHAR(4),
    "from_step" INTEGER,
    "to_step" INTEGER,
    "is_statistical" BOOLEAN NOT NULL DEFAULT false,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "subtotal_key" VARCHAR(20),
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pricing_procedure_steps_pkey" PRIMARY KEY ("procedure_code","step_number")
);

-- CreateTable
CREATE TABLE "pricing_procedure_determinations" (
    "sales_organization" CHAR(4) NOT NULL,
    "distribution_channel" CHAR(2) NOT NULL,
    "division" CHAR(2) NOT NULL,
    "customer_procedure" CHAR(1) NOT NULL DEFAULT '*',
    "procedure_code" VARCHAR(6) NOT NULL,

    CONSTRAINT "pricing_procedure_determinations_pkey" PRIMARY KEY ("sales_organization","distribution_channel","division","customer_procedure")
);

-- CreateIndex
CREATE INDEX "access_sequence_accesses_condition_type_scope_idx" ON "access_sequence_accesses"("condition_type_code", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "access_sequence_accesses_type_scope_key" ON "access_sequence_accesses"("access_sequence_code", "condition_type_code", "scope");

-- CreateIndex
CREATE INDEX "pricing_procedure_steps_access_sequence_idx" ON "pricing_procedure_steps"("access_sequence_code");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_procedure_steps_subtotal_key" ON "pricing_procedure_steps"("procedure_code", "subtotal_key");

-- CreateIndex
CREATE INDEX "pricing_procedure_determinations_procedure_idx" ON "pricing_procedure_determinations"("procedure_code");

-- AddForeignKey
ALTER TABLE "access_sequence_accesses" ADD CONSTRAINT "access_sequence_accesses_sequence_fkey" FOREIGN KEY ("access_sequence_code") REFERENCES "access_sequences"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "access_sequence_accesses" ADD CONSTRAINT "access_sequence_accesses_condition_type_scope_fkey" FOREIGN KEY ("condition_type_code", "scope") REFERENCES "condition_type_scopes"("condition_type_code", "scope") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pricing_procedure_steps" ADD CONSTRAINT "pricing_procedure_steps_procedure_fkey" FOREIGN KEY ("procedure_code") REFERENCES "pricing_procedures"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pricing_procedure_steps" ADD CONSTRAINT "pricing_procedure_steps_access_sequence_fkey" FOREIGN KEY ("access_sequence_code") REFERENCES "access_sequences"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pricing_procedure_determinations" ADD CONSTRAINT "pricing_procedure_determinations_sales_area_fkey" FOREIGN KEY ("sales_organization", "distribution_channel", "division") REFERENCES "sales_areas"("sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pricing_procedure_determinations" ADD CONSTRAINT "pricing_procedure_determinations_procedure_fkey" FOREIGN KEY ("procedure_code") REFERENCES "pricing_procedures"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- AddCheckConstraint (written by hand; Prisma cannot express CHECK constraints)
ALTER TABLE "access_sequences" ADD CONSTRAINT "access_sequences_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9]{1,3}$');
ALTER TABLE "access_sequence_accesses" ADD CONSTRAINT "access_sequence_accesses_number_check" CHECK ("access_number" BETWEEN 1 AND 999);
ALTER TABLE "pricing_procedures" ADD CONSTRAINT "pricing_procedures_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9]{1,5}$');
ALTER TABLE "pricing_procedures" ADD CONSTRAINT "pricing_procedures_revision_check" CHECK ("revision" >= 1);
ALTER TABLE "pricing_procedure_steps" ADD CONSTRAINT "pricing_procedure_steps_number_check" CHECK ("step_number" BETWEEN 1 AND 999);
-- A condition step reads records through an access sequence; a subtotal adds
-- up earlier steps and is never statistical or mandatory
ALTER TABLE "pricing_procedure_steps" ADD CONSTRAINT "pricing_procedure_steps_kind_check" CHECK (
    ("kind" = 'CONDITION' AND "access_sequence_code" IS NOT NULL AND "subtotal_key" IS NULL)
    OR ("kind" = 'SUBTOTAL' AND "access_sequence_code" IS NULL AND "subtotal_key" IS NOT NULL
        AND "from_step" IS NOT NULL AND NOT "is_statistical" AND NOT "is_mandatory")
);
-- A calculation base only refers to earlier steps
ALTER TABLE "pricing_procedure_steps" ADD CONSTRAINT "pricing_procedure_steps_base_check" CHECK (
    ("from_step" IS NULL AND "to_step" IS NULL)
    OR ("from_step" IS NOT NULL AND "from_step" >= 1 AND COALESCE("to_step", "from_step") >= "from_step"
        AND COALESCE("to_step", "from_step") < "step_number")
);
ALTER TABLE "pricing_procedure_steps" ADD CONSTRAINT "pricing_procedure_steps_subtotal_key_check" CHECK ("subtotal_key" IS NULL OR "subtotal_key" ~ '^[A-Z][A-Z_]{0,19}$');
ALTER TABLE "pricing_procedure_determinations" ADD CONSTRAINT "pricing_procedure_determinations_customer_procedure_check" CHECK ("customer_procedure" ~ '^[A-Z0-9*]$');


-- Configuration (revision 1)

-- ZBP1 Base price: B2B unit before Sold-to before sales area (as the
-- existing price determination); within a level the special price ZP03
-- before the customer net price ZP02. The first valid record wins.
INSERT INTO "access_sequences" ("code", "name") VALUES
    ('ZBP1', 'Base price'),
    ('ZLP1', 'List price');

INSERT INTO "access_sequence_accesses" ("access_sequence_code", "access_number", "condition_type_code", "scope") VALUES
    ('ZBP1', 10, 'ZP03', 'B2B_UNIT'),
    ('ZBP1', 20, 'ZP02', 'B2B_UNIT'),
    ('ZBP1', 30, 'ZP03', 'SOLD_TO'),
    ('ZBP1', 40, 'ZP02', 'SOLD_TO'),
    ('ZBP1', 50, 'ZP01', 'SALES_AREA'),
    ('ZLP1', 10, 'ZP01', 'SALES_AREA');

-- One procedure per market. Identical in revision 1; taxes, freight and
-- rounding of the markets differ from Sprint 13C on.
INSERT INTO "pricing_procedures" ("code", "name", "revision", "updated_at") VALUES
    ('ZDE001', 'B2B Germany', 1, CURRENT_TIMESTAMP),
    ('ZPL001', 'B2B Poland', 1, CURRENT_TIMESTAMP),
    ('ZJP001', 'B2B Japan', 1, CURRENT_TIMESTAMP);

-- Step 5: the list price, statistical (shown next to a customer price,
-- never part of a value); step 10: the base price, mandatory; step 100: the
-- net value of steps 10..99. Discounts and surcharges (13B), freight and
-- taxes (13C) get their own step ranges.
INSERT INTO "pricing_procedure_steps" ("procedure_code", "step_number", "kind", "label", "access_sequence_code", "from_step", "to_step", "is_statistical", "is_mandatory", "subtotal_key", "customer_visible")
SELECT p.code, s.step_number, s.kind::"pricing_step_kind", s.label, s.access_sequence_code, s.from_step, s.to_step, s.is_statistical, s.is_mandatory, s.subtotal_key, s.customer_visible
  FROM (VALUES ('ZDE001'), ('ZPL001'), ('ZJP001')) AS p(code)
 CROSS JOIN (VALUES
    (5,   'CONDITION', 'List price',  'ZLP1', NULL::int, NULL::int, true,  false, NULL,        false),
    (10,  'CONDITION', 'Base price',  'ZBP1', NULL,      NULL,      false, true,  NULL,        true),
    (100, 'SUBTOTAL',  'Net value',   NULL,   10,        99,        false, false, 'NET_VALUE', true)
 ) AS s(step_number, kind, label, access_sequence_code, from_step, to_step, is_statistical, is_mandatory, subtotal_key, customer_visible);

INSERT INTO "pricing_procedure_determinations" ("sales_organization", "distribution_channel", "division", "customer_procedure", "procedure_code") VALUES
    ('1000', '10', '00', '*', 'ZDE001'),
    ('2000', '10', '00', '*', 'ZPL001'),
    ('3000', '10', '00', '*', 'ZJP001');

COMMIT;
