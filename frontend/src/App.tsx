import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, setAuthToken } from '@/api'
import type { Nation, VehicleClass, TreeResponse, Vehicle } from '@/types'
import TreeCanvas from '@/components/TreeCanvas'
import PremiumShelf from '@/components/PremiumShelf'
import { setProgressPersistence, useProgress, setProgressUser } from '@/useProgress'

type RecentRow = { rp: string | number; minutes: string | number; premium: boolean; booster: string | number }

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

  // wyszukiwarka
  const [q, setQ] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [highlightIds, setHighlightIds] = useState<number[]>([])
  const [filterMatches, setFilterMatches] = useState(false)

  // kalkulator (pojedynczy i kaskadowy)
  const [calcVehicleId, setCalcVehicleId] = useState<number | ''>('')
  const [rpCurrent, setRpCurrent] = useState<number | ''>('') // ręczna korekta dla targetu
  const [avgRp, setAvgRp] = useState<number | ''>('')
  const [avgMinutes, setAvgMinutes] = useState<number | ''>(9)
  const [hasPremium, setHasPremium] = useState(false)
  const [booster, setBooster] = useState<number | ''>('')
  const [skillBonus, setSkillBonus] = useState<number | ''>('')

  const [useRecent, setUseRecent] = useState(true)
  const [recent, setRecent] = useState<RecentRow[]>(
    Array.from({ length: 5 }, () => ({ rp: '', minutes: '', premium: false, booster: '' }))
  )

  // KASKADA
  const [cascade, setCascade] = useState(false)

  const [calcResult, setCalcResult] = useState<any>(null)
  const [calcLoading, setCalcLoading] = useState(false)
  const [calcError, setCalcError] = useState<string | null>(null)

  const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
  const apiRoot = base.endsWith('/api') ? base : `${base}/api`

  // progres (do kaskady i per-user)
  const progress = useProgress()

  // start – token + per-user namespace w progresie
  useEffect(() => {
    const tok = sessionStorage.getItem('gt_jwt')
    if (tok) {
      setAuthToken(tok)
      api.me()
        .then((r) => {
          setAuthUser({ id: r.user.id, email: r.user.email })
          setProgressUser(r.user.id)          // progres per user
          setProgressPersistence(true)
        })
        .catch(() => {
          setAuthToken(null)
          setAuthUser(null)
          setProgressUser(null)
          setProgressPersistence(false)
        })
    } else {
      setProgressUser(null)
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
    return () => { (mounted = false) }
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

  // tylko pojazdy badalne
  const researchableVehicles = useMemo(
    () => ((tree?.nodes ?? []) as Vehicle[]).filter(v => v.type === 'tree'),
    [tree]
  )

  // jeśli bieżący wybór nie jest badalny / brak, ustaw pierwszy badalny
  useEffect(() => {
    if (!researchableVehicles.length) {
      setCalcVehicleId('')
      return
    }
    const isValid =
      calcVehicleId &&
      researchableVehicles.some(v => v.id === Number(calcVehicleId))
    if (!isValid) {
      setCalcVehicleId(researchableVehicles[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchableVehicles, nation, vclass])

  // --- wyszukiwanie (podświetlanie w drzewku) ---
  const searchDebounce = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(searchDebounce.current)
    if (!q.trim()) {
      setHighlightIds([])
      setSearchError(null)
      setSearchLoading(false)
      // domyślnie pierwszy badalny
      if (!calcVehicleId && researchableVehicles.length) {
        setCalcVehicleId(researchableVehicles[0].id)
      }
      return
    }
    setSearchLoading(true)
    searchDebounce.current = window.setTimeout(async () => {
      try {
        const url = `${apiRoot}/vehicles?nation=${encodeURIComponent(nation)}&class=${encodeURIComponent(vclass)}&q=${encodeURIComponent(q)}&exclude_variants=0`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const arr: Vehicle[] = await res.json()

        // 1) podświetlanie — wszystkie trafienia (niezależnie od typu)
        const idsAll = arr.map(v => v.id)
        setHighlightIds(idsAll)

        // 2) jeśli nie wybrano pojazdu do kalkulatora — zaproponuj pierwsze BADALNE trafienie
        if (!calcVehicleId) {
          const firstResearchableHit = arr.find(v => v.type === 'tree')
          if (firstResearchableHit) setCalcVehicleId(firstResearchableHit.id)
        }

        setSearchError(null)
      } catch (e: any) {
        setSearchError(e?.message ?? String(e))
      } finally {
        setSearchLoading(false)
      }
    }, 250)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, nation, vclass])

  // pomocnicze (podgląd 5 bitew na kliencie)
  function normalizeRP(rp: number, prem: boolean, boosterPct: number) {
    let denom = 1.0
    if (prem) denom *= 2.0
    if (Number.isFinite(boosterPct) && boosterPct > -100) denom *= (1 + boosterPct / 100)
    return denom > 0 ? rp / denom : rp
  }
  const recentPreview = useMemo(() => {
    const rows = recent
      .map(r => ({
        rp: Number(r.rp || 0),
        minutes: Number(r.minutes || 0),
        premium: !!r.premium,
        booster: Number(r.booster || 0)
      }))
      .filter(r => r.rp > 0)

    if (rows.length === 0) return { avgBaseRP: 0, avgMin: 0, count: 0 }
    const baseSum = rows.reduce((acc, r) => acc + normalizeRP(r.rp, r.premium, r.booster), 0)
    const minRows = rows.filter(r => r.minutes > 0)
    const minAvg = minRows.length ? minRows.reduce((a, r) => a + r.minutes, 0) / minRows.length : 0
    return { avgBaseRP: baseSum / rows.length, avgMin: minAvg, count: rows.length }
  }, [recent])

  // auth actions
  async function doLogin(kind: 'login' | 'register') {
    try {
      const res = kind === 'login' ? await api.login(email, password) : await api.register(email, password)
      setAuthToken(res.token)
      sessionStorage.setItem('gt_jwt', res.token)
      setAuthUser({ id: res.user.id, email: res.user.email })
      setProgressUser(res.user.id)     // namespace progresu
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
    setProgressUser(null)              // reset namespace
    setProgressPersistence(false)
  }

  // --- kalkulator: /api/calc/estimate lub /api/calc/cascade ---
  async function runCalc() {
    setCalcError(null)
    setCalcResult(null)
    const vehicleId = Number(calcVehicleId)
    if (!vehicleId) {
      setCalcError('Wybierz pojazd.')
      return
    }

    const commonPayload: any = {
      has_premium: !!hasPremium,
      booster_percent: booster === '' ? undefined : Number(booster),
      skill_bonus_percent: skillBonus === '' ? undefined : Number(skillBonus),
    }

    if (useRecent) {
      commonPayload.recent_battles = recent
        .map(r => ({
          rp: r.rp === '' ? 0 : Number(r.rp),
          minutes: r.minutes === '' ? 0 : Number(r.minutes),
          premium: !!r.premium,
          booster_percent: r.booster === '' ? 0 : Number(r.booster)
        }))
        .filter((r: any) => r.rp > 0 || r.minutes > 0)
        .slice(0, 5)
    } else {
      commonPayload.avg_rp_per_battle = Number(avgRp || 0)
      commonPayload.avg_battle_minutes = Number(avgMinutes || 0)
    }

    try {
      setCalcLoading(true)
      let url = `${apiRoot}/calc/estimate`
      let payload: any = {
        vehicle_id: vehicleId,
        rp_current: Number(rpCurrent || 0),
        ...commonPayload,
      }

      if (cascade) {
        url = `${apiRoot}/calc/cascade`
        // progres z hooka (per user) + opcjonalna ręczna korekta dla targetu
        const prog: Record<number, { rp_current: number; done: boolean }> = {}
        for (const v of (tree?.nodes ?? []) as Vehicle[]) {
          const cur = v.id === vehicleId && rpCurrent !== '' ? Number(rpCurrent) : progress.getRP(v.id)
          const done = progress.getDone(v.id)
          if (cur > 0 || done) prog[v.id] = { rp_current: cur, done }
        }
        payload = { vehicle_id: vehicleId, progress: prog, ...commonPayload }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setCalcResult(json)
    } catch (e: any) {
      setCalcError(e?.message ?? String(e))
    } finally {
      setCalcLoading(false)
    }
  }

  const allTreeVehicles = useMemo(() => (tree?.nodes ?? []).filter(n => n.type === 'tree') as Vehicle[], [tree])

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
        {/* Filtry/wyszukiwarka */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end mb-5">
          <div className="flex-1">
            <label className="block text-xs opacity-70 mb-1">Nacja</label>
            <select
              className="w-full min-w-[240px] rounded-lg bg-neutral-950 border border-white/15 px-3 py-2"
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
              className="w-full min-w-[240px] rounded-lg bg-neutral-950 border border-white/15 px-3 py-2"
              value={vclass}
              onChange={(e) => setVclass(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.name}>{labelForClass(c.name)}</option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-xs opacity-70 mb-1">Szukaj pojazdu</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="np. Fw 190, M4, Panther…"
              className="w-full rounded-lg bg-neutral-950 border border-white/15 px-3 py-2"
            />
            <div className="mt-1 flex items-center gap-3">
              <label className="text-xs opacity-80 flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-emerald-400"
                  checked={filterMatches}
                  onChange={(e) => setFilterMatches(e.target.checked)}
                />
                Pokaż tylko dopasowania
              </label>
              {searchLoading && <span className="text-xs opacity-80">Szukam…</span>}
              {searchError && <span className="text-xs text-red-400">Błąd: {searchError}</span>}
              {!!highlightIds.length && (
                <span className="text-xs opacity-70">{highlightIds.length} trafień</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!logged && <span className="text-xs text-yellow-300/80">Gość: postęp nie zapisuje się</span>}
            {loading && <span className="text-sm opacity-80">Ładowanie…</span>}
            {error && <span className="text-sm text-red-400">Błąd: {error}</span>}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <TreeCanvas data={tree} highlights={highlightIds} filterToHighlights={filterMatches} />
          </div>

          <div className="lg:col-span-1 space-y-4">
            {/* Kalkulator RP */}
            <div className="rounded-xl border border-white/10 p-4 bg-neutral-950">
              <h2 className="font-semibold mb-3">Kalkulator RP</h2>

              <label className="block text-xs opacity-70 mb-1">Pojazd</label>
              <select
                className="w-full rounded-lg bg-neutral-900 border border-white/15 px-3 py-2 mb-2"
                value={String(calcVehicleId)}
                onChange={(e) => setCalcVehicleId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">— wybierz —</option>
                {researchableVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} {v.br?.rb ? `• BR ${v.br?.rb}` : ''}
                  </option>
                ))}
              </select>

              <div className="mb-2 flex items-center gap-2">
                <input type="checkbox" className="accent-emerald-400" checked={useRecent} onChange={(e) => setUseRecent(e.target.checked)} />
                <span className="text-sm">Policz średnią z 5 ostatnich bitew</span>
              </div>

              {useRecent ? (
                <>
                  <div className="rounded-lg border border-white/10 divide-y divide-white/10 mb-2">
                    <div className="grid grid-cols-12 gap-2 px-2 py-2 text-xs opacity-70">
                      <div className="col-span-4">RP</div>
                      <div className="col-span-3">Minuty</div>
                      <div className="col-span-3">Booster %</div>
                      <div className="col-span-2">Premium</div>
                    </div>
                    {recent.map((row, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 px-2 py-2">
                        <input
                          className="col-span-4 rounded bg-neutral-900 border border-white/15 px-2 py-1 text-sm"
                          type="number" min={0}
                          value={String(row.rp)}
                          onChange={(e) => {
                            const cp = [...recent]; cp[i] = { ...cp[i], rp: e.target.value === '' ? '' : Number(e.target.value) }; setRecent(cp)
                          }}
                        />
                        <input
                          className="col-span-3 rounded bg-neutral-900 border border-white/15 px-2 py-1 text-sm"
                          type="number" min={0}
                          value={String(row.minutes)}
                          onChange={(e) => {
                            const cp = [...recent]; cp[i] = { ...cp[i], minutes: e.target.value === '' ? '' : Number(e.target.value) }; setRecent(cp)
                          }}
                        />
                        <input
                          className="col-span-3 rounded bg-neutral-900 border border-white/15 px-2 py-1 text-sm"
                          type="number" min={0}
                          value={String(row.booster)}
                          onChange={(e) => {
                            const cp = [...recent]; cp[i] = { ...cp[i], booster: e.target.value === '' ? '' : Number(e.target.value) }; setRecent(cp)
                          }}
                        />
                        <label className="col-span-2 flex items-center gap-2 text-sm">
                          <input
                            type="checkbox" className="accent-emerald-400"
                            checked={row.premium}
                            onChange={(e) => { const cp = [...recent]; cp[i] = { ...cp[i], premium: e.target.checked }; setRecent(cp) }}
                          />
                          <span className="opacity-80">tak</span>
                        </label>
                      </div>
                    ))}
                  </div>

                  <div className="text-xs opacity-80 mb-3">
                    Średnia z {recentPreview.count || 0} bitew (po zdjęciu bonusów):{' '}
                    <b>{recentPreview.avgBaseRP ? Math.round(recentPreview.avgBaseRP) : 0} RP</b> / bitwę •{' '}
                    <b>{recentPreview.avgMin ? recentPreview.avgMin.toFixed(1) : 0} min</b> / bitwę
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs opacity-70 mb-1">Śr. RP / bitwę</label>
                    <input
                      type="number"
                      className="w-full rounded bg-neutral-900 border border-white/15 px-2 py-1"
                      value={String(avgRp)}
                      onChange={(e) => setAvgRp(e.target.value === '' ? '' : Number(e.target.value))}
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="block text-xs opacity-70 mb-1">Minuty / bitwę</label>
                    <input
                      type="number"
                      className="w-full rounded bg-neutral-900 border border-white/15 px-2 py-1"
                      value={String(avgMinutes)}
                      onChange={(e) => setAvgMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                      min={0}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="accent-emerald-400" checked={hasPremium} onChange={(e) => setHasPremium(e.target.checked)} />
                  <span className="text-sm">Konto premium (prognoza)</span>
                </div>
                <div>
                  <label className="block text-xs opacity-70 mb-1">Booster % (prognoza)</label>
                  <input
                    type="number"
                    className="w-full rounded bg-neutral-900 border border-white/15 px-2 py-1"
                    value={String(booster)}
                    onChange={(e) => setBooster(e.target.value === '' ? '' : Number(e.target.value))}
                    min={0}
                  />
                </div>
                <div>
                  <label className="block text-xs opacity-70 mb-1">Skill bonus % (prognoza)</label>
                  <input
                    type="number"
                    className="w-full rounded bg-neutral-900 border border-white/15 px-2 py-1"
                    value={String(skillBonus)}
                    onChange={(e) => setSkillBonus(e.target.value === '' ? '' : Number(e.target.value))}
                    min={0}
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <label className="text-sm flex items-center gap-2">
                  <input type="checkbox" className="accent-emerald-400" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
                  Wlicz wymagane pojazdy (kaskadowo)
                </label>
              </div>

              {/* ręczna korekta RP tylko dla wybranego wozu (gdy ktoś chce) */}
              {!cascade && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-xs opacity-70 mb-1">Aktualne RP (dla wybranego)</label>
                    <input
                      type="number"
                      className="w-full rounded bg-neutral-900 border border-white/15 px-2 py-1"
                      value={String(rpCurrent)}
                      onChange={(e) => setRpCurrent(e.target.value === '' ? '' : Number(e.target.value))}
                      min={0}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={runCalc}
                className="mt-3 w-full rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/5"
                disabled={calcLoading}
              >
                {calcLoading ? 'Liczenie…' : 'Policz'}
              </button>

              {calcError && <p className="mt-2 text-sm text-red-400">Błąd: {calcError}</p>}

              {calcResult && (
                <div className="mt-3 text-sm space-y-1">
                  {cascade ? (
                    <>
                      <div className="opacity-80">
                        <span className="opacity-70">Cel:</span> {calcResult?.target?.name}
                      </div>
                      <div className="opacity-80">
                        <span className="opacity-70">Łączne RP do zrobienia (kaskada):</span>{' '}
                        {(calcResult?.rp_total_remaining ?? 0).toLocaleString('pl-PL')}
                      </div>
                      <div className="opacity-80">
                        <span className="opacity-70">Efektywne RP/bitwę:</span> {Math.round(calcResult?.effective_rp_per_battle ?? 0)}
                      </div>
                      <div className="opacity-80">
                        <span className="opacity-70">Potrzebne bitwy:</span> {calcResult?.battles_needed ?? '—'}
                      </div>
                      <div className="opacity-80">
                        <span className="opacity-70">Czas (h):</span> {calcResult?.hours_needed ?? '—'}
                      </div>
                      <div className="opacity-80">
                        <span className="opacity-70">Koszt wg 1GE=45RP:</span>{' '}
                        {(calcResult?.ge_cost_by_rate ?? 0).toLocaleString('pl-PL')} GE
                      </div>

                      {Array.isArray(calcResult?.breakdown) && calcResult.breakdown.length > 0 && (
                        <div className="pt-2">
                          <div className="opacity-70 mb-1">Rozpiska:</div>
                          <ul className="list-disc list-inside space-y-0.5">
                            {calcResult.breakdown.map((b: any) => (
                              <li key={b.id}>
                                {b.name} — {b.rp_current?.toLocaleString?.('pl-PL') ?? b.rp_current}/{b.rp_cost?.toLocaleString?.('pl-PL') ?? b.rp_cost} RP
                                {b.done ? ' (✓)' : b.rp_remaining ? ` • zostaje ${b.rp_remaining.toLocaleString?.('pl-PL') ?? b.rp_remaining}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="opacity-80">
                        <span className="opacity-70">RP łącznie:</span> {calcResult?.vehicle?.rp_cost?.toLocaleString?.('pl-PL') ?? calcResult?.vehicle?.rp_cost}
                      </div>
                      <div className="opacity-80">
                        <span className="opacity-70">Zostaje:</span> {calcResult?.rp_remaining?.toLocaleString?.('pl-PL') ?? calcResult?.rp_remaining}
                      </div>
                      {calcResult?.base_from_recent?.samples ? (
                        <div className="opacity-80">
                          <span className="opacity-70">Średnie (bazowe) z 5 bitew:</span>{' '}
                          {Math.round(calcResult.base_from_recent.avg_rp_per_battle)} RP •{' '}
                          {calcResult.base_from_recent.avg_battle_minutes} min
                        </div>
                      ) : null}
                      <div className="opacity-80">
                        <span className="opacity-70">Efektywne RP/bitwę:</span> {Math.round(calcResult?.effective_rp_per_battle ?? 0)}
                      </div>
                      <div className="opacity-80">
                        <span className="opacity-70">Potrzebne bitwy:</span> {calcResult?.battles_needed ?? '—'}
                      </div>
                      <div className="opacity-80">
                        <span className="opacity-70">Czas (h):</span> {calcResult?.hours_needed ?? '—'}
                      </div>
                      <div className="opacity-80">
                        <span className="opacity-70">Koszt wg 1GE=45RP:</span>{' '}
                        {(calcResult?.ge_cost_by_rate ?? 0).toLocaleString('pl-PL')} GE
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Półka premium/collector */}
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
