import React from 'react'

type Props = {
  q: string
  setQ: (s: string) => void
  rank: number | ''
  setRank: (r: number | '') => void
  vtype: 'all' | 'tree' | 'premium' | 'collector'
  setVtype: (t: 'all' | 'tree' | 'premium' | 'collector') => void
  ranks: { id: number; label: string }[]
}

function FiltersBar({ q, setQ, rank, setRank, vtype, setVtype, ranks }: Props) {
  return (
    <div className="rounded-lg border border-white/10 p-3 bg-neutral-950">
      <h3 className="text-sm font-semibold mb-2">Wyszukiwarka i filtry</h3>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          className="rounded bg-neutral-900 border border-white/15 px-3 py-2 text-sm md:col-span-2"
          placeholder="Szukaj po nazwie…"
          aria-label="Szukaj pojazdu"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select
          className="rounded bg-neutral-900 border border-white/15 px-3 py-2 text-sm"
          aria-label="Filtr: era"
          value={rank}
          onChange={(e) => setRank(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Wszystkie ery</option>
          {ranks.map((r) => (
            <option key={r.id} value={r.id}>
              Era {r.label}
            </option>
          ))}
        </select>

        <select
          className="rounded bg-neutral-900 border border-white/15 px-3 py-2 text-sm"
          aria-label="Filtr: typ pojazdu"
          value={vtype}
          onChange={(e) => setVtype(e.target.value as Props['vtype'])}
        >
          <option value="all">Wszystkie typy</option>
          <option value="tree">Drzewkowe</option>
          <option value="premium">Premium</option>
          <option value="collector">Kolekcjonerskie</option>
        </select>
      </div>
    </div>
  )
}

export default React.memo(FiltersBar)
