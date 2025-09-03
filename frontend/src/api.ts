import type { Nation, VehicleClass, TreeResponse, Vehicle, VehiclesFilter, UserProfile } from '@/types'

const ROOT = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '')
const API = ROOT.endsWith('/api') ? ROOT : `${ROOT}/api`

let AUTH: string | null = null

export function setAuthToken(tok: string | null) {
  AUTH = tok
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as any),
  }
  if (AUTH) headers['Authorization'] = `Bearer ${AUTH}`

  // pozwól wołać zarówno z "/api/xxx" jak i "/xxx"
  const url = path.startsWith('/api') ? `${ROOT}${path}` : `${API}${path}`

  const r = await fetch(url, { ...init, headers })
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const j = await r.json()
      if ((j as any)?.error) msg = (j as any).error
    } catch {}
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export const api = {
  // ---- słowniki / drzewo
  nations(): Promise<Nation[]> { return req('/nations') },
  classes(): Promise<VehicleClass[]> { return req('/classes') },
  ranks(): Promise<{ id: number; label: string }[]> { return req('/ranks') },

  tree(nation: string, vclass: string): Promise<TreeResponse> {
    const p = new URLSearchParams({ nation, class: vclass })
    return req(`/tree?${p.toString()}`)
  },

  vehicles(f: VehiclesFilter = {}): Promise<Vehicle[]> {
    const p = new URLSearchParams()
    if (f.nation) p.set('nation', f.nation)
    if (f.class) p.set('class', f.class)
    if (typeof f.rank === 'number') p.set('rank', String(f.rank))
    if (typeof f.rank_min === 'number') p.set('rank_min', String(f.rank_min))
    if (typeof f.rank_max === 'number') p.set('rank_max', String(f.rank_max))
    if (typeof f.br_min === 'number') p.set('br_min', String(f.br_min))
    if (typeof f.br_max === 'number') p.set('br_max', String(f.br_max))
    if (f.type) p.set('type', f.type)
    if (typeof f.exclude_variants === 'boolean') p.set('exclude_variants', f.exclude_variants ? '1' : '0')
    if (f.q) p.set('q', f.q)
    return req(`/vehicles?${p.toString()}`)
  },

  // ---- kalkulator
  calcEstimate(payload: any): Promise<any> {
    return req('/calc/estimate', { method: 'POST', body: JSON.stringify(payload) })
  },
  calcCascade(payload: any): Promise<any> {
    return req('/calc/cascade', { method: 'POST', body: JSON.stringify(payload) })
  },

  // ---- auth
  register(email: string, password: string): Promise<{ token: string; user: { id: number; email: string } }> {
    return req('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) })
  },
  login(email: string, password: string): Promise<{ token: string; user: { id: number; email: string } }> {
    return req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  },
  me(): Promise<{ user: { id: number; email: string } }> { return req('/auth/me') },
  logout(): Promise<{ ok: boolean }> { return req('/auth/logout', { method: 'POST' }) },

  // ---- profile (jeśli backend doda endpoints; nie używane w UI – zostawiam zgodnie z wcześniejszym interfejsem)
  getProfile(): Promise<UserProfile> { return req('/profile') },
  saveProfile(p: UserProfile): Promise<{ ok: boolean }> {
    return req('/profile', { method: 'PUT', body: JSON.stringify(p) })
  }
}
