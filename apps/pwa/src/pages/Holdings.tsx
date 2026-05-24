export function Holdings() {
  return (
    <div className="text-[var(--color-text-muted)]">
      <p>銘柄横断ビュー (実装予定)</p>
      <p className="text-sm mt-2">
        Holding + HoldingSnapshot を Security 単位で集約。同一銘柄を複数証券で持つ場合は合算表示。
      </p>
    </div>
  );
}
