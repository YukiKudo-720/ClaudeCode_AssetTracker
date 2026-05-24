// 動作確認用: DB の状態を簡易ダンプ
import '../src/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const counts = {
  categories: await prisma.category.count(),
  accounts: await prisma.account.count(),
  securities: await prisma.security.count(),
  snapshots: await prisma.accountSnapshot.count(),
  runs: await prisma.scrapeRun.count(),
};
console.log('テーブル件数:', counts);

const sampleCats = await prisma.category.findMany({
  orderBy: { sortOrder: 'asc' },
  take: 5,
});
console.log('Category 先頭 5 件:');
for (const c of sampleCats) {
  console.log(`  [${c.sortOrder}] ${c.slug} = ${c.name}`);
}

await prisma.$disconnect();
