-- CreateTable
CREATE TABLE "RateSetup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initialWeight" REAL NOT NULL,
    "weightDifference" REAL NOT NULL,
    "maxWeight" REAL NOT NULL,
    "initialRate" REAL NOT NULL,
    "rateDifference" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RateRow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rateSetupId" INTEGER NOT NULL,
    "minimumWeight" REAL NOT NULL,
    "maximumWeight" REAL NOT NULL,
    "rate" REAL NOT NULL,
    CONSTRAINT "RateRow_rateSetupId_fkey" FOREIGN KEY ("rateSetupId") REFERENCES "RateSetup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RateSetup_shop_idx" ON "RateSetup"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "RateSetup_shop_name_key" ON "RateSetup"("shop", "name");

-- CreateIndex
CREATE INDEX "RateRow_rateSetupId_idx" ON "RateRow"("rateSetupId");
