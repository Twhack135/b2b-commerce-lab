-- CreateTable
CREATE TABLE "customers" (
    "customer_number" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "street" VARCHAR(100) NOT NULL,
    "postal_code" VARCHAR(10) NOT NULL,
    "city" VARCHAR(60) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("customer_number")
);
