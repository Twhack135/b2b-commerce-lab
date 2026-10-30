-- Sales areas and currencies (Sprint 9C-A).
--
-- Adds currencies, the organizational structure of sales (sales
-- organizations, distribution channels, divisions, sales areas) and assigns
-- customers and B2B units to sales areas. All existing data belongs to the
-- German sales area 1000/10/00 (EUR): every existing customer is assigned to
-- it, and every existing B2B unit and ship-to is placed in it.
--
-- Prices, price conditions and materials are not changed.
--
-- Prisma does not run a migration in a transaction, so this one does it
-- explicitly: if any statement fails, nothing is changed.

BEGIN;

-- ---------------------------------------------------------------------------
-- Currencies (configuration)
-- ---------------------------------------------------------------------------

CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "decimals" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "currencies_code_format" CHECK ("code" ~ '^[A-Z]{3}$'),
    CONSTRAINT "currencies_decimals_range" CHECK ("decimals" BETWEEN 0 AND 3),
    CONSTRAINT "currencies_name_not_blank" CHECK ("name" ~ '\S')
);

INSERT INTO "currencies" ("code", "name", "decimals") VALUES
    ('EUR', 'Euro', 2),
    ('PLN', 'Polish Zloty', 2),
    ('JPY', 'Japanese Yen', 0);

-- ---------------------------------------------------------------------------
-- Organizational structure (configuration)
-- ---------------------------------------------------------------------------

CREATE TABLE "sales_organizations" (
    "code" CHAR(4) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sales_organizations_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "sales_organizations_code_format" CHECK ("code" ~ '^[A-Z0-9]{4}$'),
    CONSTRAINT "sales_organizations_country_format" CHECK ("country" ~ '^[A-Z]{2}$'),
    CONSTRAINT "sales_organizations_name_not_blank" CHECK ("name" ~ '\S')
);

CREATE TABLE "distribution_channels" (
    "code" CHAR(2) NOT NULL,
    "name" VARCHAR(60) NOT NULL,

    CONSTRAINT "distribution_channels_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "distribution_channels_code_format" CHECK ("code" ~ '^[A-Z0-9]{2}$'),
    CONSTRAINT "distribution_channels_name_not_blank" CHECK ("name" ~ '\S')
);

CREATE TABLE "divisions" (
    "code" CHAR(2) NOT NULL,
    "name" VARCHAR(60) NOT NULL,

    CONSTRAINT "divisions_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "divisions_code_format" CHECK ("code" ~ '^[A-Z0-9]{2}$'),
    CONSTRAINT "divisions_name_not_blank" CHECK ("name" ~ '\S')
);

