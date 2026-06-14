import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AccountSummary,
  AllocationResponse,
  CategoriesResponse,
  FxRatesResponse,
  HistoryTotalResponse,
  HoldingsResponse,
  ScrapeRunSummary,
  TodaiResponse,
  TodaiTag,
} from '@asset-tracker/shared';
import { apiFetch } from './client.js';

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<AccountSummary[]>('/api/accounts'),
  });
}

export function useScrapeRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: () => apiFetch<ScrapeRunSummary[]>('/api/runs'),
  });
}

export function useHoldings() {
  return useQuery({
    queryKey: ['holdings'],
    queryFn: () => apiFetch<HoldingsResponse>('/api/holdings'),
  });
}

export function useAllocation(by: 'currency' | 'assetClass' | 'region' | 'institution') {
  return useQuery({
    queryKey: ['allocation', by],
    queryFn: () => apiFetch<AllocationResponse>(`/api/allocation?by=${by}`),
  });
}

export function useHistoryTotal(days: number = 90) {
  return useQuery({
    queryKey: ['history-total', days],
    queryFn: () => apiFetch<HistoryTotalResponse>(`/api/history/total?days=${days}`),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<CategoriesResponse>('/api/categories'),
  });
}

export function useFxRates() {
  return useQuery({
    queryKey: ['fx-rates'],
    queryFn: () => apiFetch<FxRatesResponse>('/api/fx/rates'),
  });
}

export function useTodai() {
  return useQuery({
    queryKey: ['todai'],
    queryFn: () => apiFetch<TodaiResponse>('/api/todai'),
  });
}

export function useCreateTodaiTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string | null }) =>
      apiFetch<TodaiTag>('/api/todai/tags', {
        method: 'POST',
        body: JSON.stringify({ name, parentId: parentId ?? null }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['todai'] }),
  });
}

export function useRenameTodaiTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<TodaiTag>(`/api/todai/tags/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['todai'] }),
  });
}

export function useDeleteTodaiTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/todai/tags/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['todai'] }),
  });
}

export function useAssignTodaiTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ securityId, tagId }: { securityId: string; tagId: string | null }) =>
      apiFetch<{ ok: boolean }>('/api/todai/assign', {
        method: 'PUT',
        body: JSON.stringify({ securityId, tagId }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['todai'] }),
  });
}

export function useSetLeverage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ securityId, leverage }: { securityId: string; leverage: number }) =>
      apiFetch<{ ok: boolean }>('/api/todai/leverage', {
        method: 'PUT',
        body: JSON.stringify({ securityId, leverage }),
      }),
    // 楽観的更新: assets の対象 leverage を即座に書き換えて再描画させる
    onMutate: async ({ securityId, leverage }) => {
      await qc.cancelQueries({ queryKey: ['todai'] });
      const previous = qc.getQueryData<TodaiResponse>(['todai']);
      if (previous) {
        qc.setQueryData<TodaiResponse>(['todai'], {
          ...previous,
          assets: previous.assets.map((a) =>
            a.securityId === securityId ? { ...a, leverage } : a,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['todai'], ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['todai'] }),
  });
}

export function useRunNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source?: string) =>
      apiFetch<{ runId: string; status: string }>('/api/run-now', {
        method: 'POST',
        body: JSON.stringify(source ? { source } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs'] });
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

// Pi 専用: WoL → SSH → PC で scrape:all + mf:push-webull を起こす。
// fire-and-forget。完了は /api/runs を polling して判定する。
export function useWakePc() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ status: string; startedAt: string }>('/api/wake-pc', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  });
}
