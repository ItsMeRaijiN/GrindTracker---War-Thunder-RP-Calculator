import type { Nation, VehicleClass, TreeResponse, Vehicle, VehiclesFilter, UserProfile } from '@/types'

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
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
  const r = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export const api = {
  nations(): Promise<Nation[]> { return req('/api/nations') },
  classes(): Promise<VehicleClass[]> { return req('/api/classes') },
  ranks(): Promise<{id:number; label:string}[]> { return req('/api/ranks') },

  tree(nation: string, vclass: string): Promise<TreeResponse> {
    const p = new URLSearchParams({ nation, class: vclass })
    return req(`/api/tree?${p.toString()}`)
  },

  vehicles(f: VehiclesFilter): Promise<Vehicle[]> {
    const p = new URLSearchParams()
    if (f.nation) p.set('nation', f.nation)
    if (f.class) p.set('class', f.class)
    if (typeof f.rank === 'number') p.set('rank', String(f.rank))
    if (f.type) p.set('type', f.type)
    if (f.q) p.set('q', f.q)
    return req(`/api/vehicles?${p.toString()}`)
  },

  // ---- auth
  register(email: string, password: string): Promise<{token: string; user: {id:number; email:string}}> {
    return req('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) })
  },
  login(email: string, password: string): Promise<{token: string; user: {id:number; email:string}}> {
    return req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  },
  me(): Promise<{user: {id:number; email:string}}> { return req('/api/auth/me') },
  logout(): Promise<{ok: boolean}> { return req('/api/auth/logout', { method: 'POST' }) },

  // ---- profile
  getProfile(): Promise<UserProfile> { return req('/api/profile') },
  saveProfile(p: UserProfile): Promise<{ok: boolean}> {
    return req('/api/profile', { method: 'PUT', body: JSON.stringify(p) })
  },
}
