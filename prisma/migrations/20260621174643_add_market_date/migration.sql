/*
  Warnings:

  - Added the required column `marketDate` to the `HoldingSnapshot` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "MfAccountStatus" (
    "institution" TEXT NOT NULL PRIMARY KEY,
    "inProgress" BOOLEAN NOT NULL,
    "hasError" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "lastUpdated" TEXT,
    "checkedAt" DATETIME NOT NULL,
    "phase" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HoldingSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "capturedDate" TEXT NOT NULL,
    "marketDate" TEXT NOT NULL,
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
INSERT INTO "new_HoldingSnapshot" ("avgCostNative", "capturedDate", "holdingId", "id", "marketPriceJpy", "marketPriceNative", "marketValueJpy", "marketValueNative", "quantity", "snapshotId", "unrealizedPnlJpy", "unrealizedPnlNative") SELECT "avgCostNative", "capturedDate", "holdingId", "id", "marketPriceJpy", "marketPriceNative", "marketValueJpy", "marketValueNative", "quantity", "snapshotId", "unrealizedPnlJpy", "unrealizedPnlNative" FROM "HoldingSnapshot";
DROP TABLE "HoldingSnapshot";
ALTER TABLE "new_HoldingSnapshot" RENAME TO "HoldingSnapshot";
CREATE INDEX "HoldingSnapshot_holdingId_marketDate_idx" ON "HoldingSnapshot"("holdingId", "marketDate");
CREATE INDEX "HoldingSnapshot_holdingId_capturedDate_idx" ON "HoldingSnapshot"("holdingId", "capturedDate");
CREATE UNIQUE INDEX "HoldingSnapshot_holdingId_marketDate_key" ON "HoldingSnapshot"("holdingId", "marketDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
