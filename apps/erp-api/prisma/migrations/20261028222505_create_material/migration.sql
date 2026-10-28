-- CreateTable
CREATE TABLE "materials" (
    "material_number" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("material_number")
);
