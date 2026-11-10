import { errorText } from './errors';

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function gatewayUrl(): string {
  const explicit = import.meta.env.VITE_GATEWAY_URL as string | undefined;
  if (explicit) return explicit;
  if (API_BASE) return `${API_BASE.replace(/^http/, 'ws')}/gateway`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gateway`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields: Record<string, string> = {},
  ) {
    super(code);
  }

  /** Localized message for a field, or for the whole error when `field` is omitted. */
  text(field?: string): string | undefined {
    if (field) return this.fields[field] ? errorText(this.fields[field]) : undefined;
    const first = Object.values(this.fields)[0];
    return errorText(first ?? this.code);
  }
}

const TOKEN_KEY = 'dcpoint-token';
let token: string | null = localStorage.getItem(TOKEN_KEY);
let onUnauthorized: (() => void) | null = null;

export const auth = {
  get token() {
    return token;
  },
  set(t: string | null) {
    token = t;
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  },
  onUnauthorized(cb: () => void) {
    onUnauthorized = cb;
  },
};

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, data?.code ?? 'UNKNOWN', data?.errors ?? {});
  }
  return data as T;
}

export const http = {
  get: <T>(path: string) => api<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => api<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => api<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => api<T>('PUT', path, body),
  delete: <T>(path: string) => api<T>('DELETE', path),
};
