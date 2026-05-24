// MF の DOM 構造調査用スクリプト。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run mf:inspect
//
// 1. /accounts (口座一覧)
// 2. /bs/portfolio (資産ポートフォリオ)
// 3. /bs/balance_sheet (バランスシート)
// 4. /accounts/show/<id> (対象証券口座の詳細 — 楽天証券 / SBI証券)
//
// 各ページの screenshot + HTML を data/mf-inspect/ に保存。

import '../src/env.js'; // PLAYWRIGHT_BROWSERS_PATH を先に設定
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { MF_USER_DATA_DIR, MF_URLS } from '../src/adapters/moneyforward/profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', '..', '..', 'data', 'mf-inspect');
mkdirSync(outDir, { recursive: true });

if (!existsSync(MF_USER_DATA_DIR)) {
  console.error(`profile が無い: ${MF_USER_DATA_DIR}`);
  console.error('先に mf:login を実行してください');
  process.exit(1);
}

// 対象機関 (これ以外は MF にあっても adapter で無視)
const TARGET_BROKERAGES = ['楽天証券', 'SBI証券'] as const;
// 銀行は balance だけで良いので詳細ページは v1 では不要

console.log('--- MF 構造調査 ---');
console.log(`出力先: ${outDir}\n`);

const context = await chromium.launchPersistentContext(MF_USER_DATA_DIR, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
});

const page = context.pages()[0] ?? (await context.newPage());

async function dumpPage(url: string, slug: string): Promise<string> {
  console.log(`[*] ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000); // 動的レンダリング待ち
  await page.screenshot({ path: path.join(outDir, `${slug}.png`), fullPage: true });
  const html = await page.content();
  writeFileSync(path.join(outDir, `${slug}.html`), html, 'utf8');
  console.log(`    -> ${slug}.png + ${slug}.html (${(html.length / 1024).toFixed(0)} KB)`);
  return html;
}

// 1. ログイン状態チェック
console.log('[1] ログイン状態を検証中...');
await page.goto(MF_URLS.home, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
if (page.url().includes('sign_in') || page.url().includes('id.moneyforward.com')) {
  console.error('  ❌ 未ログイン状態。mf:login を再実行してください');
  await context.close();
  process.exit(1);
}
console.log('  ✅ ログイン済み\n');

// 2. /accounts (口座一覧) — 既に取得済みかもだが上書き
const accountsHtml = await dumpPage(MF_URLS.accounts, 'accounts');

// 3. /bs/portfolio (資産ポートフォリオ)
await dumpPage('https://moneyforward.com/bs/portfolio', 'bs-portfolio');

// 4. /bs/balance_sheet (BS)
await dumpPage('https://moneyforward.com/bs/balance_sheet', 'bs-balance-sheet');

// 5. 対象証券口座の詳細ページ (accounts.html から ID を抽出)
console.log('\n[2] 対象証券口座の詳細ページを取得中...');
const idMatchPattern = /\/accounts\/show\/([A-Za-z0-9_-]+)">([^<]+)</g;
const allIds: Array<{ id: string; name: string }> = [];
for (const m of accountsHtml.matchAll(idMatchPattern)) {
  allIds.push({ id: m[1]!, name: m[2]! });
}

for (const target of TARGET_BROKERAGES) {
  const hit = allIds.find((x) => x.name === target);
  if (!hit) {
    console.warn(`  ⚠️  ${target} の ID が見つかりません`);
    continue;
  }
  const slug = `account-${target.replace(/[^A-Za-z0-9]/g, '_').toLowerCase()}`;
  await dumpPage(`https://moneyforward.com/accounts/show/${hit.id}`, slug);
}

console.log('\n--- 完了 ---');
console.log(`次: ${outDir} の中身を Claude に共有`);
await context.close();
