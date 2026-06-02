import { useMemo, useState, useEffect, useRef, Fragment } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  useTodai,
  useCreateTodaiTag,
  useRenameTodaiTag,
  useDeleteTodaiTag,
  useAssignTodaiTag,
  useSetLeverage,
} from '../api/queries.js';
import { pickColor } from '../lib/colors.js';
import {
  ASSET_CLASS_LABELS,
  type AssetClass,
  type TodaiTag,
  type TodaiAsset,
  type TodaiBigGroup,
} from '@asset-tracker/shared';
import { Plus, Pencil, Trash2, Check, X, ChevronDown, ChevronUp } from 'lucide-react';

const GRAY = '#94a3b8';

function formatJpy(v: number): string {
  return `¥${v.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
}

// 640px 以下をモバイル扱い
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const h = (): void => setMobile(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return mobile;
}

// レバレッジ倍率 → 表示ラベル。現物=1, ブル=正, ベア=負
function leverageLabel(f: number): string {
  if (f === 1) return '現物';
  if (f > 0) return `${f}倍ブル`;
  return `${Math.abs(f)}倍ベア`;
}

function shortenName(name: string): string {
  return name.length <= 8 ? name : name.slice(0, 8) + '…';
}

// hex を白方向へ amount(0..1) ブレンド
function lighten(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[f(r), f(g), f(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function Todai() {
  const { data, isLoading, isError } = useTodai();
  const createTag = useCreateTodaiTag();
  const renameTag = useRenameTodaiTag();
  const deleteTag = useDeleteTodaiTag();
  const assign = useAssignTodaiTag();
  const setLev = useSetLeverage();

  const bigCats = useMemo(
    () => (data?.tags ?? []).filter((t) => t.parentId == null),
    [data],
  );
  const childrenOf = (id: string): TodaiTag[] =>
    (data?.tags ?? []).filter((t) => t.parentId === id);

  // 資産一覧を大カテゴリ別にグルーピング (未分類は最下部)。
  const tagById = useMemo(
    () => new Map((data?.tags ?? []).map((t) => [t.id, t])),
    [data],
  );
  const bigIdOf = (tagId: string | null): string | null => {
    if (!tagId) return null;
    const t = tagById.get(tagId);
    return t ? t.parentId ?? t.id : null;
  };
  // bigGroups は value 降順。未分類(null) を末尾へ。
  const orderedBigGroups = useMemo(() => {
    const gs = data?.bigGroups ?? [];
    return [...gs.filter((g) => g.tagId != null), ...gs.filter((g) => g.tagId == null)];
  }, [data]);

  // レバレッジ補正版 bigGroups: 各銘柄を |倍率|×評価額 で集計。
  // 並び順・色を非レバ版に揃える (どこが増えたか比較しやすく)。
  // 楽観的更新で assets が書き換わっても確実に再計算するよう deps を明示。
  const leveragedBigGroups = useMemo(() => {
    const lev = computeLeveragedBigGroups(data?.assets ?? [], data?.tags ?? []);
    return reorderToMatch(lev, data?.bigGroups ?? []);
  }, [data?.assets, data?.tags, data?.bigGroups]);

  // 実効エクスポージャー合計 (レバ込%計算用)
  const totalEff = useMemo(
    () => (data?.assets ?? []).reduce((s, a) => s + Math.abs(a.leverage) * a.valueJpy, 0),
    [data?.assets],
  );

  if (isLoading) return <p className="text-[var(--color-text-muted)]">読み込み中...</p>;
  if (isError || !data) return <p className="text-[var(--color-negative)]">API エラー</p>;

  return (
    <div className="space-y-6">
      <div className="text-sm text-[var(--color-text-muted)] flex justify-between items-baseline flex-wrap gap-2">
        <span>
          {data.tags.length} タグ / {data.assets.length} 資産 / 取得日 {data.capturedDate ?? '-'}
        </span>
        <span className="text-base text-[var(--color-text)] tabular-nums font-medium">
          総資産 {formatJpy(data.totalJpy)}
        </span>
      </div>

      {/* 2つのドーナツを PC では横並び (比較しやすく) / スマホは縦積み */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TagDonut bigGroups={data.bigGroups} title="タグ別配分 (内側=大 / 外側=小・総資産比)" />
        <TagDonut bigGroups={leveragedBigGroups} title="レバレッジ補正版 (実効エクスポージャー)" />
      </div>

      {/* 非レバ vs レバ込 の比較表 (順序統一・増加を強調) */}
      <ComparisonTable base={data.bigGroups} lev={leveragedBigGroups} />

      {/* 資産別タグ付け (大カテゴリ別にグループ化、未分類は最下部) */}
      <section>
        <h2 className="text-lg font-bold text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] pb-1 mb-3">
          資産別タグ付け
        </h2>
        <div className="space-y-5">
          {orderedBigGroups.map((bg) => {
            const groupAssets = data.assets
              .filter((a) => bigIdOf(a.tagId) === bg.tagId)
              .sort((x, y) => y.valueJpy - x.valueJpy);
            if (groupAssets.length === 0) return null;
            return (
              <div
                key={bg.tagId ?? 'untagged'}
                id={`todai-cat-${bg.tagId ?? 'untagged'}`}
                className="scroll-mt-20"
              >
                <div className="flex items-baseline justify-between mb-2 px-1 text-sm border-b border-[var(--color-border)] pb-1">
                  <span className="font-semibold">
                    {bg.name}{' '}
                    <span className="text-[var(--color-text-muted)] font-normal ml-1">
                      {groupAssets.length} 件
                    </span>
                  </span>
                  <span className="tabular-nums text-[var(--color-text-muted)]">
                    {formatJpy(bg.valueJpy)} ({(bg.ratio * 100).toFixed(1)}%)
                  </span>
                </div>
                <div className="space-y-2">
                  {groupAssets.map((a) => (
                    <AssetRow
                      key={a.securityId}
                      asset={a}
                      bigCats={bigCats}
                      childrenOf={childrenOf}
                      totalEff={totalEff}
                      disabled={assign.isPending}
                      onAssign={(tagId) => assign.mutate({ securityId: a.securityId, tagId })}
                      onSetLeverage={(leverage) =>
                        setLev.mutate({ securityId: a.securityId, leverage })
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* タグ管理 (2階層) — 末尾に配置 */}
      <TagManager
        bigCats={bigCats}
        childrenOf={childrenOf}
        onCreate={(name, parentId) => createTag.mutate({ name, parentId })}
        onRename={(id, name) => renameTag.mutate({ id, name })}
        onDelete={(id) => deleteTag.mutate(id)}
        creating={createTag.isPending}
      />
    </div>
  );
}

function AssetRow({
  asset: a,
  bigCats,
  childrenOf,
  totalEff,
  disabled,
  onAssign,
  onSetLeverage,
}: {
  asset: TodaiAsset;
  bigCats: TodaiTag[];
  childrenOf: (id: string) => TodaiTag[];
  totalEff: number;
  disabled: boolean;
  onAssign: (tagId: string | null) => void;
  onSetLeverage: (leverage: number) => void;
}) {
  const [levText, setLevText] = useState(String(a.leverage));
  const [open, setOpen] = useState(false);

  function commitLev(): void {
    const v = Number(levText);
    if (Number.isFinite(v) && v !== a.leverage) onSetLeverage(v);
  }

  const effJpy = Math.abs(a.leverage) * a.valueJpy;
  const effRatio = totalEff > 0 ? effJpy / totalEff : 0;
  const levLabelCls =
    a.leverage === 1
      ? 'text-[var(--color-text-muted)]'
      : 'text-[var(--color-accent)] font-medium';
  const pnl = a.unrealizedPnlJpy;
  const pnlRatio = a.unrealizedPnlRatio;
  const pnlCls = pnl == null
    ? ''
    : pnl >= 0
      ? 'text-[var(--color-positive)]'
      : 'text-[var(--color-negative)]';

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg">
      {/* メイン行 (常時表示) — レバ表示は文字のみ。入力と詳細は展開時 */}
      <div className="p-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-3 items-center sm:flex sm:items-center sm:gap-3">
        {/* 銘柄名 */}
        <div className="min-w-0 col-start-1 row-start-1 sm:flex-1">
          <div className="text-xs font-mono text-[var(--color-text-muted)]">
            {a.symbol} · {ASSET_CLASS_LABELS[a.assetClass as AssetClass] ?? a.assetClass}
          </div>
          <div className="font-medium truncate">{a.name}</div>
        </div>

        {/* 評価額 */}
        <div className="col-start-2 row-start-1 text-right tabular-nums whitespace-nowrap sm:row-auto sm:w-28 sm:shrink-0">
          <div className="font-semibold">{formatJpy(a.valueJpy)}</div>
          <div className="text-xs text-[var(--color-text-muted)]">{(a.ratio * 100).toFixed(2)}%</div>
        </div>

        {/* 下段ラッパ — mobile: 2:1:1 sub-grid / PC: contents で flex の続きに */}
        <div className="col-span-2 row-start-2 grid grid-cols-[2fr_1fr_1fr] gap-2 items-center sm:contents">
          {/* タグ選択 */}
          <select
            className="w-full px-2 py-1.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-sm sm:w-40 sm:shrink-0"
            value={a.tagId ?? ''}
            disabled={disabled}
            onChange={(e) => onAssign(e.target.value || null)}
          >
            <option value="">未分類</option>
            {bigCats.map((big) => {
              const kids = childrenOf(big.id);
              return (
                <optgroup key={big.id} label={big.name}>
                  <option value={big.id}>{big.name}（大分類のみ）</option>
                  {kids.map((k) => (
                    <option key={k.id} value={k.id}>
                      　{k.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>

          {/* レバ比率 (文字のみ) */}
          <div className={`text-center text-xs sm:text-sm sm:w-20 sm:shrink-0 ${levLabelCls}`}>
            {leverageLabel(a.leverage)}
          </div>

          {/* 展開トグル */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-full h-8 flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-primary)] sm:w-8 sm:shrink-0"
            aria-label={open ? '詳細を閉じる' : '詳細を開く'}
            aria-expanded={open}
          >
            {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
      </div>

      {/* 詳細 (折りたたみ) */}
      {open && (
        <div className="border-t border-[var(--color-border)] px-3 py-2 text-sm space-y-1.5">
          {/* レバ比率の編集 */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--color-text-muted)]">レバ比率</span>
            <div className="flex items-center gap-2">
              <span className={levLabelCls}>{leverageLabel(a.leverage)}</span>
              <input
                type="number"
                step="0.1"
                className="w-16 px-1 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-xs text-right tabular-nums"
                value={levText}
                disabled={disabled}
                onChange={(e) => setLevText(e.target.value)}
                onBlur={commitLev}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                title="現物=1, 3倍ブル=3, 3倍ベア=-3"
              />
            </div>
          </div>
          {/* レバ込 (実効エクスポージャー) */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--color-text-muted)]">レバ込</span>
            <span className="tabular-nums">
              {formatJpy(effJpy)}
              <span className="text-xs text-[var(--color-text-muted)] ml-2">
                ({(effRatio * 100).toFixed(2)}%)
              </span>
            </span>
          </div>
          {/* 損益 */}
          {pnl != null && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--color-text-muted)]">損益</span>
              <span className={`tabular-nums ${pnlCls}`}>
                {pnl >= 0 ? '+' : '−'}¥
                {Math.abs(pnl).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
                {pnlRatio != null && (
                  <span className="text-xs ml-2 opacity-80">
                    ({pnl >= 0 ? '+' : ''}
                    {(pnlRatio * 100).toFixed(2)}%)
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TagManager({
  bigCats,
  childrenOf,
  onCreate,
  onRename,
  onDelete,
  creating,
}: {
  bigCats: TodaiTag[];
  childrenOf: (id: string) => TodaiTag[];
  onCreate: (name: string, parentId: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  creating: boolean;
}) {
  const [newBig, setNewBig] = useState('');
  const [newChild, setNewChild] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  function commitEdit(): void {
    if (editingId && editingName.trim()) onRename(editingId, editingName.trim());
    setEditingId(null);
  }

  const renderName = (t: TodaiTag) =>
    editingId === t.id ? (
      <>
        <input
          className="w-28 bg-transparent border-b border-[var(--color-border)] focus:outline-none"
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditingId(null);
          }}
          autoFocus
        />
        <button onClick={commitEdit} className="text-[var(--color-positive)]">
          <Check size={14} />
        </button>
        <button onClick={() => setEditingId(null)} className="text-[var(--color-text-muted)]">
          <X size={14} />
        </button>
      </>
    ) : (
      <>
        <span className="flex-1 truncate">{t.name}</span>
        <button
          onClick={() => {
            setEditingId(t.id);
            setEditingName(t.name);
          }}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={() => {
            if (confirm(`「${t.name}」を削除しますか？ (配下の小カテゴリ・割当も解除されます)`)) {
              onDelete(t.id);
            }
          }}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-negative)]"
        >
          <Trash2 size={13} />
        </button>
      </>
    );

  return (
    <section>
      <h2 className="text-lg font-bold text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] pb-1 mb-3">
        タグ管理 (2階層)
      </h2>

      {/* 大カテゴリ追加 */}
      <div className="flex gap-2 mb-3">
        <input
          className="flex-1 px-3 py-2 border border-[var(--color-border)] rounded bg-[var(--color-bg-elevated)] text-sm"
          placeholder="新しい大カテゴリ名 (例: 半導体系)"
          value={newBig}
          onChange={(e) => setNewBig(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newBig.trim()) {
              onCreate(newBig.trim(), null);
              setNewBig('');
            }
          }}
        />
        <button
          onClick={() => {
            if (newBig.trim()) {
              onCreate(newBig.trim(), null);
              setNewBig('');
            }
          }}
          disabled={creating || !newBig.trim()}
          className="px-3 py-2 bg-[var(--color-primary)] text-white rounded text-sm flex items-center gap-1 disabled:opacity-50"
        >
          <Plus size={16} /> 大カテゴリ
        </button>
      </div>

      {bigCats.length === 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">タグがまだありません。</p>
      )}

      <ul className="space-y-3">
        {bigCats.map((big) => {
          const kids = childrenOf(big.id);
          const childVal = newChild[big.id] ?? '';
          return (
            <li
              key={big.id}
              className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-3"
            >
              <div className="flex items-center gap-2 text-sm font-medium">{renderName(big)}</div>

              {/* 小カテゴリ一覧 */}
              {kids.length > 0 && (
                <ul className="ml-4 mt-2 space-y-1 border-l border-[var(--color-border)] pl-3">
                  {kids.map((k) => (
                    <li key={k.id} className="flex items-center gap-2 text-sm">
                      {renderName(k)}
                    </li>
                  ))}
                </ul>
              )}

              {/* 小カテゴリ追加 */}
              <div className="flex gap-2 mt-2 ml-4">
                <input
                  className="flex-1 px-2 py-1 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-xs"
                  placeholder="小カテゴリ名 (例: AI半導体)"
                  value={childVal}
                  onChange={(e) => setNewChild((p) => ({ ...p, [big.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && childVal.trim()) {
                      onCreate(childVal.trim(), big.id);
                      setNewChild((p) => ({ ...p, [big.id]: '' }));
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (childVal.trim()) {
                      onCreate(childVal.trim(), big.id);
                      setNewChild((p) => ({ ...p, [big.id]: '' }));
                    }
                  }}
                  disabled={creating || !childVal.trim()}
                  className="px-2 py-1 border border-[var(--color-border)] rounded text-xs flex items-center gap-1 disabled:opacity-50"
                >
                  <Plus size={13} /> 小
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// 二重ドーナツ (内側=大カテゴリ / 外側=小カテゴリ) + 階層レジェンド。
// タグ別配分とレバレッジ補正版で共用。
function TagDonut({ bigGroups, title }: { bigGroups: TodaiBigGroup[]; title: string }) {
  const isMobile = useIsMobile();
  const RAD = Math.PI / 180;
  const LABEL_THRESHOLD = 0.03;

  const { innerData, outerData } = useMemo(() => {
    const inner: Array<{ name: string; value: number; ratio: number; color: string }> = [];
    const outer: Array<{ name: string; value: number; ratio: number; color: string }> = [];
    bigGroups.forEach((b, bi) => {
      const base = b.tagId == null ? GRAY : pickColor(bi);
      inner.push({ name: b.name, value: b.valueJpy, ratio: b.ratio, color: base });
      b.children.forEach((c, ci) => {
        outer.push({
          name: c.name,
          value: c.valueJpy,
          ratio: c.ratio,
          color: b.tagId == null ? GRAY : lighten(base, Math.min(0.55, 0.12 + ci * 0.18)),
        });
      });
    });
    return { innerData: inner, outerData: outer };
  }, [bigGroups]);

  // ラベル配置を pixel 確定後に1度だけ計算してキャッシュ (衝突回避)。
  // 各ラベルはスライスの自然な高さ付近に置き、重なる分だけ縦にずらす → 横に伸びる leader。
  const layoutCache = useRef<{ key: string; map: Map<number, { side: 'L' | 'R'; y: number }> } | null>(
    null,
  );

  function getLayout(cx: number, cy: number, outerR: number): Map<number, { side: 'L' | 'R'; y: number }> {
    const key = `${cx}|${cy}|${outerR}|${innerData.map((d) => d.value).join(',')}`;
    if (layoutCache.current?.key === key) return layoutCache.current.map;

    const total = innerData.reduce((s, d) => s + d.value, 0) || 1;
    let ang = 90;
    const mids = innerData.map((d) => {
      const span = (d.value / total) * -360;
      const mid = ang + span / 2;
      ang += span;
      return mid;
    });
    const r1 = outerR * 1.5; // ラベル基準の半径
    const minGap = isMobile ? 24 : 28;
    type P = { i: number; side: 'L' | 'R'; y: number };
    const pts: P[] = [];
    innerData.forEach((d, i) => {
      if (d.ratio < LABEL_THRESHOLD) return;
      const sin = Math.sin(-mids[i]! * RAD);
      const cos = Math.cos(-mids[i]! * RAD);
      pts.push({ i, side: cos >= 0 ? 'R' : 'L', y: cy + r1 * sin });
    });

    const map = new Map<number, { side: 'L' | 'R'; y: number }>();
    const topBound = cy - outerR * 1.7;
    const botBound = cy + outerR * 1.7;
    (['L', 'R'] as const).forEach((side) => {
      const arr = pts.filter((p) => p.side === side).sort((a, b) => a.y - b.y);
      // 上から押し下げて最小間隔を確保
      for (let i = 1; i < arr.length; i++) {
        if (arr[i]!.y < arr[i - 1]!.y + minGap) arr[i]!.y = arr[i - 1]!.y + minGap;
      }
      // 下にはみ出たら全体を上シフト
      const overflow = (arr[arr.length - 1]?.y ?? 0) - botBound;
      if (overflow > 0) for (const p of arr) p.y -= overflow;
      // 上にはみ出たらクランプ
      if ((arr[0]?.y ?? 0) < topBound) {
        const d = topBound - arr[0]!.y;
        for (const p of arr) p.y += d;
      }
      for (const p of arr) map.set(p.i, { side, y: p.y });
    });

    layoutCache.current = { key, map };
    return map;
  }

  function renderLabel(props: unknown): React.ReactNode {
    const p = props as {
      cx: number;
      cy: number;
      midAngle: number;
      outerRadius: number;
      index: number;
      name: string;
      payload: { ratio: number };
    };
    const meta = getLayout(p.cx, p.cy, p.outerRadius).get(p.index);
    if (!meta) return null;
    const cos = Math.cos(-p.midAngle * RAD);
    const sin = Math.sin(-p.midAngle * RAD);
    const dir = meta.side === 'R' ? 1 : -1;
    // 外側リング外縁から radial に少し出し、横方向にラベル列へ
    const p0x = p.cx + p.outerRadius * 1.42 * cos;
    const p0y = p.cy + p.outerRadius * 1.42 * sin;
    const elbowX = p.cx + dir * p.outerRadius * 1.56;
    const colX = p.cx + dir * p.outerRadius * 1.72;
    const textX = colX + dir * 4;
    const anchor = meta.side === 'R' ? 'start' : 'end';
    return (
      <g>
        <path
          d={`M${p0x},${p0y}L${elbowX},${meta.y}L${colX},${meta.y}`}
          stroke="var(--color-text-muted)"
          fill="none"
          strokeWidth={1}
        />
        <circle cx={colX} cy={meta.y} r={2} fill="var(--color-text-muted)" stroke="none" />
        <text
          x={textX}
          y={meta.y}
          textAnchor={anchor}
          dominantBaseline="middle"
          fontSize={isMobile ? 10 : 11}
          fill="var(--color-text)"
        >
          <tspan x={textX} dy="-0.45em">
            {shortenName(p.name)}
          </tspan>
          <tspan x={textX} dy="1.2em" className="tabular-nums">
            {(p.payload.ratio * 100).toFixed(1)}%
          </tspan>
        </text>
      </g>
    );
  }

  if (innerData.length === 0) return null;

  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)]">
      <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2">{title}</h3>
      <div className="h-72 sm:h-96">
        <ResponsiveContainer width="100%" height="100%">
          {/* ラベルは左右カラムに動的配置。余白は左右のみ確保し、ドーナツを大きく */}
          <PieChart
            margin={
              isMobile
                ? { top: 8, right: 58, bottom: 8, left: 58 }
                : { top: 12, right: 96, bottom: 12, left: 96 }
            }
          >
            <Pie
              data={innerData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="42%"
              outerRadius="62%"
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
              labelLine={false}
              label={renderLabel}
            >
              {innerData.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Pie
              data={outerData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="65%"
              outerRadius="86%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={0.5}
              isAnimationActive={false}
            >
              {outerData.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, _n, p) => {
                const ratio = (p.payload as { ratio: number }).ratio;
                return [`${formatJpy(v)} (${(ratio * 100).toFixed(1)}%)`, ''];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// レバレッジ補正版 bigGroups を assets から算出 (各銘柄 |倍率|×評価額)。
// API の bigGroups と同じグルーピングロジック。
function computeLeveragedBigGroups(
  assets: TodaiAsset[],
  tags: TodaiTag[],
): TodaiBigGroup[] {
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const nameById = new Map(tags.map((t) => [t.id, t.name]));
  const bigIdOf = (tagId: string | null): string | null =>
    tagId ? tagById.get(tagId)?.parentId ?? tagId : null;

  const total = assets.reduce((s, a) => s + Math.abs(a.leverage) * a.valueJpy, 0);

  const bigMap = new Map<
    string | null,
    { value: number; leaves: Map<string | null, { value: number; count: number }> }
  >();
  for (const a of assets) {
    const eff = Math.abs(a.leverage) * a.valueJpy;
    if (eff <= 0) continue;
    const bigKey = a.tagId == null ? null : bigIdOf(a.tagId);
    const leafKey = a.tagId;
    let big = bigMap.get(bigKey);
    if (!big) {
      big = { value: 0, leaves: new Map() };
      bigMap.set(bigKey, big);
    }
    big.value += eff;
    const leaf = big.leaves.get(leafKey) ?? { value: 0, count: 0 };
    leaf.value += eff;
    leaf.count += 1;
    big.leaves.set(leafKey, leaf);
  }

  const leafName = (bigKey: string | null, leafKey: string | null): string => {
    if (leafKey == null) return bigKey == null ? '未分類' : '（大分類のみ）';
    if (leafKey === bigKey) return '（大分類のみ）';
    return nameById.get(leafKey) ?? '(不明なタグ)';
  };

  return Array.from(bigMap.entries())
    .map(([bigKey, big]) => ({
      tagId: bigKey,
      name: bigKey == null ? '未分類' : nameById.get(bigKey) ?? '(不明なタグ)',
      valueJpy: big.value,
      ratio: total > 0 ? big.value / total : 0,
      children: Array.from(big.leaves.entries())
        .map(([leafKey, leaf]) => ({
          tagId: leafKey,
          name: leafName(bigKey, leafKey),
          valueJpy: leaf.value,
          ratio: total > 0 ? leaf.value / total : 0,
          count: leaf.count,
        }))
        .sort((a, b) => b.valueJpy - a.valueJpy),
    }))
    .sort((a, b) => b.valueJpy - a.valueJpy);
}

// lev の並び順・子順を base に揃える (色と位置を一致させ比較しやすく)。
function reorderToMatch(lev: TodaiBigGroup[], base: TodaiBigGroup[]): TodaiBigGroup[] {
  const bigIdx = new Map(base.map((g, i) => [g.tagId, i]));
  const childIdx = new Map(
    base.map((g) => [g.tagId, new Map(g.children.map((c, i) => [c.tagId, i]))]),
  );
  return [...lev]
    .sort((a, b) => (bigIdx.get(a.tagId) ?? 999) - (bigIdx.get(b.tagId) ?? 999))
    .map((g) => {
      const ci = childIdx.get(g.tagId);
      if (!ci) return g;
      return {
        ...g,
        children: [...g.children].sort(
          (a, b) => (ci.get(a.tagId) ?? 999) - (ci.get(b.tagId) ?? 999),
        ),
      };
    });
}

// レバ込みセル: ¥ + % (PC=1行 / スマホ=2行)。非レバ比率より増えていれば赤▲ / 減れば緑▼。
function DeltaCell({
  baseRatio,
  levRatio,
  levValueJpy,
}: {
  baseRatio: number;
  levRatio: number;
  levValueJpy: number;
}) {
  const up = levRatio > baseRatio + 0.0005;
  const down = levRatio < baseRatio - 0.0005;
  // 増加=赤で強調 / 減少=緑
  const cls = up
    ? 'text-[var(--color-negative)] font-semibold'
    : down
      ? 'text-[var(--color-positive)]'
      : 'text-[var(--color-text-muted)]';
  return (
    <div
      className={`tabular-nums ${cls} flex flex-col items-end sm:flex-row sm:items-center sm:gap-3 sm:justify-end`}
    >
      <span className="sm:w-28 sm:text-right">
        ¥{levValueJpy.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
      </span>
      <span className="text-xs sm:text-sm sm:w-20 sm:text-right">
        {(levRatio * 100).toFixed(1)}%{up ? ' ▲' : down ? ' ▼' : ''}
      </span>
    </div>
  );
}

// 非レバセル: ¥ + % (PC=1行・サブ列で揃え / スマホ=2行)
function BaseCell({ valueJpy, ratio }: { valueJpy: number; ratio: number }) {
  return (
    <div className="tabular-nums flex flex-col items-end sm:flex-row sm:items-center sm:gap-3 sm:justify-end">
      <span className="sm:w-28 sm:text-right">
        ¥{valueJpy.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
      </span>
      <span className="text-xs sm:text-sm sm:w-16 sm:text-right">
        {(ratio * 100).toFixed(1)}%
      </span>
    </div>
  );
}

// 非レバ vs レバ込 の配分比較表。base 順で並べ、増加カテゴリを強調。
function ComparisonTable({ base, lev }: { base: TodaiBigGroup[]; lev: TodaiBigGroup[] }) {
  const levBig = new Map(lev.map((g) => [g.tagId, g]));
  if (base.length === 0) return null;
  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)]">
      <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2">
        配分比較 (非レバ → レバ込 / 増加を強調)
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            <tr>
              <th className="py-1.5 pr-2">カテゴリ</th>
              <th className="py-1.5 px-2 text-right w-24 sm:w-48">非レバ</th>
              <th className="py-1.5 pl-2 text-right w-24 sm:w-52">レバ込</th>
            </tr>
          </thead>
          <tbody>
            {base.map((b, bi) => {
              const lg = levBig.get(b.tagId);
              const levRatio = lg?.ratio ?? 0;
              const levChild = new Map((lg?.children ?? []).map((c) => [c.tagId, c]));
              const color = b.tagId == null ? GRAY : pickColor(bi);
              const showChildren =
                b.children.length > 1 || (b.children[0] && b.children[0].tagId !== b.tagId);
              return (
                <Fragment key={b.tagId ?? 'untagged'}>
                  <tr className="border-t border-[var(--color-border)] font-medium">
                    <td className="py-1.5 pr-2">
                      <a
                        href={`#todai-cat-${b.tagId ?? 'untagged'}`}
                        onClick={(e) => {
                          e.preventDefault();
                          document
                            .getElementById(`todai-cat-${b.tagId ?? 'untagged'}`)
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="inline-flex items-center gap-2 hover:underline cursor-pointer"
                      >
                        <span
                          className="w-3 h-3 rounded-sm flex-shrink-0"
                          style={{ background: color }}
                        />
                        {b.name}
                      </a>
                    </td>
                    <td className="py-1.5 px-2 text-right align-top">
                      <BaseCell valueJpy={b.valueJpy} ratio={b.ratio} />
                    </td>
                    <td className="py-1.5 pl-2 text-right align-top">
                      <DeltaCell
                        baseRatio={b.ratio}
                        levRatio={levRatio}
                        levValueJpy={lg?.valueJpy ?? 0}
                      />
                    </td>
                  </tr>
                  {showChildren &&
                    b.children.map((c, ci) => {
                      const lc = levChild.get(c.tagId);
                      return (
                        <tr key={c.tagId ?? 'direct'} className="text-[var(--color-text-muted)]">
                          <td className="py-1 pr-2 pl-5">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                style={{
                                  background:
                                    b.tagId == null
                                      ? GRAY
                                      : lighten(color, Math.min(0.55, 0.12 + ci * 0.18)),
                                }}
                              />
                              {c.name}
                            </span>
                          </td>
                          <td className="py-1 px-2 text-right align-top">
                            <BaseCell valueJpy={c.valueJpy} ratio={c.ratio} />
                          </td>
                          <td className="py-1 pl-2 text-right align-top">
                            <DeltaCell
                              baseRatio={c.ratio}
                              levRatio={lc?.ratio ?? 0}
                              levValueJpy={lc?.valueJpy ?? 0}
                            />
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
