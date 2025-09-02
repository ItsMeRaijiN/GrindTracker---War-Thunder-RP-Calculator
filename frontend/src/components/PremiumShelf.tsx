import React from 'react'
import type { Vehicle } from '@/types'

type Props = { items: Vehicle[] }

export default function PremiumShelf({ items }: Props) {
  const premiums = items.filter(i => i.type === 'premium')
  const collectors = items.filter(i => i.type === 'collector')

  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-950/10">
      <div className="px-4 py-3 border-b border-yellow-500/20">
        <h3 className="font-medium text-yellow-300">Pojazdy premium & kolekcjonerskie</h3>
      </div>

      <div className="p-3 space-y-4">
        <Section title="Premium" items={premiums} />
        <Section title="Kolekcjonerskie" items={collectors} />
      </div>
    </div>
  )
}

function Section({ title, items }: { title: string; items: Vehicle[] }) {
  if (items.length === 0) {
    return (
      <div>
        <h4 className="text-sm text-yellow-200/90 mb-2">{title}</h4>
        <div className="text-xs opacity-60 px-2 py-1 rounded border border-yellow-500/20">
          Brak
        </div>
      </div>
    )
  }
  return (
    <div>
      <h4 className="text-sm text-yellow-200/90 mb-2">{title}</h4>
      <div className="grid grid-cols-1 gap-2">
        {items.map(v => (
          <div key={v.id} className="rounded-lg border border-yellow-500/30 bg-yellow-900/10 px-3 py-2">
            <div className="text-sm">{v.name}</div>
            <div className="text-xs opacity-75">
              Rank {v.rank}{v.br?.rb ? ` • BR ${v.br.rb}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