CREATE TABLE "sales_areas" (
    "sales_organization" CHAR(4) NOT NULL,
    "distribution_channel" CHAR(2) NOT NULL,
    "division" CHAR(2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sales_areas_pkey" PRIMARY KEY ("sales_organization","distribution_channel","division")
);

CREATE INDEX "sales_organizations_currency_code_idx" ON "sales_organizations"("currency_code");
CREATE INDEX "sales_areas_distribution_channel_idx" ON "sales_areas"("distribution_channel");
CREATE INDEX "sales_areas_division_idx" ON "sales_areas"("division");

ALTER TABLE "sales_organizations" ADD CONSTRAINT "sales_organizations_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_areas" ADD CONSTRAINT "sales_areas_sales_organization_fkey" FOREIGN KEY ("sales_organization") REFERENCES "sales_organizations"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_areas" ADD CONSTRAINT "sales_areas_distribution_channel_fkey" FOREIGN KEY ("distribution_channel") REFERENCES "distribution_channels"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_areas" ADD CONSTRAINT "sales_areas_division_fkey" FOREIGN KEY ("division") REFERENCES "divisions"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Project configuration: one sales area per market
INSERT INTO "sales_organizations" ("code", "name", "country", "currency_code") VALUES
    ('1000', 'B2B Lab Germany', 'DE', 'EUR'),
    ('2000', 'B2B Lab Poland', 'PL', 'PLN'),
    ('3000', 'B2B Lab Japan', 'JP', 'JPY');

INSERT INTO "distribution_channels" ("code", "name") VALUES ('10', 'Direct Sales');

INSERT INTO "divisions" ("code", "name") VALUES ('00', 'Cross-Division');

INSERT INTO "sales_areas" ("sales_organization", "distribution_channel", "division") VALUES
    ('1000', '10', '00'),
    ('2000', '10', '00'),
    ('3000', '10', '00');

-- ---------------------------------------------------------------------------
-- Customer sales area assignments
-- ---------------------------------------------------------------------------

CREATE TABLE "customer_sales_areas" (
    "customer_number" VARCHAR(20) NOT NULL,
    "sales_organization" CHAR(4) NOT NULL,
    "distribution_channel" CHAR(2) NOT NULL,
    "division" CHAR(2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "customer_sales_areas_pkey" PRIMARY KEY ("customer_number","sales_organization","distribution_channel","division")
);

CREATE INDEX "customer_sales_areas_sales_area_idx" ON "customer_sales_areas"("sales_organization", "distribution_channel", "division");

ALTER TABLE "customer_sales_areas" ADD CONSTRAINT "customer_sales_areas_customer_number_fkey" FOREIGN KEY ("customer_number") REFERENCES "customers"("customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "customer_sales_areas" ADD CONSTRAINT "customer_sales_areas_sales_organization_distribution_chann_fkey" FOREIGN KEY ("sales_organization", "distribution_channel", "division") REFERENCES "sales_areas"("sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Every existing customer belongs to the German sales area
INSERT INTO "customer_sales_areas" ("customer_number", "sales_organization", "distribution_channel", "division")
SELECT "customer_number", '1000', '10', '00' FROM "customers";

-- ---------------------------------------------------------------------------
-- Sales area of B2B units and their ship-tos
-- ---------------------------------------------------------------------------

-- Added without NOT NULL, filled, then made mandatory. There is deliberately
-- no default: every new unit must name its sales area explicitly.
ALTER TABLE "b2b_units" ADD COLUMN "sales_organization" CHAR(4),
ADD COLUMN "distribution_channel" CHAR(2),
ADD COLUMN "division" CHAR(2);

UPDATE "b2b_units" SET "sales_organization" = '1000', "distribution_channel" = '10', "division" = '00';

ALTER TABLE "b2b_units" ALTER COLUMN "sales_organization" SET NOT NULL,
ALTER COLUMN "distribution_channel" SET NOT NULL,
ALTER COLUMN "division" SET NOT NULL;

-- Ship-tos repeat the sales area of their unit
ALTER TABLE "b2b_unit_ship_tos" ADD COLUMN "sales_organization" CHAR(4),
ADD COLUMN "distribution_channel" CHAR(2),
ADD COLUMN "division" CHAR(2);

UPDATE "b2b_unit_ship_tos" AS s
SET "sales_organization" = u."sales_organization",
    "distribution_channel" = u."distribution_channel",
    "division" = u."division"
FROM "b2b_units" AS u
WHERE u."unit_id" = s."unit_id";

ALTER TABLE "b2b_unit_ship_tos" ALTER COLUMN "sales_organization" SET NOT NULL,
ALTER COLUMN "distribution_channel" SET NOT NULL,
ALTER COLUMN "division" SET NOT NULL;

CREATE INDEX "b2b_unit_ship_tos_customer_sales_area_idx" ON "b2b_unit_ship_tos"("customer_number", "sales_organization", "distribution_channel", "division");
CREATE INDEX "b2b_units_sales_area_idx" ON "b2b_units"("sales_organization", "distribution_channel", "division");
CREATE INDEX "b2b_units_sold_to_sales_area_idx" ON "b2b_units"("sold_to_customer_number", "sales_organization", "distribution_channel", "division");
CREATE INDEX "b2b_units_bill_to_sales_area_idx" ON "b2b_units"("bill_to_customer_number", "sales_organization", "distribution_channel", "division");
CREATE INDEX "b2b_units_payer_sales_area_idx" ON "b2b_units"("payer_customer_number", "sales_organization", "distribution_channel", "division");
CREATE UNIQUE INDEX "b2b_units_unit_id_sales_area_key" ON "b2b_units"("unit_id", "sales_organization", "distribution_channel", "division");

-- Market consistency in the database: the unit's sales area exists, and
-- Sold-to, Bill-to, Payer and every Ship-to are assigned to that sales area.
-- ON UPDATE RESTRICT on the ship-to foreign key also keeps the sales area of
-- a unit from being changed while it has ship-tos (it always has one).
ALTER TABLE "b2b_units" ADD CONSTRAINT "b2b_units_sales_organization_distribution_channel_division_fkey" FOREIGN KEY ("sales_organization", "distribution_channel", "division") REFERENCES "sales_areas"("sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "b2b_units" ADD CONSTRAINT "b2b_units_sold_to_sales_area_fkey" FOREIGN KEY ("sold_to_customer_number", "sales_organization", "distribution_channel", "division") REFERENCES "customer_sales_areas"("customer_number", "sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "b2b_units" ADD CONSTRAINT "b2b_units_bill_to_sales_area_fkey" FOREIGN KEY ("bill_to_customer_number", "sales_organization", "distribution_channel", "division") REFERENCES "customer_sales_areas"("customer_number", "sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "b2b_units" ADD CONSTRAINT "b2b_units_payer_sales_area_fkey" FOREIGN KEY ("payer_customer_number", "sales_organization", "distribution_channel", "division") REFERENCES "customer_sales_areas"("customer_number", "sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "b2b_unit_ship_tos" ADD CONSTRAINT "b2b_unit_ship_tos_unit_sales_area_fkey" FOREIGN KEY ("unit_id", "sales_organization", "distribution_channel", "division") REFERENCES "b2b_units"("unit_id", "sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "b2b_unit_ship_tos" ADD CONSTRAINT "b2b_unit_ship_tos_customer_sales_area_fkey" FOREIGN KEY ("customer_number", "sales_organization", "distribution_channel", "division") REFERENCES "customer_sales_areas"("customer_number", "sales_organization", "distribution_channel", "division") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
