import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AccountSummary,
  AllocationResponse,
  CategoriesResponse,
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
