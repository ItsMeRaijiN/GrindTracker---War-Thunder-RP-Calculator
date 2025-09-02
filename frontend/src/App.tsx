import React, { useEffect, useMemo, useState } from 'react'
import { api } from '@/api'
import type { Nation, VehicleClass } from '@/types'
import TreeCanvas from '@/components/TreeCanvas'
import PremiumShelf from '@/components/PremiumShelf'

export default function App() {
  const [nations, setNations] = useState<Nation[]>([])
  const [classes, setClasses] = useState<VehicleClass[]>([])
  const [nation, setNation] = useState<string>('')   // slug
  const [vclass, setVclass] = useState<string>('')   // name
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tree, setTree] = useState<Awaited<ReturnType<typeof api.tree>> | null>(null)

  // słowniki na start
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [ns, cs] = await Promise.all([api.nations(), api.classes()])
        if (!mounted) return
        setNations(ns)
        setClasses(cs)
        setNation(ns[0]?.slug || '')
        setVclass(cs.find(c => c.name === 'army')?.name || cs[0]?.name || '')
      } catch (e: any) {
        setError(e?.message ?? String(e))
      }
    })()
    return () => { mounted = false }
  }, [])

  // drzewko przy zmianie selekcji
  useEffect(() => {
    if (!nation || !vclass) return
    setLoading(true)
    setError(null)
    api.tree(nation, vclass)
      .then(setTree)
      .catch(e => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false))
  }, [nation, vclass])

  // dane do półek premium
  const premiumAndCollectors = useMemo(
    () => (tree?.nodes ?? []).filter(n => n.type !== 'tree'),
    [tree]
  )

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100">
      {/* Topbar */}
      <header className="sticky top-0 z-10 border-b border-white/10 bg-neutral-900/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <h1 className="font-semibold">GrindTracker – War Thunder RP Calculator</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs opacity-70 hidden sm:inline">
              API: {import.meta.env.VITE_API_BASE_URL}
            </span>
            <button className="rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/5">
              Zaloguj
            </button>
          </div>
        </div>
      </header>

      {/* Panel wyboru */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-end mb-4">
          <div className="flex-1">
            <label className="block text-xs opacity-70 mb-1">Nacja</label>
            <select
              className="w-full rounded-lg bg-neutral-950 border border-white/15 px-3 py-2"
              value={nation}
              onChange={e => setNation(e.target.value)}
            >
              {nations.map(n => <option key={n.id} value={n.slug}>{n.name}</option>)}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-xs opacity-70 mb-1">Typ pojazdu</label>
            <select
              className="w-full rounded-lg bg-neutral-950 border border-white/15 px-3 py-2"
              value={vclass}
              onChange={e => setVclass(e.target.value)}
            >
              {classes.map(c => <option key={c.id} value={c.name}>{labelForClass(c.name)}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-3">
            {loading && <span className="text-sm opacity-80">Ładowanie…</span>}
            {error && <span className="text-sm text-red-400">Błąd: {error}</span>}
          </div>
        </div>

        {/* Layout: drzewko + półka premium po prawej */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <TreeCanvas data={tree} />
          </div>
          <div className="lg:col-span-1">
            <PremiumShelf items={premiumAndCollectors} />
          </div>
        </div>
      </main>
    </div>
  )
}

function labelForClass(name: string) {
  switch (name) {
    case 'army': return 'Wojska lądowe'
    case 'helicopter': return 'Helikoptery'
    case 'aviation': return 'Lotnictwo'
    case 'coastal': return 'Flota przybrzeżna'
    case 'bluewater': return 'Flota pełnomorska'
    default: return name
  }
}
