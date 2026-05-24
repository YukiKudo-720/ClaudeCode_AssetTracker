// Prisma seed: 投資テーマ Category の初期データ投入。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run db:seed
//
// 冪等 (upsert)。slug をキーに既存があれば name/sortOrder を更新、なければ作成。
// ユーザーがアプリ上で削除・編集した Category は touch しない (slug が異なるため)。

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedTheme {
  slug: string;
  name: string;
  description?: string;
  sortOrder: number;
}

// グルーピングのため sortOrder を 10 刻みで配置 (後で間に挿入する余地を残す)
const THEMES: SeedTheme[] = [
  // テック
  { slug: 'semiconductor',         name: '半導体',           sortOrder: 10 },
  { slug: 'mega_tech',             name: 'メガテック',       sortOrder: 20 },
  { slug: 'ai',                    name: 'AI',               sortOrder: 30 },
  { slug: 'cloud',                 name: 'クラウド',         sortOrder: 40 },
  { slug: 'quantum',               name: '量子',             sortOrder: 50 },
  { slug: 'quantum_computer',      name: '量子コンピュータ', sortOrder: 60, description: '量子の中でも特に計算機系' },
  { slug: 'drone',                 name: 'ドローン',         sortOrder: 70 },
  // 通信・インフラ・宇宙
  { slug: 'optical_communication', name: '光通信',           sortOrder: 100 },
  { slug: 'telecom',               name: '通信',             sortOrder: 110 },
  { slug: 'infrastructure',        name: 'インフラ',         sortOrder: 120 },
  { slug: 'power_infrastructure',  name: '電力インフラ',     sortOrder: 130 },
  { slug: 'space',                 name: '宇宙',             sortOrder: 140 },
  // エネルギー
  { slug: 'renewable_energy',      name: '再生エネルギー',   sortOrder: 200 },
  { slug: 'energy',                name: 'エネルギー',       sortOrder: 210 },
  { slug: 'nuclear_uranium',       name: '原発・ウラン',     sortOrder: 220 },
  // 素材・金属
  { slug: 'materials',             name: '素材',             sortOrder: 300 },
  { slug: 'non_ferrous_metals',    name: '非鉄金属',         sortOrder: 310 },
  { slug: 'copper',                name: '銅関連',           sortOrder: 320 },
  { slug: 'silver',                name: '銀関連',           sortOrder: 330 },
  { slug: 'gold',                  name: '金関連',           sortOrder: 340 },
  { slug: 'rare_earth',            name: 'レアアース',       sortOrder: 350 },
  // 産業・防衛
  { slug: 'ev',                    name: 'EV',               sortOrder: 400 },
  { slug: 'industrial_machinery',  name: '産業機械',         sortOrder: 410 },
  { slug: 'defense',               name: '防衛',             sortOrder: 420 },
  // ディフェンシブ
  { slug: 'biotech_pharma',        name: 'バイオ・医薬',     sortOrder: 500 },
  { slug: 'consumer_goods',        name: '消費財',           sortOrder: 510 },
  { slug: 'real_estate',           name: '不動産',           sortOrder: 520 },
  // 金融
  { slug: 'finance',               name: '金融',             sortOrder: 600 },
  // 投資スタイル
  { slug: 'etf_mutual_fund',       name: 'ETF・投信',        sortOrder: 700 },
  { slug: 'high_dividend',         name: '高配当',           sortOrder: 710 },
  { slug: 'dividend_growth',       name: '連続増配',         sortOrder: 720 },
];

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;
  for (const t of THEMES) {
    const existing = await prisma.category.findUnique({ where: { slug: t.slug } });
    await prisma.category.upsert({
      where: { slug: t.slug },
      update: {
        name: t.name,
        sortOrder: t.sortOrder,
        ...(t.description ? { description: t.description } : {}),
      },
      create: {
        slug: t.slug,
        kind: 'theme',
        name: t.name,
        sortOrder: t.sortOrder,
        ...(t.description ? { description: t.description } : {}),
      },
    });
    if (existing) updated += 1;
    else created += 1;
  }
  console.log(`Seeded ${THEMES.length} categories: ${created} created, ${updated} updated`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
