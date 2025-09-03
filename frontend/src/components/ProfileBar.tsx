import React, { useEffect, useState } from 'react'
import type { UserProfile } from '@/types'
import { api } from '@/api'

type Props = { logged: boolean }

const LOCAL_KEY = 'gt_profile_guest'

export default function ProfileBar({ logged }: Props) {
  const [p, setP] = useState<UserProfile>({
    has_premium: false,
    avg_rp_per_battle: null,
    avg_battle_minutes: null,
    booster_percent: null,
    skill_bonus_percent: null,
  })
  const [saving, setSaving] = useState(false)

  // load
  useEffect(() => {
    let cancelled = false
    if (logged) {
      api.getProfile().then((res) => {
        if (!cancelled) setP(res)
      }).catch(() => {})
    } else {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_KEY) : null
        if (raw) setP({ has_premium: false, ...JSON.parse(raw) })
      } catch {}
    }
    return () => { cancelled = true }
  }, [logged])

  // save debounced
  useEffect(() => {
    const t = setTimeout(() => {
      if (logged) {
        setSaving(true)
        api.saveProfile(p).finally(() => setSaving(false))
      } else {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(LOCAL_KEY, JSON.stringify(p))
          }
        } catch {}
      }
    }, 400)
    return () => clearTimeout(t)
  }, [p, logged])

  return (
    <div className="rounded-lg border border-white/10 p-3 bg-neutral-950">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Mój profil bitewny</h3>
        {saving && <span className="text-xs opacity-60">zapisywanie…</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Num label="RP/bitwę" value={p.avg_rp_per_battle} onChange={(v) => setP((o) => ({ ...o, avg_rp_per_battle: v }))} />
        <Num label="min/bitwę" value={p.avg_battle_minutes} onChange={(v) => setP((o) => ({ ...o, avg_battle_minutes: v }))} />
        <Num label="Booster %" value={p.booster_percent} onChange={(v) => setP((o) => ({ ...o, booster_percent: v }))} />
        <Num label="Skill %" value={p.skill_bonus_percent} onChange={(v) => setP((o) => ({ ...o, skill_bonus_percent: v }))} />
        <div className="flex items-center gap-2">
          <input
            id="prem"
            type="checkbox"
            checked={p.has_premium}
            onChange={(e) => setP((o) => ({ ...o, has_premium: e.target.checked }))}
            className="accent-emerald-400"
          />
          <label htmlFor="prem" className="text-sm">Konto premium</label>
        </div>
      </div>

      <p className="mt-2 text-xs opacity-70">
        Efektywny mnożnik: {(multiplier(p)).toFixed(2)}× • RP/bitwę: <b>{Math.floor(effectiveRP(p)) || 0}</b>
      </p>
    </div>
  )
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null | undefined
  onChange: (v: number | null) => void
}) {
  return (
    <label className="text-xs flex flex-col gap-1">
      <span className="opacity-70">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        step="any"
        className="rounded bg-neutral-900 border border-white/15 px-2 py-1 text-sm"
        value={value ?? ''}
        onChange={(e) => {
          const t = e.target.value.trim()
          onChange(t === '' ? null : Number(t))
        }}
        placeholder="—"
        aria-label={label}
      />
    </label>
  )
}

export function multiplier(p: UserProfile): number {
  const booster = p.booster_percent ? 1 + p.booster_percent / 100 : 1
  const skill = p.skill_bonus_percent ? 1 + p.skill_bonus_percent / 100 : 1
  const prem = p.has_premium ? 2 : 1
  return booster * skill * prem
}

export function effectiveRP(p: UserProfile): number {
  const base = p.avg_rp_per_battle || 0
  return base * multiplier(p)
}
