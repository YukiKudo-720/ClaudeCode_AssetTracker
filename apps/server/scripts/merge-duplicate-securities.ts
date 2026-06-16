// 重複 Security 行を canonical (= 最古) に統合する one-shot migration。
//
// 動作:
//   (symbol, currency) で group → 2 件以上ある group ごとに、createdAt 最古を canonical、
//   それ以外 (= duplicates) を canonical へ rebase してから delete。
//
//   rebase 対象の外部参照:
//     - Holding.securityId        (unique: accountId+securityId+subAccount)
//     - HoldingSnapshot           (Holding 経由なので Holding を rebase すれば追従)
//     - PriceSnapshot.securityId  (unique: securityId+capturedDate)
//     - Transaction.securityId    (unique: accountId+externalId; securityId は影響なし)
//     - Dividend.securityId       (unique: accountId+externalId; securityId は影響なし)
//     - SecurityCategory          (PK: securityId+categoryId; canonical に同じ category 既存なら skip)
//
//   exchange は canonical 側が null で duplicate が値持ちなら採用 (情報を捨てない)。
//
// 使い方:
//   tsx scripts/merge-duplicate-securities.ts          # dry-run (DB 書込なし、計画のみ表示)
//   tsx scripts/merge-duplicate-securities.ts --apply  # 実行

import '../src/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const securities = await prisma.security.findMany({
    orderBy: [{ symbol: 'asc' }, { createdAt: 'asc' }],
  });

  const byKey = new Map<string, typeof securities>();
  for (const s of securities) {
    const key = `${s.symbol}|${s.currency}`;
    const arr = byKey.get(key) ?? [];
    arr.push(s);
    byKey.set(key, arr);
  }

  const dupGroups = [...byKey.entries()].filter(([, arr]) => arr.length > 1);
  if (dupGroups.length === 0) {
    console.log('OK: 重複なし');
    return;
  }

  console.log(`重複 group: ${dupGroups.length} (mode=${APPLY ? 'APPLY' : 'dry-run'})\n`);

  for (const [key, arr] of dupGroups) {
    const [canonical, ...dups] = arr;
    if (!canonical) continue;
    console.log(`[${key}] canonical=${canonical.id} (exchange=${canonical.exchange ?? 'null'})`);

    for (const dup of dups) {
      console.log(`  merge from ${dup.id} (exchange=${dup.exchange ?? 'null'})`);

      // canonical の exchange を補完 (canonical が null かつ dup が値持ちの場合)
      let nextExchange = canonical.exchange;
      if (canonical.exchange == null && dup.exchange != null) {
        nextExchange = dup.exchange;
        console.log(`    plan: Security[${canonical.id}].exchange ${canonical.exchange ?? 'null'} -> ${dup.exchange}`);
      }

      // 影響範囲を集計
      const [holdings, prices, txs, divs, cats] = await Promise.all([
        prisma.holding.findMany({ where: { securityId: dup.id } }),
        prisma.priceSnapshot.findMany({ where: { securityId: dup.id } }),
        prisma.transaction.count({ where: { securityId: dup.id } }),
        prisma.dividend.count({ where: { securityId: dup.id } }),
        prisma.securityCategory.findMany({ where: { securityId: dup.id } }),
      ]);
      console.log(
        `    affects: holdings=${holdings.length} prices=${prices.length} txs=${txs} divs=${divs} cats=${cats.length}`,
      );

      if (!APPLY) continue;

      await prisma.$transaction(async (tx) => {
        // (1) Holding は (accountId, securityId, subAccount) unique。
        // dup の holding と同じ (accountId, subAccount) を持つ canonical 側の holding があれば
        // dup を canonical に統合 (HoldingSnapshot を rebase + dup holding を delete)。
        // なければ単純に securityId を canonical に切替。
        for (const h of holdings) {
          const existing = await tx.holding.findFirst({
            where: {
              accountId: h.accountId,
              securityId: canonical.id,
              subAccount: h.subAccount,
            },
          });
          if (existing) {
            // HoldingSnapshot を existing にリベース。同日 snapshot 衝突は dup 側を捨てる。
            const snaps = await tx.holdingSnapshot.findMany({ where: { holdingId: h.id } });
            for (const sn of snaps) {
              const clash = await tx.holdingSnapshot.findFirst({
                where: { holdingId: existing.id, capturedDate: sn.capturedDate },
              });
              if (clash) {
                await tx.holdingSnapshot.delete({ where: { id: sn.id } });
              } else {
                await tx.holdingSnapshot.update({
                  where: { id: sn.id },
                  data: { holdingId: existing.id },
                });
              }
            }
            await tx.holding.delete({ where: { id: h.id } });
          } else {
            await tx.holding.update({
              where: { id: h.id },
              data: { securityId: canonical.id },
            });
          }
        }

        // (2) PriceSnapshot: unique (securityId, capturedDate)。同日衝突は dup 側を捨てる。
        for (const p of prices) {
          const clash = await tx.priceSnapshot.findFirst({
            where: { securityId: canonical.id, capturedDate: p.capturedDate },
          });
          if (clash) {
            await tx.priceSnapshot.delete({ where: { id: p.id } });
          } else {
            await tx.priceSnapshot.update({
              where: { id: p.id },
              data: { securityId: canonical.id },
            });
          }
        }

        // (3) Transaction / Dividend: unique は (accountId, externalId)。securityId 影響なし。
        await tx.transaction.updateMany({
          where: { securityId: dup.id },
          data: { securityId: canonical.id },
        });
        await tx.dividend.updateMany({
          where: { securityId: dup.id },
          data: { securityId: canonical.id },
        });

        // (4) SecurityCategory: PK が (securityId, categoryId)。canonical に既存なら skip、無ければ rebase。
        for (const c of cats) {
          const existing = await tx.securityCategory.findUnique({
            where: { securityId_categoryId: { securityId: canonical.id, categoryId: c.categoryId } },
          });
          if (existing) {
            await tx.securityCategory.delete({
              where: { securityId_categoryId: { securityId: dup.id, categoryId: c.categoryId } },
            });
          } else {
            await tx.securityCategory.update({
              where: { securityId_categoryId: { securityId: dup.id, categoryId: c.categoryId } },
              data: { securityId: canonical.id },
            });
          }
        }

        // (5) dup Security を先に delete して (symbol, exchange) unique を解放してから
        // (6) canonical の exchange を更新 — 順番が逆だと P2002 で落ちる。
        await tx.security.delete({ where: { id: dup.id } });

        if (nextExchange !== canonical.exchange) {
          await tx.security.update({
            where: { id: canonical.id },
            data: { exchange: nextExchange },
          });
        }
      });

      console.log(`    done.`);
    }
  }

  if (!APPLY) {
    console.log('\n(dry-run) --apply を付けて実行すると上記を実施します。');
  } else {
    console.log('\nAPPLY 完了。');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
