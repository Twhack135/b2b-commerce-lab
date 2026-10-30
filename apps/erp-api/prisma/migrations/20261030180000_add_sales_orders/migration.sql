-- Sales orders (Sprint 10B).
--
-- A sales order is created from an order that the ERP API evaluates (and
-- prices) again at the moment of creation. It stores immutable snapshots:
-- partner names and addresses, unit name, material descriptions, prices,
-- currency with its decimal places and the applied price condition. A
-- stored order therefore never changes when master data or price
-- conditions change later, and it can be shown without reading them.
--
-- Foreign keys point only to records that are never deleted and whose keys
-- never change (sales area, unit, customer, material, condition type, price
-- condition). They keep every order inside one market:
-- - the unit belongs to the sales area of the order
-- - the currency is the currency of the sales organization
-- - an applied price condition belongs to the sales area of the order and
--   to the material of its item
-- Deliberately NO foreign keys to customer_sales_areas, b2b_unit_ship_tos or
-- customer_account_members: those assignments are maintained (and partly
-- replaced) as master data; historical orders must never block that.
--
-- The order date is determined by the server in the time zone of the sales
-- organization, so every sales organization gets a time zone.
--
-- Nothing existing is changed except the new time_zone column of
-- sales_organizations. Prisma does not run a migration in a transaction, so
-- this one does it explicitly: if any statement fails, nothing is changed.

BEGIN;

-- ---------------------------------------------------------------------------
-- Time zone of each sales organization (IANA name)
-- ---------------------------------------------------------------------------

ALTER TABLE "sales_organizations" ADD COLUMN "time_zone" VARCHAR(64);

UPDATE "sales_organizations" SET "time_zone" = CASE "code"
    WHEN '1000' THEN 'Europe/Berlin'
    WHEN '2000' THEN 'Europe/Warsaw'
    WHEN '3000' THEN 'Asia/Tokyo'
END;

-- Stop with a clear message instead of guessing a time zone
DO $$
DECLARE
    unknown TEXT;
BEGIN
    SELECT string_agg("code", ', ' ORDER BY "code") INTO unknown
    FROM "sales_organizations" WHERE "time_zone" IS NULL;
    IF unknown IS NOT NULL THEN
        RAISE EXCEPTION 'No time zone is known for sales organization(s) %; add them to this migration', unknown;
    END IF;
    SELECT string_agg(s."code", ', ' ORDER BY s."code") INTO unknown
    FROM "sales_organizations" s
    WHERE NOT EXISTS (SELECT 1 FROM pg_timezone_names t WHERE t.name = s."time_zone");
    IF unknown IS NOT NULL THEN
        RAISE EXCEPTION 'PostgreSQL does not know the time zone of sales organization(s) %', unknown;
    END IF;
END $$;

