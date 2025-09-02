import type { Nation, VehicleClass, Rank, TreeResponse } from './types'

const BASE = import.meta.env.VITE_API_BASE_URL || '' // przy dev użyjemy proxy, więc wystarczy ścieżka względna

async function get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL((BASE.endsWith('/') ? BASE.slice(0, -1) : BASE) + path, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  const r = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<T>
}

export const api = {
  nations: () => get<Nation[]>('/api/nations'),
  classes: () => get<VehicleClass[]>('/api/classes'),
  ranks: () => get<Rank[]>('/api/ranks'),
  tree: (nation: string, vclass: string) =>
    get<TreeResponse>('/api/tree', { nation, class: vclass })
}
