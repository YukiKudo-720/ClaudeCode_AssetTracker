import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AccountSummary, ScrapeRunSummary } from '@asset-tracker/shared';
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
