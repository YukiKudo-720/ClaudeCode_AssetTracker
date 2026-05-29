// PWA → PC API クライアント
// 設定値 (API endpoint, Bearer token) は Settings 画面で localStorage に保存

const STORAGE_KEYS = {
  endpoint: 'asset-tracker.endpoint',
  token: 'asset-tracker.token',
} as const;

export function getEndpoint(): string {
  return localStorage.getItem(STORAGE_KEYS.endpoint) ?? '';
}

export function setEndpoint(value: string): void {
  localStorage.setItem(STORAGE_KEYS.endpoint, value);
}

export function getToken(): string {
  return localStorage.getItem(STORAGE_KEYS.token) ?? '';
}

export function setToken(value: string): void {
  localStorage.setItem(STORAGE_KEYS.token, value);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const endpoint = getEndpoint();
  const token = getToken();
  if (!token) {
    throw new ApiError(0, 'Settings 画面で Bearer Token を設定してください');
  }
  // endpoint 未設定 = 同一オリジン (Tailscale serve 経由等) を使う (relative URL)
  const url = endpoint ? endpoint.replace(/\/$/, '') + path : path;
  // Content-Type は body がある時のみ付与 (body 無し DELETE 等で
  // Fastify の FST_ERR_CTP_EMPTY_JSON_BODY を避ける)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init?.body != null) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as T;
}
