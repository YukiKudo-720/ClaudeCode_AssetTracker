import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const TODAI_KIND = 'todai';

// 1銘柄=1タグの排他グルーピング (現金含む全資産)。
// タグは Category(kind='todai') を流用、割当は SecurityCategory(weight=1) で 1 銘柄 1 リンクを強制。
export function registerTodaiRoutes(app: FastifyInstance): void {
  // 集計 + 全資産 + タグ一覧
  app.get('/api/todai', async () => {
    const latest = await prisma.holdingSnapshot.findFirst({
      orderBy: { capturedDate: 'desc' },
      select: { capturedDate: true },
    });

    const tagRows = await prisma.category.findMany({
      where: { kind: TODAI_KIND },
      orderBy: { sortOrder: 'asc' },
    });
    const tags = tagRows.map((t) => ({
      id: t.id,
      name: t.name,
      sortOrder: t.sortOrder,
      parentId: t.parentId,
    }));
    const byId = new Map(tagRows.map((t) => [t.id, t]));
    // タグの大カテゴリ id を返す (自身が大なら自身、小なら parentId)
    const bigIdOf = (tagId: string): string => byId.get(tagId)?.parentId ?? tagId;

    if (!latest) {
      return { capturedDate: null, totalJpy: 0, tags, bigGroups: [], assets: [] };
    }

    const snapshots = await prisma.holdingSnapshot.findMany({
      where: { capturedDate: latest.capturedDate },
      include: {
        holding: {
          include: {
            security: { include: { categories: { include: { category: true } } } },
            account: true,
          },
        },
      },
    });

    // (symbol, currency) 単位に集約 (口座またぎ + adapter ごとの exchange 差を吸収) + todai タグ抽出。
    // canonical (= 最古の Security) を採用するため createdAt 昇順でソートしてから iterate。
    snapshots.sort(
      (x, y) =>
        x.holding.security.createdAt.getTime() - y.holding.security.createdAt.getTime(),
    );
    interface AccountBreakdown {
      accountId: string;
      institution: string;
      label: string;
      quantity: number;
      avgCostNative: number | null;
      valueJpy: number;
      costJpy: number;
    }
    interface SecAgg {
      securityId: string; // canonical (= 最古) の Security.id
      symbol: string;
      currency: string;
      name: string;
      assetClass: string;
      totalQuantity: number;
      valueJpy: number;
      costJpy: number;
      tagId: string | null;
      leverage: number;
      accounts: AccountBreakdown[];
    }
    const secMap = new Map<string, SecAgg>();
    for (const hs of snapshots) {
      const sec = hs.holding.security;
      const a = hs.holding.account;
      const v = Number(hs.marketValueJpy);
      const qty = Number(hs.quantity);
      const priceNative = Number(hs.marketPriceNative);
      const avgCostNative = hs.avgCostNative != null ? Number(hs.avgCostNative) : null;
      // 簡易 fx: 価値JPY / (数量 × 単価native)
      const fx = qty > 0 && priceNative > 0 ? v / (qty * priceNative) : 1;
      const cost = avgCostNative != null ? avgCostNative * qty * fx : 0;
      const key = `${sec.symbol}|${sec.currency}`;
      let agg = secMap.get(key);
      if (!agg) {
        const todaiLink = sec.categories.find((c) => c.category.kind === TODAI_KIND);
        agg = {
          securityId: sec.id,
          symbol: sec.symbol,
          currency: sec.currency,
          name: sec.name,
          assetClass: sec.assetClass,
          totalQuantity: 0,
          valueJpy: 0,
          costJpy: 0,
          tagId: todaiLink?.categoryId ?? null,
          leverage: sec.leverage,
          accounts: [],
        };
        secMap.set(key, agg);
      } else if (agg.tagId == null) {
        // canonical が未タグでも、他の duplicate Security が既にタグ付けされていれば採用
        const todaiLink = sec.categories.find((c) => c.category.kind === TODAI_KIND);
        if (todaiLink) agg.tagId = todaiLink.categoryId;
      }
      agg.totalQuantity += qty;
      agg.valueJpy += v;
      agg.costJpy += cost;
      agg.accounts.push({
        accountId: a.id,
        institution: a.institution,
        label: a.label,
        quantity: qty,
        avgCostNative,
        valueJpy: v,
        costJpy: cost,
      });
    }

    const totalJpy = Array.from(secMap.values()).reduce((s, a) => s + a.valueJpy, 0);

    const assets = Array.from(secMap.values())
      .map((a) => ({
        securityId: a.securityId,
        symbol: a.symbol,
        name: a.name,
        assetClass: a.assetClass,
        currency: a.currency,
        valueJpy: a.valueJpy,
        ratio: totalJpy > 0 ? a.valueJpy / totalJpy : 0,
        tagId: a.tagId,
        leverage: a.leverage,
        totalQuantity: a.totalQuantity,
        totalCostJpy: a.costJpy,
        unrealizedPnlJpy: a.costJpy > 0 ? a.valueJpy - a.costJpy : null,
        unrealizedPnlRatio: a.costJpy > 0 ? (a.valueJpy - a.costJpy) / a.costJpy : null,
        accounts: a.accounts
          .map((acc) => ({
            ...acc,
            unrealizedPnlJpy: acc.costJpy > 0 ? acc.valueJpy - acc.costJpy : null,
            unrealizedPnlRatio:
              acc.costJpy > 0 ? (acc.valueJpy - acc.costJpy) / acc.costJpy : null,
          }))
          .sort((x, y) => y.valueJpy - x.valueJpy),
      }))
      .sort((a, b) => b.valueJpy - a.valueJpy);

    // 2階層グルーピング: bigKey -> { valueJpy, children: leafKey -> {valueJpy,count} }
    interface BigAgg {
      valueJpy: number;
      children: Map<string | null, { valueJpy: number; count: number }>;
    }
    const bigMap = new Map<string | null, BigAgg>();
    for (const a of secMap.values()) {
      const bigKey = a.tagId == null ? null : bigIdOf(a.tagId);
      const leafKey = a.tagId; // 大直接割当なら leafKey===bigKey、未分類なら null
      let big = bigMap.get(bigKey);
      if (!big) {
        big = { valueJpy: 0, children: new Map() };
        bigMap.set(bigKey, big);
      }
      big.valueJpy += a.valueJpy;
      const leaf = big.children.get(leafKey) ?? { valueJpy: 0, count: 0 };
      leaf.valueJpy += a.valueJpy;
      leaf.count += 1;
      big.children.set(leafKey, leaf);
    }

    const nameById = new Map(tagRows.map((t) => [t.id, t.name]));
    const leafName = (bigKey: string | null, leafKey: string | null): string => {
      if (leafKey == null) return bigKey == null ? '未分類' : '（大分類のみ）';
      if (leafKey === bigKey) return '（大分類のみ）'; // 大カテゴリに直接割当
      return nameById.get(leafKey) ?? '(不明なタグ)';
    };

    const bigGroups = Array.from(bigMap.entries())
      .map(([bigKey, big]) => ({
        tagId: bigKey,
        name: bigKey == null ? '未分類' : nameById.get(bigKey) ?? '(不明なタグ)',
        valueJpy: big.valueJpy,
        ratio: totalJpy > 0 ? big.valueJpy / totalJpy : 0,
        children: Array.from(big.children.entries())
          .map(([leafKey, leaf]) => ({
            tagId: leafKey,
            name: leafName(bigKey, leafKey),
            valueJpy: leaf.valueJpy,
            ratio: totalJpy > 0 ? leaf.valueJpy / totalJpy : 0,
            count: leaf.count,
          }))
          .sort((a, b) => b.valueJpy - a.valueJpy),
      }))
      .sort((a, b) => b.valueJpy - a.valueJpy);

    return { capturedDate: latest.capturedDate, totalJpy, tags, bigGroups, assets };
  });

  // タグ作成 (parentId 指定で小カテゴリ)
  const CreateTagBody = z.object({
    name: z.string().min(1).max(40),
    parentId: z.string().nullable().optional(),
  });
  app.post('/api/todai/tags', async (req, reply) => {
    const parsed = CreateTagBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() });
    }
    const parentId = parsed.data.parentId ?? null;
    if (parentId != null) {
      const parent = await prisma.category.findUnique({ where: { id: parentId } });
      if (!parent || parent.kind !== TODAI_KIND) {
        return reply.code(400).send({ error: 'invalid_parent' });
      }
      // 2階層まで: 親が既に小カテゴリ (parentId 有) なら拒否
      if (parent.parentId != null) {
        return reply.code(400).send({ error: 'max_depth_exceeded' });
      }
    }
    const maxOrder = await prisma.category.aggregate({
      where: { kind: TODAI_KIND },
      _max: { sortOrder: true },
    });
    const slug = `todai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const created = await prisma.category.create({
      data: {
        slug,
        kind: TODAI_KIND,
        name: parsed.data.name.trim(),
        parentId,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 10,
      },
    });
    return reply.code(201).send({
      id: created.id,
      name: created.name,
      sortOrder: created.sortOrder,
      parentId: created.parentId,
    });
  });

  // タグ改名
  const RenameTagBody = z.object({ name: z.string().min(1).max(40) });
  app.patch<{ Params: { id: string } }>('/api/todai/tags/:id', async (req, reply) => {
    const parsed = RenameTagBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() });
    }
    const cat = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!cat || cat.kind !== TODAI_KIND) {
      return reply.code(404).send({ error: 'tag_not_found' });
    }
    const updated = await prisma.category.update({
      where: { id: req.params.id },
      data: { name: parsed.data.name.trim() },
    });
    return {
      id: updated.id,
      name: updated.name,
      sortOrder: updated.sortOrder,
      parentId: updated.parentId,
    };
  });

  // タグ削除 (大カテゴリなら子カテゴリも cascade。割当リンクも除去)
  app.delete<{ Params: { id: string } }>('/api/todai/tags/:id', async (req, reply) => {
    const cat = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!cat || cat.kind !== TODAI_KIND) {
      return reply.code(404).send({ error: 'tag_not_found' });
    }
    // 自身 + 子カテゴリ id を集める
    const children = await prisma.category.findMany({
      where: { parentId: req.params.id },
      select: { id: true },
    });
    const ids = [req.params.id, ...children.map((c) => c.id)];
    await prisma.securityCategory.deleteMany({ where: { categoryId: { in: ids } } });
    await prisma.category.deleteMany({ where: { id: { in: ids } } });
    return { ok: true, deleted: ids.length };
  });

  // 銘柄へのタグ割当 (tagId=null でクリア)。1 銘柄 1 todai タグを強制。
  const AssignBody = z.object({
    securityId: z.string().min(1),
    tagId: z.string().nullable(),
  });
  app.put('/api/todai/assign', async (req, reply) => {
    const parsed = AssignBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() });
    }
    const { securityId, tagId } = parsed.data;

    // 既存の todai 割当を全削除
    await prisma.securityCategory.deleteMany({
      where: { securityId, category: { kind: TODAI_KIND } },
    });

    if (tagId != null) {
      const cat = await prisma.category.findUnique({ where: { id: tagId } });
      if (!cat || cat.kind !== TODAI_KIND) {
        return reply.code(404).send({ error: 'tag_not_found' });
      }
      await prisma.securityCategory.create({
        data: { securityId, categoryId: tagId, weight: 1, source: 'user' },
      });
    }
    return { ok: true };
  });

  // 銘柄のレバレッジ倍率を更新 (現物=1, ブル=正, ベア=負)
  const LeverageBody = z.object({
    securityId: z.string().min(1),
    leverage: z.number().finite(),
  });
  app.put('/api/todai/leverage', async (req, reply) => {
    const parsed = LeverageBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() });
    }
    const sec = await prisma.security.findUnique({ where: { id: parsed.data.securityId } });
    if (!sec) {
      return reply.code(404).send({ error: 'security_not_found' });
    }
    await prisma.security.update({
      where: { id: parsed.data.securityId },
      data: { leverage: parsed.data.leverage },
    });
    return { ok: true };
  });
}
