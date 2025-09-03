export type Nation = { id: number; slug: string; name: string; flag_url?: string | null }
export type VehicleClass = { id: number; name: string }

export type Vehicle = {
  id: number
  name: string
  nation: string
  class: string
  rank: number
  rank_label?: string
  type: 'tree' | 'premium' | 'collector'
  br?: { ab?: number | null; rb?: number | null; sb?: number | null }
  rp_cost?: number | null
  ge_cost?: number | null
    gjn_cost?: number | null
  image_url?: string | null
  wiki_url?: string | null
  folder_of?: number | null
}

export type Edge = { parent: number; child: number; unlock_rp?: number | null }

export type TreeResponse = {
  nodes: Vehicle[]
  edges: Edge[]
}

export type VehiclesFilter = {
  nation?: string
  class?: string
  rank?: number
  type?: 'tree' | 'premium' | 'collector'
  q?: string
}

export type UserProfile = {
  user_id?: number
  avg_rp_per_battle?: number | null
  avg_battle_minutes?: number | null
  has_premium: boolean
  booster_percent?: number | null
  skill_bonus_percent?: number | null
}
