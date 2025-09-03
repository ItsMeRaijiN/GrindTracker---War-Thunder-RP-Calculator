import type { Nation, VehicleClass } from './types'

export type Rank = { id: number; label: string }
export type LoginResult = { token: string; user: { id: number; email: string } }

const BASE = import.meta.env.VITE_API_BASE_URL || ''

let authToken: string | null = null
export function setAuthToken(token: string | null) {
  authToken = token
  if (token) sessionStorage.setItem('gt_jwt', token)
  else sessionStorage.removeItem('gt_jwt')
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL((BASE.endsWith('/') ? BASE.slice(0, -1) : BASE) + path, window.location.origin)
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (init?.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`

  const r = await fetch(url.toString(), { ...init, headers: { ...headers, ...(init?.headers || {}) } })
  const isJson = r.headers.get('content-type')?.includes('application/json')
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    if (isJson) {
      try { const j: any = await r.json(); msg = j?.error || msg } catch {}
    }
    throw new Error(msg)
  }
  return (isJson ? r.json() : (undefined as any)) as Promise<T>
}

const get = <T,>(p: string, q?: Record<string, string | number | boolean | undefined>) => {
  const url = new URL((BASE.endsWith('/') ? BASE.slice(0, -1) : BASE) + p, window.location.origin)
  if (q) Object.entries(q).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)) })
  return request<T>(url.pathname + url.search)
}
const post = <T,>(p: string, body?: any) =>
  request<T>(p, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) })

export const api = {
  nations: () => get<Nation[]>('/api/nations'),
  classes: () => get<VehicleClass[]>('/api/classes'),
  ranks: () => get<Rank[]>('/api/ranks'),
  tree: (nation: string, vclass: string) =>
    get('/api/tree', { nation, class: vclass }),

  // --- auth ---
  register: (email: string, password: string) =>
    post<LoginResult>('/api/auth/register', { email, password }),
  login: (email: string, password: string) =>
    post<LoginResult>('/api/auth/login', { email, password }),
  me: () => get<{ user: { id: number; email: string } }>('/api/auth/me'),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
}
