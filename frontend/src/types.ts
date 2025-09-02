export type Nation = {
  id: number
  slug: string
  name: string
  flag_url: string | null
}

export type VehicleClass = {
  id: number
  name: 'army' | 'helicopter' | 'aviation' | 'coastal' | 'bluewater' | string
}

export type Rank = {
  id: number
  label: string
}

export type Vehicle = {
  id: number
  name: string
  nation: string
  class: string
  rank: number
  rank_label: string
  type: 'tree' | 'premium' | 'collector'
  br: { ab: number | null; rb: number | null; sb: number | null }
  rp_cost: number | null
  ge_cost: number | null
  image_url: string | null
  wiki_url: string | null
}

export type Edge = {
  parent: number
  child: number
  unlock_rp?: number | null
}

export type TreeResponse = {
  nodes: Vehicle[]
  edges: Edge[]
}