ALTER TABLE "sales_organizations" ALTER COLUMN "time_zone" SET NOT NULL;
ALTER TABLE "sales_organizations" ADD CONSTRAINT "sales_organizations_time_zone_check"
    CHECK ("time_zone" ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$');

-- ---------------------------------------------------------------------------
-- Types and number range
-- ---------------------------------------------------------------------------

CREATE TYPE "sales_order_status" AS ENUM ('OPEN');
CREATE TYPE "sales_order_delivery_block" AS ENUM ('SALES_REVIEW');
CREATE TYPE "sales_order_partner_role" AS ENUM ('SOLD_TO', 'SHIP_TO', 'BILL_TO', 'PAYER');
CREATE TYPE "requested_shipping_method" AS ENUM ('STANDARD', 'EXPRESS');

-- 10-digit sales order numbers like SAP (VBELN). Numbers of rolled back
-- creations are lost, so the range may have gaps.
CREATE SEQUENCE "sales_order_number_seq" AS BIGINT
    START WITH 1000000001 MINVALUE 1000000001 MAXVALUE 9999999999 NO CYCLE;

-- Target of the foreign key from applied conditions: the condition must be
-- one of the same sales area, material, type and scope
CREATE UNIQUE INDEX "price_conditions_order_reference_key" ON "price_conditions" (
    "condition_id", "sales_organization", "distribution_channel", "division",
    "material_number", "condition_type_code", "scope"
);

-- ---------------------------------------------------------------------------
-- Sales order header (like SAP VBAK)
-- ---------------------------------------------------------------------------

CREATE TABLE "sales_orders" (
    "sales_order_number" VARCHAR(10) NOT NULL,
    -- Idempotency: one order per creation attempt of the client
    "request_id" UUID NOT NULL,
    -- SHA-256 of the canonical request; a reused request ID must match it
    "request_hash" CHAR(64) NOT NULL,
    "status" "sales_order_status" NOT NULL DEFAULT 'OPEN',
    "delivery_block" "sales_order_delivery_block",
    "sales_organization" CHAR(4) NOT NULL,
    "distribution_channel" CHAR(2) NOT NULL,
    "division" CHAR(2) NOT NULL,
    -- Document currency and its decimal places (snapshot)
    "currency" CHAR(3) NOT NULL,
    "currency_decimals" SMALLINT NOT NULL,
    -- Order date = pricing date, in the time zone of the sales organization
    "order_date" DATE NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL,
    "requested_delivery_date" DATE,
    "requested_shipping_method" "requested_shipping_method" NOT NULL,
    "customer_reference" VARCHAR(35),
    "customer_note" VARCHAR(1000),
    "unit_id" VARCHAR(20) NOT NULL,
    "unit_name" VARCHAR(100) NOT NULL,
    -- Net value of all items, excluding tax and freight
    "net_value" DECIMAL(20, 2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("sales_order_number"),
    CONSTRAINT "sales_orders_number_check" CHECK ("sales_order_number" ~ '^[0-9]{10}$'),
    CONSTRAINT "sales_orders_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "sales_orders_currency_decimals_check" CHECK ("currency_decimals" BETWEEN 0 AND 2),
    CONSTRAINT "sales_orders_net_value_check" CHECK (
        "net_value" >= 0 AND "net_value" = round("net_value", "currency_decimals")
    ),
    CONSTRAINT "sales_orders_requested_delivery_date_check" CHECK (
        "requested_delivery_date" IS NULL OR "requested_delivery_date" >= "order_date"
    ),
    CONSTRAINT "sales_orders_texts_check" CHECK (
        ("customer_reference" IS NULL OR btrim("customer_reference") <> '')
        AND ("customer_note" IS NULL OR btrim("customer_note") <> '')
        AND btrim("unit_name") <> ''
    )
);

CREATE UNIQUE INDEX "sales_orders_request_id_key" ON "sales_orders" ("request_id");
-- Target of the foreign key that repeats the sales area on applied conditions
CREATE UNIQUE INDEX "sales_orders_number_sales_area_key" ON "sales_orders" (
    "sales_order_number", "sales_organization", "distribution_channel", "division"
);
CREATE INDEX "sales_orders_sales_area_idx" ON "sales_orders" ("sales_organization", "distribution_channel", "division");
CREATE INDEX "sales_orders_currency_idx" ON "sales_orders" ("sales_organization", "currency");
CREATE INDEX "sales_orders_unit_idx" ON "sales_orders" ("unit_id", "sales_organization", "distribution_channel", "division");

ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_sales_area_fkey"
    FOREIGN KEY ("sales_organization", "distribution_channel", "division")
    REFERENCES "sales_areas" ("sales_organization", "distribution_channel", "division")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_currency_fkey"
    FOREIGN KEY ("sales_organization", "currency")
    REFERENCES "sales_organizations" ("code", "currency_code")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_unit_fkey"
    FOREIGN KEY ("unit_id", "sales_organization", "distribution_channel", "division")
    REFERENCES "b2b_units" ("unit_id", "sales_organization", "distribution_channel", "division")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Partners with address snapshot (like SAP VBPA)
-- ---------------------------------------------------------------------------

CREATE TABLE "sales_order_partners" (
    "sales_order_number" VARCHAR(10) NOT NULL,
    "role" "sales_order_partner_role" NOT NULL,
    "customer_number" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "street" VARCHAR(100) NOT NULL,
    "postal_code" VARCHAR(10) NOT NULL,
    "city" VARCHAR(60) NOT NULL,
    "country" CHAR(2) NOT NULL,

    CONSTRAINT "sales_order_partners_pkey" PRIMARY KEY ("sales_order_number", "role")
);

CREATE INDEX "sales_order_partners_customer_idx" ON "sales_order_partners" ("customer_number");

ALTER TABLE "sales_order_partners" ADD CONSTRAINT "sales_order_partners_sales_order_fkey"
    FOREIGN KEY ("sales_order_number") REFERENCES "sales_orders" ("sales_order_number")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_partners" ADD CONSTRAINT "sales_order_partners_customer_fkey"
    FOREIGN KEY ("customer_number") REFERENCES "customers" ("customer_number")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Items (like SAP VBAP)
-- ---------------------------------------------------------------------------

CREATE TABLE "sales_order_items" (
    "sales_order_number" VARCHAR(10) NOT NULL,
    "item_number" INTEGER NOT NULL,
    "material_number" TEXT NOT NULL,
    "material_description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12, 2) NOT NULL,
    "net_value" DECIMAL(20, 2) NOT NULL,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("sales_order_number", "item_number"),
    CONSTRAINT "sales_order_items_item_number_check" CHECK ("item_number" > 0 AND "item_number" % 10 = 0),
    CONSTRAINT "sales_order_items_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99999),
    CONSTRAINT "sales_order_items_amounts_check" CHECK (
        "unit_price" >= 0 AND "net_value" = "quantity" * "unit_price"
    )
);

-- Target of the foreign key that repeats the material on applied conditions
CREATE UNIQUE INDEX "sales_order_items_material_key" ON "sales_order_items" (
    "sales_order_number", "item_number", "material_number"
);
CREATE INDEX "sales_order_items_material_idx" ON "sales_order_items" ("material_number");

ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_sales_order_fkey"
    FOREIGN KEY ("sales_order_number") REFERENCES "sales_orders" ("sales_order_number")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_material_fkey"
    FOREIGN KEY ("material_number") REFERENCES "materials" ("material_number")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Applied conditions per item (like SAP KONV, pricing result)
-- ---------------------------------------------------------------------------

CREATE TABLE "sales_order_item_conditions" (
    "sales_order_number" VARCHAR(10) NOT NULL,
    "item_number" INTEGER NOT NULL,
    -- 10 = price; later steps (discounts, freight, tax) follow
    "step_number" INTEGER NOT NULL,
    -- Repeated from header and item so foreign keys can check them
    "sales_organization" CHAR(4) NOT NULL,
    "distribution_channel" CHAR(2) NOT NULL,
    "division" CHAR(2) NOT NULL,
    "material_number" TEXT NOT NULL,
    -- The price condition as it was applied (snapshot)
    "condition_id" INTEGER NOT NULL,
    "condition_type_code" VARCHAR(4) NOT NULL,
    "condition_type_name" VARCHAR(60) NOT NULL,
    "scope" "price_condition_scope" NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "condition_value" DECIMAL(20, 2) NOT NULL,

    CONSTRAINT "sales_order_item_conditions_pkey" PRIMARY KEY ("sales_order_number", "item_number", "step_number"),
    CONSTRAINT "sales_order_item_conditions_step_number_check" CHECK ("step_number" > 0),
    CONSTRAINT "sales_order_item_conditions_amount_check" CHECK ("amount" >= 0),
    CONSTRAINT "sales_order_item_conditions_validity_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from")
);

CREATE INDEX "sales_order_item_conditions_item_idx" ON "sales_order_item_conditions" ("sales_order_number", "item_number", "material_number");
CREATE INDEX "sales_order_item_conditions_order_idx" ON "sales_order_item_conditions" ("sales_order_number", "sales_organization", "distribution_channel", "division");
CREATE INDEX "sales_order_item_conditions_condition_idx" ON "sales_order_item_conditions" (
    "condition_id", "sales_organization", "distribution_channel", "division",
    "material_number", "condition_type_code", "scope"
);

ALTER TABLE "sales_order_item_conditions" ADD CONSTRAINT "sales_order_item_conditions_item_fkey"
    FOREIGN KEY ("sales_order_number", "item_number", "material_number")
    REFERENCES "sales_order_items" ("sales_order_number", "item_number", "material_number")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_item_conditions" ADD CONSTRAINT "sales_order_item_conditions_order_fkey"
    FOREIGN KEY ("sales_order_number", "sales_organization", "distribution_channel", "division")
    REFERENCES "sales_orders" ("sales_order_number", "sales_organization", "distribution_channel", "division")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_item_conditions" ADD CONSTRAINT "sales_order_item_conditions_price_condition_fkey"
    FOREIGN KEY ("condition_id", "sales_organization", "distribution_channel", "division",
        "material_number", "condition_type_code", "scope")
    REFERENCES "price_conditions" ("condition_id", "sales_organization", "distribution_channel", "division",
        "material_number", "condition_type_code", "scope")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Immutability: stored documents can only change their status fields
-- ---------------------------------------------------------------------------

CREATE FUNCTION "sales_order_document_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Sales order documents cannot be changed or deleted (%)', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- Only status, delivery block and updated_at of the header may change
CREATE FUNCTION "sales_order_header_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Sales orders cannot be deleted'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'delivery_block' - 'updated_at')
        IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'delivery_block' - 'updated_at') THEN
        RAISE EXCEPTION 'Only status and delivery block of a sales order can be changed'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER "sales_orders_immutable"
    BEFORE UPDATE OR DELETE ON "sales_orders"
    FOR EACH ROW EXECUTE FUNCTION "sales_order_header_immutable"();
CREATE TRIGGER "sales_order_partners_immutable"
    BEFORE UPDATE OR DELETE ON "sales_order_partners"
    FOR EACH ROW EXECUTE FUNCTION "sales_order_document_immutable"();
CREATE TRIGGER "sales_order_items_immutable"
    BEFORE UPDATE OR DELETE ON "sales_order_items"
    FOR EACH ROW EXECUTE FUNCTION "sales_order_document_immutable"();
CREATE TRIGGER "sales_order_item_conditions_immutable"
    BEFORE UPDATE OR DELETE ON "sales_order_item_conditions"
    FOR EACH ROW EXECUTE FUNCTION "sales_order_document_immutable"();

COMMIT;
