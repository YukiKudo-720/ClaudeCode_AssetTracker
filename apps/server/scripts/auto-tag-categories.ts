// 既存の Security に対して、銘柄コード/名前から themes を自動付与する一回限りの
// バッチスクリプト。何度実行しても upsert で冪等。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server exec tsx scripts/auto-tag-categories.ts
//
// ユーザーが手動で SecurityCategory を編集した内容は触らない (upsert で source='user' は維持)。

import '../src/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// symbol → category slug の配列 (1 銘柄が複数テーマに属することは普通)
const SYMBOL_TO_THEMES: Record<string, string[]> = {
  // US semiconductor / AI
  NVDA: ['semiconductor', 'ai', 'mega_tech'],
  AMD: ['semiconductor', 'ai'],
  INTC: ['semiconductor'],
  AVGO: ['semiconductor', 'ai'],
  TSM: ['semiconductor'],
  ASML: ['semiconductor'],
  MU: ['semiconductor'],
  SOXL: ['semiconductor'],
  ARMG: ['semiconductor'],
  SNDK: ['semiconductor'],
  // US mega tech
  AAPL: ['mega_tech'],
  MSFT: ['mega_tech', 'cloud', 'ai'],
  GOOG: ['mega_tech', 'ai', 'cloud'],
  GOOGL: ['mega_tech', 'ai', 'cloud'],
  AMZN: ['mega_tech', 'cloud'],
  META: ['mega_tech', 'ai'],
  TSLA: ['mega_tech', 'ev', 'ai'],
  NFLX: ['mega_tech'],
  // AI 専業
  PLTR: ['ai'],
  // 原発・ウラン
  OKLO: ['nuclear_uranium'],
  SMR: ['nuclear_uranium'],
  CCJ: ['nuclear_uranium'],
  // ドローン
  UMAC: ['drone'],
  UAVS: ['drone'],
  // 電力インフラ (AI データセンター需要)
  VRT: ['power_infrastructure', 'ai'],
  PWR: ['power_infrastructure'],
  // 量子関連
  IONQ: ['quantum', 'quantum_computer'],
  RGTI: ['quantum', 'quantum_computer'],
  QBTS: ['quantum', 'quantum_computer'],
  ARQQ: ['quantum', 'quantum_computer'],
  // 宇宙
  RKLB: ['space'],
  ASTS: ['space'],
  // 光通信
  CIEN: ['optical_communication'],
  AAOI: ['optical_communication'],
  FORM: ['semiconductor', 'optical_communication'],
  // 防衛
  LMT: ['defense'],
  RTX: ['defense'],
  // 通信
  T: ['telecom'],
  VZ: ['telecom'],
  // 金融
  JPM: ['finance'],
  GS: ['finance'],
  FUTU: ['finance', 'mega_tech'],
  // ETF: 高配当・連続増配
  VIG: ['high_dividend', 'dividend_growth'],
  SCHD: ['high_dividend', 'dividend_growth'],
  // ETF: 広範
  VTI: ['mega_tech'],
  VOO: ['mega_tech'],
  QQQ: ['mega_tech', 'semiconductor', 'ai'],
  // ETF: 金属
  SLV: ['silver', 'non_ferrous_metals'],
  GLD: ['gold'],
  NUGT: ['gold'],
  PAAS: ['silver', 'non_ferrous_metals'],
  // ETF: 債券
  BND: [], // 米国総合債券 (テーマなし)
  // その他特殊
  DAL: [], // デルタ航空
  ZM: ['cloud'],
  EBIZ: ['mega_tech'],
  CIEN_TEMP_DUP: [],

  // JP - 4 桁
  '6613': ['quantum_computer', 'optical_communication'], // QDレーザ
  '5801': ['optical_communication'], // 古河電工
  '5802': ['optical_communication'], // 住友電工
  '5803': ['optical_communication'], // フジクラ
  '4980': ['semiconductor'], // デクセリアルズ
  '4186': ['semiconductor'], // 東応化
  '9501': ['power_infrastructure'], // 東京電力
  '1540': ['gold'], // 純金信託
  '1570': [], // NF日経レバ (broad)
  '7203': [], // トヨタ
  '6758': ['mega_tech'], // ソニー
  '6861': [], // キーエンス
  '8035': ['semiconductor'], // 東京エレクトロン
  '6920': ['semiconductor'], // レーザーテック
  '6857': ['semiconductor'], // アドバンテスト
};

