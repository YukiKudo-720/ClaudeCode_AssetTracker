import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AccountSummary,
  AllocationResponse,
  HistoryTotalResponse,
  HoldingsResponse,
  ScrapeRunSummary,
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
