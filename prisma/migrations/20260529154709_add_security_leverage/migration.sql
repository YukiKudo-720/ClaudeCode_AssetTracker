-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Security" (
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
    "leverage" REAL NOT NULL DEFAULT 1,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Security" ("assetClass", "createdAt", "currency", "exchange", "id", "industry", "isin", "meta", "name", "region", "sector", "symbol", "tags", "updatedAt") SELECT "assetClass", "createdAt", "currency", "exchange", "id", "industry", "isin", "meta", "name", "region", "sector", "symbol", "tags", "updatedAt" FROM "Security";
DROP TABLE "Security";
ALTER TABLE "new_Security" RENAME TO "Security";
CREATE UNIQUE INDEX "Security_symbol_exchange_key" ON "Security"("symbol", "exchange");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
