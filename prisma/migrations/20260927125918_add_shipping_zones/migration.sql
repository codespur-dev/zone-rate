-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT NOT NULL,
    "rateType" TEXT NOT NULL,
    "rateSetupId" INTEGER,
    "flatRateName" TEXT,
    "flatRatePrice" REAL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "shopifyProfileId" TEXT,
    "shopifyLocationGroupId" TEXT,
    "shopifyZoneId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShippingZone_rateSetupId_fkey" FOREIGN KEY ("rateSetupId") REFERENCES "RateSetup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ShippingZone_shop_idx" ON "ShippingZone"("shop");

-- CreateIndex
CREATE INDEX "ShippingZone_rateSetupId_idx" ON "ShippingZone"("rateSetupId");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingZone_shop_name_key" ON "ShippingZone"("shop", "name");
