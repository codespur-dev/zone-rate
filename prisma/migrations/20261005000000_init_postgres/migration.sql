-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT NOT NULL,
    "rateType" TEXT NOT NULL,
    "rateSetupId" INTEGER,
    "flatRateName" TEXT,
    "flatRatePrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "shopifyProfileId" TEXT,
    "shopifyLocationGroupId" TEXT,
    "shopifyZoneId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateSetup" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initialWeight" DOUBLE PRECISION NOT NULL,
    "weightDifference" DOUBLE PRECISION NOT NULL,
    "maxWeight" DOUBLE PRECISION NOT NULL,
    "initialRate" DOUBLE PRECISION NOT NULL,
    "rateDifference" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateRow" (
    "id" SERIAL NOT NULL,
    "rateSetupId" INTEGER NOT NULL,
    "minimumWeight" DOUBLE PRECISION NOT NULL,
    "maximumWeight" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RateRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "planId" TEXT,
    "subscriptionId" TEXT,
    "subscriptionStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShippingZone_shop_idx" ON "ShippingZone"("shop");

-- CreateIndex
CREATE INDEX "ShippingZone_rateSetupId_idx" ON "ShippingZone"("rateSetupId");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingZone_shop_name_key" ON "ShippingZone"("shop", "name");

-- CreateIndex
CREATE INDEX "RateSetup_shop_idx" ON "RateSetup"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "RateSetup_shop_name_key" ON "RateSetup"("shop", "name");

-- CreateIndex
CREATE INDEX "RateRow_rateSetupId_idx" ON "RateRow"("rateSetupId");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shop_key" ON "Shop"("shop");

-- AddForeignKey
ALTER TABLE "ShippingZone" ADD CONSTRAINT "ShippingZone_rateSetupId_fkey" FOREIGN KEY ("rateSetupId") REFERENCES "RateSetup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateRow" ADD CONSTRAINT "RateRow_rateSetupId_fkey" FOREIGN KEY ("rateSetupId") REFERENCES "RateSetup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
