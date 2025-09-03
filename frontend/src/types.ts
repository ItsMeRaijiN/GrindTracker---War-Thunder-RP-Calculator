export type Nation = { id: number; slug: string; name: string; flag_url?: string | null }
export type VehicleClass = { id: number; name: string }

export type Vehicle = {
  id: number
  name: string
  nation: string
  class: string
  rank: number
  rank_label?: string | null
  type: 'tree' | 'premium' | 'collector'
  rp_cost?: number | null
  ge_cost?: number | null
  gjn_cost?: number | null
  br?: { ab?: number | null; rb?: number | null; sb?: number | null }
  image_url?: string | null
  wiki_url?: string | null
  folder_of?: number | null
}

export type Edge = { parent: number; child: number; unlock_rp?: number | null }

export type TreeResponse = {
  nodes: Vehicle[]
  edges: Edge[]
}
