import React, { useEffect, useMemo, useState } from 'react'
import { api, setAuthToken } from '@/api'
import type { Nation, VehicleClass, TreeResponse, Vehicle } from '@/types'
import TreeCanvas from '@/components/TreeCanvas'
import PremiumShelf from '@/components/PremiumShelf'
import { setProgressPersistence } from '@/useProgress'

export default function App() {
  const [nations, setNations] = useState<Nation[]>([])
  const [classes, setClasses] = useState<VehicleClass[]>([])
  const [nation, setNation] = useState<string>('')
  const [vclass, setVclass] = useState<string>('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeResponse | null>(null)

  // auth
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authUser, setAuthUser] = useState<{ id: number; email: string } | null>(null)
  const logged = !!authUser

  // start – token + persystencja progresu
  useEffect(() => {
    const tok = sessionStorage.getItem('gt_jwt')
    if (tok) {
      setAuthToken(tok)
      api.me()
        .then((r) => {
          setAuthUser({ id: r.user.id, email: r.user.email })
          setProgressPersistence(true)
        })
        .catch(() => {
          setAuthToken(null)
          setAuthUser(null)
          setProgressPersistence(false)
        })
    } else {
      setProgressPersistence(false)
    }
  }, [])

  // słowniki
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [ns, cs] = await Promise.all([api.nations(), api.classes()])
        if (!mounted) return
        setNations(ns)
        setClasses(cs)
        setNation(ns[0]?.slug || '')
        setVclass(cs.find((c) => c.name === 'army')?.name || cs[0]?.name || '')
      } catch (e: any) {
        setError(e?.message ?? String(e))
      }
    })()
    return () => { mounted = false }
  }, [])

  // drzewko
  useEffect(() => {
    if (!nation || !vclass) return
    setLoading(true); setError(null)
    api.tree(nation, vclass)
      .then((res) => setTree(res as TreeResponse))
      .catch((e) => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false))
  }, [nation, vclass])

  const premiumAndCollectors = useMemo(
    () => (tree?.nodes ?? []).filter((n: Vehicle) => n.type !== 'tree'),
    [tree]
  )

  // auth actions
  async function doLogin(kind: 'login' | 'register') {
    try {
      const res = kind === 'login' ? await api.login(email, password) : await api.register(email, password)
      setAuthToken(res.token)
      sessionStorage.setItem('gt_jwt', res.token)
      setAuthUser({ id: res.user.id, email: res.user.email })
      setProgressPersistence(true)
      setEmail(''); setPassword('')
    } catch (e: any) {
      alert('Błąd: ' + (e?.message ?? e))
    }
  }
  async function doLogout() {
    try { await api.logout() } catch {}
    setAuthToken(null)
    sessionStorage.removeItem('gt_jwt')
    setAuthUser(null)
    setProgressPersistence(false)
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-neutral-900/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <h1 className="font-semibold">GrindTracker – War Thunder RP Calculator</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs opacity-70 hidden sm:inline">API: {import.meta.env.VITE_API_BASE_URL}</span>

            {logged ? (
              <>
                <span className="text-sm opacity-80">Zalogowany: {authUser?.email}</span>
                <button className="rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/5" onClick={doLogout}>
                  Wyloguj
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email"
                  className="w-44 sm:w-56 rounded bg-neutral-950 border border-white/15 px-2 py-1 text-sm"
                />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doLogin('login')}
                  placeholder="hasło"
                  type="password"
                  className="w-36 sm:w-44 rounded bg-neutral-950 border border-white/15 px-2 py-1 text-sm"
                />
                <button className="rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/5" onClick={() => doLogin('login')}>
                  Zaloguj
                </button>
                <button className="rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/5" onClick={() => doLogin('register')}>
                  Rejestruj
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-end mb-4">
          <div className="flex-1">
            <label className="block text-xs opacity-70 mb-1">Nacja</label>
            <select
              className="w-full min-w-[220px] rounded-lg bg-neutral-950 border border-white/15 px-3 py-2"
              value={nation}
              onChange={(e) => setNation(e.target.value)}
            >
              {nations.map((n) => (
                <option key={n.id} value={n.slug}>{n.name}</option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-xs opacity-70 mb-1">Typ pojazdu</label>
            <select
              className="w-full min-w-[220px] rounded-lg bg-neutral-950 border border-white/15 px-3 py-2"
              value={vclass}
              onChange={(e) => setVclass(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.name}>{labelForClass(c.name)}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            {!logged && <span className="text-xs text-yellow-300/80">Gość: postęp nie zapisuje się</span>}
            {loading && <span className="text-sm opacity-80">Ładowanie…</span>}
            {error && <span className="text-sm text-red-400">Błąd: {error}</span>}
          </div>
        </div>

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
