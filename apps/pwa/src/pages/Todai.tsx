import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  useTodai,
  useCreateTodaiTag,
  useRenameTodaiTag,
  useDeleteTodaiTag,
  useAssignTodaiTag,
} from '../api/queries.js';
import { pickColor } from '../lib/colors.js';
import { ASSET_CLASS_LABELS, type AssetClass, type TodaiTag } from '@asset-tracker/shared';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';

const GRAY = '#94a3b8';

function formatJpy(v: number): string {
  return `¥${v.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
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

  const bigCats = useMemo(
    () => (data?.tags ?? []).filter((t) => t.parentId == null),
    [data],
  );
  const childrenOf = (id: string): TodaiTag[] =>
    (data?.tags ?? []).filter((t) => t.parentId === id);

  // 内側 (大) / 外側 (小) リングのデータ。配列順を揃えてリングを整合させる。
  const { innerData, outerData } = useMemo(() => {
    const inner: Array<{ name: string; value: number; ratio: number; color: string }> = [];
    const outer: Array<{ name: string; value: number; ratio: number; color: string }> = [];
    (data?.bigGroups ?? []).forEach((b, bi) => {
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
  }, [data]);

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

      {/* 二重ドーナツ */}
      {innerData.length > 0 && (
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)]">
          <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2">
            タグ別配分 (内側=大カテゴリ / 外側=小カテゴリ・総資産比)
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <Pie
                  data={innerData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="32%"
                  outerRadius="55%"
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
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
                  innerRadius="58%"
                  outerRadius="78%"
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

          {/* 階層レジェンド */}
          <ul className="mt-2 text-xs space-y-1">
            {data.bigGroups.map((b, bi) => {
              const base = b.tagId == null ? GRAY : pickColor(bi);
              return (
                <li key={b.tagId ?? 'untagged'}>
                  <div className="flex items-center gap-2 font-medium">
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ background: base }}
                    />
                    <span className="flex-1 truncate">{b.name}</span>
                    <span className="tabular-nums">{formatJpy(b.valueJpy)}</span>
                    <span className="tabular-nums text-[var(--color-text-muted)] w-14 text-right">
                      {(b.ratio * 100).toFixed(1)}%
                    </span>
                  </div>
                  {b.children.length > 1 || (b.children[0] && b.children[0].tagId !== b.tagId) ? (
                    <ul className="ml-5 mt-0.5 space-y-0.5">
                      {b.children.map((c, ci) => (
                        <li
                          key={c.tagId ?? 'direct'}
                          className="flex items-center gap-2 text-[var(--color-text-muted)]"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                            style={{
                              background:
                                b.tagId == null
                                  ? GRAY
                                  : lighten(base, Math.min(0.55, 0.12 + ci * 0.18)),
                            }}
                          />
                          <span className="flex-1 truncate">{c.name}</span>
                          <span className="tabular-nums">{formatJpy(c.valueJpy)}</span>
                          <span className="tabular-nums w-14 text-right">
                            {(c.ratio * 100).toFixed(1)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* タグ管理 (2階層) */}
      <TagManager
        bigCats={bigCats}
        childrenOf={childrenOf}
        onCreate={(name, parentId) => createTag.mutate({ name, parentId })}
        onRename={(id, name) => renameTag.mutate({ id, name })}
        onDelete={(id) => deleteTag.mutate(id)}
        creating={createTag.isPending}
      />

      {/* 資産別タグ付け */}
      <section>
        <h2 className="text-lg font-bold text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] pb-1 mb-3">
          資産別タグ付け
        </h2>
        <div className="space-y-2">
          {data.assets.map((a) => (
            <div
              key={a.securityId}
              className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-3 flex items-center gap-3 flex-wrap"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-[var(--color-text-muted)]">
                  {a.symbol} · {ASSET_CLASS_LABELS[a.assetClass as AssetClass] ?? a.assetClass}
                </div>
                <div className="font-medium truncate">{a.name}</div>
              </div>
              <div className="text-right tabular-nums whitespace-nowrap">
                <div className="font-semibold">{formatJpy(a.valueJpy)}</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {(a.ratio * 100).toFixed(2)}%
                </div>
              </div>
              <select
                className="px-2 py-1.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)] text-sm min-w-36"
                value={a.tagId ?? ''}
                disabled={assign.isPending}
                onChange={(e) =>
                  assign.mutate({ securityId: a.securityId, tagId: e.target.value || null })
                }
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
            </div>
          ))}
        </div>
      </section>
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
