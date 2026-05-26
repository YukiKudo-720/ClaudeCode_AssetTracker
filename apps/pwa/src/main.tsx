import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import './index.css';

// API キャッシュは 24h 効かせる (PC スリープ中も最後の値を表示するため)
const ONE_DAY = 24 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      gcTime: ONE_DAY,
      retry: 1,
    },
  },
});

// IndexedDB に React Query キャッシュを永続化 (リロード/オフライン時も保持)
const idbPersister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: 'asset-tracker-rq-cache',
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root not found');

createRoot(rootElement).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: idbPersister,
        maxAge: ONE_DAY,
        buster: 'v1',
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
);
