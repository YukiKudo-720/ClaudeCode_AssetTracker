-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "credentialRef" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "meta" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Security" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT,
    "isin" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "region" TEXT,
    "sector" TEXT,
    "industry" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'theme',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SecurityCategory" (
    "securityId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "weight" DECIMAL NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'user',
    "notedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("securityId", "categoryId"),
    CONSTRAINT "SecurityCategory_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SecurityCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "subAccount" TEXT,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Holding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Holding_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "capturedDate" TEXT NOT NULL,
    "totalValueNative" DECIMAL NOT NULL,
    "totalValueJpy" DECIMAL NOT NULL,
    "cashNative" DECIMAL NOT NULL,
    "cashJpy" DECIMAL NOT NULL,
    "fxRate" DECIMAL,
    "rawJson" TEXT,
    CONSTRAINT "AccountSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HoldingSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "capturedDate" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "marketPriceNative" DECIMAL NOT NULL,
    "marketPriceJpy" DECIMAL NOT NULL,
    "marketValueNative" DECIMAL NOT NULL,
    "marketValueJpy" DECIMAL NOT NULL,
    "avgCostNative" DECIMAL,
    "unrealizedPnlNative" DECIMAL,
    "unrealizedPnlJpy" DECIMAL,
    CONSTRAINT "HoldingSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AccountSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HoldingSnapshot_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "securityId" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "capturedDate" TEXT NOT NULL,
    "priceNative" DECIMAL NOT NULL,
    "priceJpy" DECIMAL NOT NULL,
    CONSTRAINT "PriceSnapshot_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "capturedDate" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "securityId" TEXT,
    "type" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "settledAt" DATETIME,
    "quantity" DECIMAL,
    "priceNative" DECIMAL,
    "amountNative" DECIMAL NOT NULL,
    "feeNative" DECIMAL,
    "taxNative" DECIMAL,
    "amountJpy" DECIMAL NOT NULL,
    "fxRate" DECIMAL,
    "currency" TEXT NOT NULL,
    "subAccount" TEXT,
    "externalId" TEXT,
    "note" TEXT,
    "rawJson" TEXT,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dividend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "exDate" DATETIME,
    "recordDate" DATETIME,
    "paidAt" DATETIME NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "dividendPerShare" DECIMAL NOT NULL,
    "grossNative" DECIMAL NOT NULL,
    "taxNative" DECIMAL NOT NULL,
    "netNative" DECIMAL NOT NULL,
    "netJpy" DECIMAL NOT NULL,
    "fxRate" DECIMAL,
    "currency" TEXT NOT NULL,
    "subAccount" TEXT,
    "externalId" TEXT,
    "rawJson" TEXT,
    CONSTRAINT "Dividend_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dividend_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "errorMsg" TEXT,
    "accountsTouched" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_institution_label_key" ON "Account"("institution", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Security_symbol_exchange_key" ON "Security"("symbol", "exchange");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "SecurityCategory_categoryId_idx" ON "SecurityCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_accountId_securityId_subAccount_key" ON "Holding"("accountId", "securityId", "subAccount");

-- CreateIndex
CREATE INDEX "AccountSnapshot_accountId_capturedAt_idx" ON "AccountSnapshot"("accountId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSnapshot_accountId_capturedDate_key" ON "AccountSnapshot"("accountId", "capturedDate");

-- CreateIndex
CREATE INDEX "HoldingSnapshot_holdingId_capturedDate_idx" ON "HoldingSnapshot"("holdingId", "capturedDate");

-- CreateIndex
CREATE UNIQUE INDEX "HoldingSnapshot_holdingId_capturedDate_key" ON "HoldingSnapshot"("holdingId", "capturedDate");

-- CreateIndex
CREATE INDEX "PriceSnapshot_securityId_capturedAt_idx" ON "PriceSnapshot"("securityId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSnapshot_securityId_capturedDate_key" ON "PriceSnapshot"("securityId", "capturedDate");

-- CreateIndex
CREATE INDEX "FxRate_base_quote_capturedAt_idx" ON "FxRate"("base", "quote", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_base_quote_capturedDate_key" ON "FxRate"("base", "quote", "capturedDate");

-- CreateIndex
CREATE INDEX "Transaction_accountId_occurredAt_idx" ON "Transaction"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_securityId_occurredAt_idx" ON "Transaction"("securityId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_accountId_externalId_key" ON "Transaction"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "Dividend_securityId_paidAt_idx" ON "Dividend"("securityId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dividend_accountId_externalId_key" ON "Dividend"("accountId", "externalId");
