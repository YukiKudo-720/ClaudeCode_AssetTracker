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
  if (!endpoint || !token) {
    throw new ApiError(0, 'Settings 画面で endpoint と token を設定してください');
  }
  const url = endpoint.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as T;
}
