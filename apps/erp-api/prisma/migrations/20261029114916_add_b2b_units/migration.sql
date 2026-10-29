-- CreateTable
CREATE TABLE "customer_account_members" (
    "customer_number" VARCHAR(20) NOT NULL,
    "account_customer_number" VARCHAR(20) NOT NULL,
    "account_owner_ref" VARCHAR(20) NOT NULL,

    CONSTRAINT "customer_account_members_pkey" PRIMARY KEY ("customer_number")
);

-- CreateTable
CREATE TABLE "b2b_units" (
    "unit_id" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "account_customer_number" VARCHAR(20) NOT NULL,
    "sold_to_customer_number" VARCHAR(20) NOT NULL,
    "bill_to_customer_number" VARCHAR(20) NOT NULL,
    "payer_customer_number" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "b2b_units_pkey" PRIMARY KEY ("unit_id")
);

-- CreateTable
CREATE TABLE "b2b_unit_ship_tos" (
    "unit_id" VARCHAR(20) NOT NULL,
    "customer_number" VARCHAR(20) NOT NULL,
    "account_customer_number" VARCHAR(20) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "b2b_unit_ship_tos_pkey" PRIMARY KEY ("unit_id","customer_number")
);

-- CreateIndex
CREATE INDEX "customer_account_members_account_customer_number_idx" ON "customer_account_members"("account_customer_number");

-- CreateIndex
CREATE UNIQUE INDEX "customer_account_members_customer_number_account_customer_n_key" ON "customer_account_members"("customer_number", "account_customer_number");

-- CreateIndex
CREATE INDEX "b2b_units_account_customer_number_idx" ON "b2b_units"("account_customer_number");

-- CreateIndex
CREATE INDEX "b2b_units_sold_to_customer_number_account_customer_number_idx" ON "b2b_units"("sold_to_customer_number", "account_customer_number");

-- CreateIndex
CREATE INDEX "b2b_units_bill_to_customer_number_account_customer_number_idx" ON "b2b_units"("bill_to_customer_number", "account_customer_number");

-- CreateIndex
CREATE INDEX "b2b_units_payer_customer_number_account_customer_number_idx" ON "b2b_units"("payer_customer_number", "account_customer_number");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_units_unit_id_account_customer_number_key" ON "b2b_units"("unit_id", "account_customer_number");

-- CreateIndex
CREATE INDEX "b2b_unit_ship_tos_customer_number_account_customer_number_idx" ON "b2b_unit_ship_tos"("customer_number", "account_customer_number");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_unit_ship_tos_one_default_key" ON "b2b_unit_ship_tos"("unit_id") WHERE ("is_default" = true);

-- AddForeignKey
ALTER TABLE "customer_account_members" ADD CONSTRAINT "customer_account_members_customer_number_fkey" FOREIGN KEY ("customer_number") REFERENCES "customers"("customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_account_members" ADD CONSTRAINT "customer_account_members_account_customer_number_account_o_fkey" FOREIGN KEY ("account_customer_number", "account_owner_ref") REFERENCES "customer_account_members"("customer_number", "account_customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "b2b_units" ADD CONSTRAINT "b2b_units_sold_to_customer_number_account_customer_number_fkey" FOREIGN KEY ("sold_to_customer_number", "account_customer_number") REFERENCES "customer_account_members"("customer_number", "account_customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "b2b_units" ADD CONSTRAINT "b2b_units_bill_to_customer_number_account_customer_number_fkey" FOREIGN KEY ("bill_to_customer_number", "account_customer_number") REFERENCES "customer_account_members"("customer_number", "account_customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "b2b_units" ADD CONSTRAINT "b2b_units_payer_customer_number_account_customer_number_fkey" FOREIGN KEY ("payer_customer_number", "account_customer_number") REFERENCES "customer_account_members"("customer_number", "account_customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "b2b_unit_ship_tos" ADD CONSTRAINT "b2b_unit_ship_tos_unit_id_account_customer_number_fkey" FOREIGN KEY ("unit_id", "account_customer_number") REFERENCES "b2b_units"("unit_id", "account_customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "b2b_unit_ship_tos" ADD CONSTRAINT "b2b_unit_ship_tos_customer_number_account_customer_number_fkey" FOREIGN KEY ("customer_number", "account_customer_number") REFERENCES "customer_account_members"("customer_number", "account_customer_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddCheckConstraint (written by hand; Prisma cannot express CHECK constraints)
-- account_owner_ref is a copy of account_customer_number for the owner foreign key
ALTER TABLE "customer_account_members" ADD CONSTRAINT "customer_account_members_account_owner_ref_check" CHECK ("account_owner_ref" = "account_customer_number");
