import React from 'react'
import type { Vehicle } from '@/types'

export default function PremiumShelf({ items }: { items: Vehicle[] }) {
  const premiums = items.filter(v => v.type === 'premium')
  const collectors = items.filter(v => v.type === 'collector')

  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5">
      <div className="px-4 py-3 border-b border-yellow-500/20 font-semibold text-yellow-300">
        Pojazdy premium & kolekcjonerskie
      </div>

      <Section title="Premium">
        {premiums.length === 0 && <Empty />}
        {premiums.map(v => (
          <Card key={v.id} title={v.name} subtitle={subLabel(v)}>
            <span className="text-xs rounded bg-yellow-500/15 px-2 py-0.5 border border-yellow-500/30">
              {v.ge_cost ? `${formatInt(v.ge_cost)} GE` : '—'}
            </span>
          </Card>
        ))}
      </Section>

      <Section title="Kolekcjonerskie">
        {collectors.length === 0 && <Empty />}
        {collectors.map(v => (
          <Card key={v.id} title={v.name} subtitle={subLabel(v)}>
            <span className="text-xs rounded bg-emerald-500/15 px-2 py-0.5 border border-emerald-500/30">
              {v.gjn_cost ? `${formatInt(v.gjn_cost)} GJN` : '—'}
            </span>
          </Card>
        ))}
      </Section>
    </div>
  )
}

function Section({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <div className="px-4 py-3 border-t border-yellow-500/10">
      <div className="text-sm opacity-80 mb-2">{title}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function Card({
  title, subtitle, children
}: React.PropsWithChildren<{ title: string; subtitle: string }>) {
  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between">
      <div>
        <div className="text-sm">{title}</div>
        <div className="text-xs opacity-70">{subtitle}</div>
      </div>
      {children}
    </div>
  )
}

function Empty() {
  return <div className="text-xs opacity-60">Brak</div>
}

function subLabel(v: Vehicle) {
  const br = v.br?.rb ?? v.br?.ab ?? v.br?.sb
  return `Rank ${v.rank}${br ? ` • BR ${br}` : ''}`
}

function formatInt(n: number) {
  return n.toLocaleString('pl-PL')
}
