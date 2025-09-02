import React, { useMemo, useRef, useState } from 'react'
import type { Edge, TreeResponse, Vehicle } from '@/types'
import { useProgressStore } from '@/useProgress'

type Props = { data: TreeResponse | null }
type Pos = { x: number; y: number }

/** Rozmiary/odstępy */
const NODE_W = 170
const NODE_H = 84   // +10 px, więcej miejsca nad paskiem
const GAP_X = 120
const GAP_Y = 52

export default function TreeCanvas({ data }: Props) {
  const store = useProgressStore()

  // tylko drzewkowe do układu
  const treeNodes = useMemo(() => (data?.nodes ?? []).filter(n => n.type === 'tree'), [data])
  const treeEdges = useMemo(() => {
    const ids = new Set(treeNodes.map(n => n.id))
    return (data?.edges ?? []).filter(e => ids.has(e.parent) && ids.has(e.child))
  }, [data, treeNodes])

  // zoom/pan
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(40)
  const [ty, setTy] = useState(40)
  const dragging = useRef<null | { x: number; y: number }>()

  const layout = useMemo(() => computeLaneLayout(treeNodes, treeEdges), [treeNodes, treeEdges])

  const size = useMemo(() => {
    const cols = (layout?.maxCol ?? 0) + 1
    const rows = (layout?.maxRow ?? 0) + 1
    const w = cols * (NODE_W + GAP_X) + 200
    const h = rows * (NODE_H + GAP_Y) + 200
    return { width: Math.max(1000, w), height: Math.max(700, h) }
  }, [layout])

  const idToPos = layout?.idToPos ?? new Map<number, Pos>()

  // interakcje
  const onWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    e.preventDefault()
    const delta = -e.deltaY
    const next = Math.min(2.0, Math.max(0.5, scale + (delta > 0 ? 0.1 : -0.1)))
    setScale(next)
  }
  const onMouseDown: React.MouseEventHandler<SVGSVGElement> = (e) => {
    dragging.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!dragging.current) return
    const dx = e.clientX - dragging.current.x
    const dy = e.clientY - dragging.current.y
    setTx(v => v + dx)
    setTy(v => v + dy)
    dragging.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseUp = () => { dragging.current = null }

  // klik w kafelek -> szybka edycja RP (z klampowaniem i komunikatem)
  const onNodeClick = (v: Vehicle) => {
    const total = v.rp_cost ?? 0
    if (!total) return
    const current = store.getRP(v.id) ?? 0
    const raw = window.prompt(`Podaj aktualne RP dla: ${v.name}\n(0–${total})`, String(current))
    if (raw === null) return
    const num = Number(raw)
    if (!Number.isFinite(num)) return
    let next = Math.floor(num)
    if (next > total) {
      next = total
      alert(`Maksimum dla tego pojazdu to ${total} RP. Ustawiono wartość maksymalną.`)
    } else if (next < 0) next = 0
    store.setRP(v.id, next, total) // setRP sam oznaczy 'done' gdy osiągnięto total
  }

  return (
    <div className="w-full h-[70vh] rounded-xl border border-white/10 overflow-hidden bg-neutral-950">
      <svg
        className="w-full h-full"
        viewBox={`0 0 ${size.width} ${size.height}`}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <rect x={0} y={0} width={size.width} height={size.height} fill="transparent" />

        <g transform={`translate(${tx}, ${ty}) scale(${scale})`}>
          <Grid width={size.width} height={size.height} />

          {/* krawędzie */}
          {treeEdges.map((e, i) => {
            const p = idToPos.get(e.parent)
            const c = idToPos.get(e.child)
            if (!p || !c) return null
            const pX = p.x + NODE_W / 2
            const pY = p.y + NODE_H
            const cX = c.x + NODE_W / 2
            const cY = c.y
            const my = (pY + cY) / 2
            const d = `M ${pX} ${pY} C ${pX} ${my}, ${cX} ${my}, ${cX} ${cY}`
            return <path key={i} d={d} stroke="rgba(255,255,255,0.15)" strokeWidth={2} fill="none" />
          })}

          {/* węzły */}
          {treeNodes.map(v => {
            const pos = idToPos.get(v.id)
            if (!pos) return null

            const total = v.rp_cost ?? 0
            const current = store.getRP(v.id) ?? 0
            const storedDone = store.getDone(v.id)
            const autoDone = total > 0 && current >= total
            const done = storedDone || autoDone

            const pct = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0
            const rectClass = done ? 'fill-neutral-800 stroke-white/30' : 'fill-neutral-900 stroke-white/15'

            // kliknięcie zielonej kropki (znacznik) nie powinno odpalać promta RP
            const onToggleDone: React.MouseEventHandler = (e) => {
              e.stopPropagation()
              if (done && !storedDone) {
                // done tylko z auto, klik zdejmuje? – zachowajmy prosto: zawsze ustawiamy przeciwność
                store.setDone(v.id, false)
              } else {
                // jeśli oznaczamy „done”, a nie mamy RP – ustaw RP = total
                if (total > 0 && current < total) store.setRP(v.id, total, total)
                store.setDone(v.id, true)
              }
            }

            return (
              <g key={v.id} transform={`translate(${pos.x}, ${pos.y})`} className="cursor-pointer" onClick={() => onNodeClick(v)}>
                {/* kafelek */}
                <rect width={NODE_W} height={NODE_H} rx={12} className={rectClass} strokeWidth={1} />

                {/* nazwa */}
                <text x={NODE_W/2} y={22} textAnchor="middle" className="fill-white text-[12px]">{v.name}</text>

                {/* etykieta Rank/BR – PODNIESIONA, żeby nie nachodziła na pasek */}
                <text
                  x={NODE_W/2}
                  y={NODE_H - 36}           // było ~ -26, teraz wyżej
                  textAnchor="middle"
                  className="fill-white/70 text-[11px]"
                >
                  {labelForVehicle(v)}
                </text>

                {/* znacznik „wybadany” (klikany) */}
                <g transform={`translate(${NODE_W - 14}, 14)`} onClick={onToggleDone} className="cursor-pointer">
                  <circle r={8} className={done ? 'fill-emerald-400' : 'fill-transparent stroke-white/40'} strokeWidth={done ? 0 : 1} />
                  {done && <text x={0} y={3} textAnchor="middle" className="fill-black text-[10px] font-bold">✓</text>}
                </g>

                {/* pasek RP – ukryty, gdy wybadany lub brak kosztu */}
                {!done && total > 0 && (
                  <>
                    {/* tło paska */}
                    <rect x={10} y={NODE_H - 16} width={NODE_W - 20} height={8} rx={4} className="fill-white/10" />
                    {/* wypełnienie */}
                    <rect x={10} y={NODE_H - 16} width={(NODE_W - 20) * pct} height={8} rx={4} className="fill-emerald-400/80" />
                    {/* opis */}
                    <text x={NODE_W/2} y={NODE_H - 22} textAnchor="middle" className="fill-white/60 text-[9px]">
                      {formatRp(current)} / {formatRp(total)} RP
                    </text>
                  </>
                )}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

/** Układ „lane layout”: pierwsze dziecko pod rodzicem, kolejne dzieci w nowych kolumnach. */
function computeLaneLayout(nodes: Vehicle[], edges: Edge[]) {
  if (nodes.length === 0) return { idToPos: new Map<number, Pos>(), maxRow: 0, maxCol: 0 }

  const idToNode = new Map(nodes.map(n => [n.id, n]))
  const children = new Map<number, number[]>()
  const parentOf = new Map<number, number>()

  for (const e of edges) {
    if (!idToNode.has(e.parent) || !idToNode.has(e.child)) continue
    if (!children.has(e.parent)) children.set(e.parent, [])
    children.get(e.parent)!.push(e.child)
    if (!parentOf.has(e.child)) parentOf.set(e.child, e.parent) // główny rodzic
  }

  const roots = nodes.filter(n => !parentOf.has(n.id))
  roots.sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name))

  const idToPos = new Map<number, Pos>()
  const occupied = new Set<string>()
  const spot = (r: number, c: number) => `${r}:${c}`
  const findFreeCol = (row: number, pref: number) => { let c = Math.max(0, pref); while (occupied.has(spot(row, c))) c++; return c }

  let maxRow = 0, maxCol = 0, nextRootCol = 0

  const place = (id: number, row: number, prefCol: number) => {
    const col = findFreeCol(row, prefCol)
    occupied.add(spot(row, col))
    maxRow = Math.max(maxRow, row)
    maxCol = Math.max(maxCol, col)
    idToPos.set(id, { x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) })

    const ch = (children.get(id) ?? []).slice().sort((a, b) => {
      const na = idToNode.get(a)!, nb = idToNode.get(b)!
      const bra = na.br?.rb ?? na.br?.ab ?? na.br?.sb ?? 0
      const brb = nb.br?.rb ?? nb.br?.ab ?? nb.br?.sb ?? 0
      return (na.rank - nb.rank) || (bra - brb) || na.name.localeCompare(nb.name)
    })

    let spawn = col
    ch.forEach((cid, idx) => {
      const r = row + 1
      if (idx === 0) place(cid, r, spawn)
      else { spawn = maxCol + 1; place(cid, r, spawn) }
    })
  }

  for (const r of roots) {
    const c = findFreeCol(0, nextRootCol)
    nextRootCol = c + 1
    place(r.id, 0, c)
  }

  return { idToPos, maxRow, maxCol }
}

/** Etykieta: „Rank X • BR Y” */
function labelForVehicle(v: Vehicle) {
  const br = v.br?.rb ?? v.br?.ab ?? v.br?.sb
  return `Rank ${v.rank}${br ? ` • BR ${br}` : ''}`
}

function formatRp(n: number) {
  return n.toLocaleString('pl-PL')
}

function Grid({ width, height }: { width: number; height: number }) {
  const step = 40
  const lines: JSX.Element[] = []
  for (let x = 0; x < width; x += step) {
    lines.push(<line key={`vx${x}`} x1={x} y1={0} x2={x} y2={height} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />)
  }
  for (let y = 0; y < height; y += step) {
    lines.push(<line key={`hy${y}`} x1={0} y1={y} x2={width} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />)
  }
  return <g>{lines}</g>
}