// 投信銘柄名のパターンマッチ
function autoTagMutualFundByName(name: string): string[] {
  const tags = new Set<string>();
  if (/S&P\s*500/i.test(name)) tags.add('mega_tech');
  if (/全世界|オルカン|オール・?カントリー/i.test(name)) tags.add('mega_tech');
  if (/NASDAQ\s*100|ナスダック100/i.test(name)) {
    tags.add('mega_tech');
    tags.add('semiconductor');
    tags.add('ai');
  }
  if (/ダウ/i.test(name)) tags.add('mega_tech');
  if (/半導体|セミコンダクター/i.test(name)) tags.add('semiconductor');
  if (/AI|人工知能/i.test(name)) tags.add('ai');
  if (/ロボティクス|ロボット/i.test(name)) tags.add('ai');
  if (/量子/i.test(name)) tags.add('quantum');
  if (/光通信/i.test(name)) tags.add('optical_communication');
  if (/EV|電気自動車/i.test(name)) tags.add('ev');
  if (/再生|再エネ|クリーン.*エネルギ|風力|太陽/i.test(name)) tags.add('renewable_energy');
  if (/原発|原子力|ウラン/i.test(name)) tags.add('nuclear_uranium');
  if (/ドローン/i.test(name)) tags.add('drone');
  if (/宇宙/i.test(name)) tags.add('space');
  if (/高配当/i.test(name)) tags.add('high_dividend');
  if (/連続増配|配当成長/i.test(name)) tags.add('dividend_growth');
  if (/J-REIT|JREIT|リート|REIT/i.test(name)) tags.add('real_estate');
  if (/銅\b/i.test(name)) tags.add('copper');
  if (/銀\b|シルバー/i.test(name)) tags.add('silver');
  if (/(金\b|ゴールド)/i.test(name) && !/債|債券|現金/.test(name)) tags.add('gold');
  if (/レアアース/i.test(name)) tags.add('rare_earth');
  if (/防衛|ディフェンス/i.test(name)) tags.add('defense');
  if (/バイオ|医薬|ヘルスケア/i.test(name)) tags.add('biotech_pharma');
  if (/インフラ/i.test(name)) tags.add('infrastructure');
  if (/電力|送電|電気事業/i.test(name)) tags.add('power_infrastructure');
  if (/クラウド/i.test(name)) tags.add('cloud');
  if (/通信/i.test(name)) tags.add('telecom');
  if (/金融/i.test(name)) tags.add('finance');
  if (/エマージング|新興国/i.test(name)) {
    // no specific theme, but broadly represents EM exposure
  }
  return Array.from(tags);
}

async function main() {
  // 全 Category を slug→id でマップ化
  const cats = await prisma.category.findMany();
  const slugToId = new Map(cats.map((c) => [c.slug, c.id]));

  const securities = await prisma.security.findMany();
  let touched = 0;
  let totalLinks = 0;

  for (const sec of securities) {
    // 現金 (assetClass='cash') はテーマ対象外
    if (sec.assetClass === 'cash') continue;

    let slugs: string[] = [];
    if (sec.assetClass === 'mutual_fund') {
      slugs = autoTagMutualFundByName(sec.name);
    } else {
      slugs = SYMBOL_TO_THEMES[sec.symbol] ?? [];
    }
    if (slugs.length === 0) continue;

    for (const slug of slugs) {
      const catId = slugToId.get(slug);
      if (!catId) {
        console.warn(`unknown category slug: ${slug} (security ${sec.symbol})`);
        continue;
      }
      await prisma.securityCategory.upsert({
        where: {
          securityId_categoryId: { securityId: sec.id, categoryId: catId },
        },
        update: {}, // 既存は触らない (weight や user 編集を維持)
        create: {
          securityId: sec.id,
          categoryId: catId,
          weight: 1.0,
          source: 'auto',
        },
      });
      totalLinks += 1;
    }
    touched += 1;
  }

  console.log(`Tagged ${touched} securities with ${totalLinks} category links`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
