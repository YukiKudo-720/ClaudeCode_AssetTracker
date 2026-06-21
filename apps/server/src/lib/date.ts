// JST タイムゾーンで "YYYY-MM-DD" 文字列を返す。
// capturedDate の bucket キーに使う (同日 upsert の判定軸)。
export function toJstDateString(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date); // en-CA ロケールは "YYYY-MM-DD" 形式を返す
}

// 米株: ET タイムゾーンの日付。サマータイム自動追従。
// 例: JST 6/22 22:00 = UTC 13:00 = ET 8:00 (冬) → '2026-06-22'
//     JST 6/23 14:00 (= ET 0:00 冬) → '2026-06-23' (= 米株翌日に切替)
function toEtDateString(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

// 銘柄の「市場別 1 日」の境界に基づく日付。
//
// 日本株 (region='jp' or その他): JST 9:00 で日付変更
//   日本市場 Open = 翌日のデータ。JST 9:00 直前までは前日扱いになる。
//   例: JST 6/23 8:30 → '2026-06-22' (= まだ 6/22 のデータ)
//
// 米株 (region='us'): ET 0:00 で日付変更 (= ET タイムゾーン日付、サマータイム自動)
//   例: JST 6/23 8:30 = ET 18:30 前日 (冬) → '2026-06-22' (= ET 6/22)
//
// この設計により、scrape をいつ実行しても (深夜含む) 銘柄ごとに「市場の今日」が
// 正しい日付として記録される。
export function toMarketDateString(date: Date, region: string | null): string {
  if (region === 'us') return toEtDateString(date);
  // 日本株 (jp / その他) は JST 9h オフセット
  const shifted = new Date(date.getTime() - 9 * 60 * 60 * 1000);
  return toJstDateString(shifted);
}
