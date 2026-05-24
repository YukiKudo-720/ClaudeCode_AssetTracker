// Pie chart 等で使うパレット。Wealth Navy 配色に調和した 10 色。
export const CHART_COLORS = [
  '#0B2545', // primary navy
  '#C9A227', // accent gold
  '#15803D', // positive green
  '#B91C1C', // negative red
  '#1B3358', // primary soft
  '#6BA4D4', // light blue
  '#6B9080', // sage
  '#D4AF8F', // champagne
  '#A07178', // mauve
  '#5B6B7E', // muted
];

export function pickColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}
