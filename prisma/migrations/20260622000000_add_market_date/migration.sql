-- HoldingSnapshot に marketDate カラムを追加 (市場別 1 日の境界を持つ)。
-- 日本株 = JST 9:00 区切り、米株 = ET 0:00 区切り。
-- 既存行は capturedDate と同値で backfill する。

-- Step 1: nullable で追加
ALTER TABLE "HoldingSnapshot" ADD COLUMN "marketDate" TEXT;

-- Step 2: 既存行は capturedDate と同値に
UPDATE "HoldingSnapshot" SET "marketDate" = "capturedDate";

-- Step 3: 既存の unique index (holdingId, capturedDate) を削除し、
--         新 unique index (holdingId, marketDate) を作成
DROP INDEX IF EXISTS "HoldingSnapshot_holdingId_capturedDate_key";
CREATE UNIQUE INDEX "HoldingSnapshot_holdingId_marketDate_key"
  ON "HoldingSnapshot"("holdingId", "marketDate");

-- Step 4: 検索用 index も追加 (capturedDate の既存 index は schema に残してあるので維持)
CREATE INDEX "HoldingSnapshot_holdingId_marketDate_idx"
  ON "HoldingSnapshot"("holdingId", "marketDate");
