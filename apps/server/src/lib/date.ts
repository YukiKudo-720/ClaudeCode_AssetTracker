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
