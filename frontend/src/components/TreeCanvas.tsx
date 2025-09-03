import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Edge, TreeResponse, Vehicle } from '@/types'
import { useProgress } from '@/useProgress'

type Props = {
  data: TreeResponse | null
  /** ID węzłów/wariantów do wyróżnienia (np. z wyszukiwarki) */
  highlights?: number[]
  /** gdy true: mocno wygaszamy elementy niebędące w highlights */
  filterToHighlights?: boolean
}
type Pos = { x: number; y: number }

const NODE_W = 170
const NODE_H = 84
const GAP_X = 120
const GAP_Y = 52 // <- naprawione

// powiększony panel wariantów – miejsce na paski postępu i napisy
const VAR_W = 320
const VAR_ROW_H = 72

export default function TreeCanvas({ data, highlights = [], filterToHighlights = false }: Props) {
  const progress = useProgress()

  const allNodes: Vehicle[] = data?.nodes ?? []
  const idToNode = useMemo(
    () => new Map<number, Vehicle>(allNodes.map((n) => [n.id, n] as const)),
    [allNodes]
  )

  // zbiór id do podświetlenia
  const highlightSet = useMemo(() => new Set<number>(highlights ?? []), [highlights])

  // warianty (pojazdy "w folderze") – z całej listy
  const variantsMap = useMemo(() => {
    const m = new Map<number, Vehicle[]>()
    for (const v of allNodes) {
      if (v.type === 'tree' && v.folder_of) {
        const arr = m.get(v.folder_of) ?? []
        arr.push(v)
        m.set(v.folder_of, arr)
      }
    }
    // stabilna kolejność wariantów (rank -> BR -> nazwa)
    for (const [k, arr] of m) {
      arr.sort(
        (a, b) =>
          a.rank - b.rank ||
          (a.br?.rb ?? 0) - (b.br?.rb ?? 0) ||
          a.name.localeCompare(b.name)
      )
      m.set(k, arr)
    }
    return m
  }, [allNodes])

  // rysujemy tylko drzewkowe BEZ folder_of (warianty pokażemy w panelu)
  const layoutNodes = useMemo(
    () => allNodes.filter((n) => n.type === 'tree' && !n.folder_of),
    [allNodes]
  )

  // krawędzie do układu – tylko w obrębie layoutNodes
  const layoutIds = useMemo(() => new Set(layoutNodes.map((n) => n.id)), [layoutNodes])
  const layoutEdges = useMemo(
    () => (data?.edges ?? []).filter((e) => layoutIds.has(e.parent) && layoutIds.has(e.child)),
    [data, layoutIds]
  )

  // mapa rodziców (ze wszystkich krawędzi)
  const parentsMap = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const e of data?.edges ?? []) {
      const arr = m.get(e.child) ?? []
      arr.push(e.parent)
      m.set(e.child, arr)
    }
    return m
  }, [data])

  // rozwinięte foldery
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggleExpanded = (id: number) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // automatycznie rozwiń foldery, jeżeli w środku są dopasowania
  useEffect(() => {
    if (highlightSet.size === 0) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const [parentId, arr] of variantsMap) {
        if (arr.some((v) => highlightSet.has(v.id))) {
          next.add(parentId)
        }
      }
      return next
    })
  }, [highlightSet, variantsMap])

  // zoom/pan
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(40)
  const [ty, setTy] = useState(40)
  const dragging = useRef<{ x: number; y: number } | null>(null) // <- czytelniejszy typ

  const onWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    e.preventDefault()
    const d = -e.deltaY
    setScale((s) => Math.min(2.2, Math.max(0.5, s + (d > 0 ? 0.1 : -0.1))))
  }
  const onMouseDown: React.MouseEventHandler<SVGSVGElement> = (e) => {
    dragging.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!dragging.current) return
    const dx = e.clientX - dragging.current.x
    const dy = e.clientY - dragging.current.y
    setTx((v) => v + dx)
    setTy((v) => v + dy)
    dragging.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseUp = () => { dragging.current = null }

  const layout = useMemo(() => computeLaneLayout(layoutNodes, layoutEdges), [layoutNodes, layoutEdges])
  const idToPos = layout?.idToPos ?? new Map<number, Pos>()

  const size = useMemo(() => {
    const cols = (layout?.maxCol ?? 0) + 1
    const rows = (layout?.maxRow ?? 0) + 1
    const w = cols * (NODE_W + GAP_X) + 900 // więcej miejsca na panel wariantów
    const h = rows * (NODE_H + GAP_Y) + 260
    return { width: Math.max(1100, w), height: Math.max(740, h) }
  }, [layout])

  // --- walidacja odblokowania ---
  const isDone = (id: number): boolean => {
    const node = idToNode.get(id)
    const total = node?.rp_cost ?? 0
    const cur = progress.getRP(id)
    return progress.getDone(id) || (total > 0 && cur >= total)
  }

  // wymagania = krawędzie + rodzic folderu + poprzedni wariant (o ile istnieje)
  const requiredParents = (v: Vehicle): number[] => {
    const fromEdges = parentsMap.get(v.id) ?? []
    const folderParent = v.folder_of ? [v.folder_of] : []
    let prevVariant: number[] = []
    if (v.folder_of) {
      const siblings = variantsMap.get(v.folder_of) ?? []
      const idx = siblings.findIndex((s) => s.id === v.id)
      if (idx > 0) prevVariant = [siblings[idx - 1].id]
    }
    return Array.from(new Set([...fromEdges, ...folderParent, ...prevVariant]))
  }

  const canResearch = (v: Vehicle): boolean => {
    const req = requiredParents(v)
    return req.length === 0 || req.every(isDone)
  }

  const editRP = (v: Vehicle) => {
    const total = v.rp_cost ?? 0
    if (!total) return
    if (!canResearch(v)) {
      alert(
        `Najpierw odblokuj poprzednika(-ów): ${requiredParents(v)
          .map((id) => idToNode.get(id)?.name)
          .filter(Boolean)
          .join(', ')}`
      )
      return
    }
    const cur = progress.getRP(v.id)
    const raw = window.prompt(`Podaj aktualne RP dla: ${v.name}\n(0–${total})`, String(cur))
    if (raw === null) return
    const num = Number(raw)
    if (!Number.isFinite(num)) return
    const next = Math.max(0, Math.min(Math.floor(num), total))
    progress.setRP(v.id, next, total)
  }

  // rozwinięte nody na wierzchu
  const orderedNodes = useMemo(() => {
    const arr = [...layoutNodes]
    arr.sort((a, b) => (expanded.has(a.id) ? 1 : 0) - (expanded.has(b.id) ? 1 : 0))
    return arr
  }, [layoutNodes, expanded])

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
          {layoutEdges.map((e, i) => {
            const p = idToPos.get(e.parent)
            const c = idToPos.get(e.child)
            if (!p || !c) return null
            const pX = p.x + NODE_W / 2, pY = p.y + NODE_H
            const cX = c.x + NODE_W / 2, cY = c.y
            const my = (pY + cY) / 2
            const d = `M ${pX} ${pY} C ${pX} ${my}, ${cX} ${my}, ${cX} ${cY}`
            return <path key={i} d={d} stroke="rgba(255,255,255,0.15)" strokeWidth={2} fill="none" />
          })}

          {/* węzły */}
          {orderedNodes.map((v) => {
            const pos = idToPos.get(v.id)
            if (!pos) return null
            const total = v.rp_cost ?? 0
            const cur = progress.getRP(v.id)
            const done = isDone(v.id)
            const pct = total > 0 ? Math.min(1, Math.max(0, cur / total)) : 0
            const rectCls = done ? 'fill-neutral-800 stroke-white/30' : 'fill-neutral-900 stroke-white/15'
            const locked = !done && !canResearch(v)

            const vars = variantsMap.get(v.id) ?? []
            const hasVariants = vars.length > 0
            const isOpen = expanded.has(v.id)

            const toggleDone: React.MouseEventHandler = (e) => {
              e.stopPropagation()
              if (!done && !canResearch(v)) {
                alert(
                  `Najpierw odblokuj poprzednika(-ów): ${requiredParents(v)
                    .map((id) => idToNode.get(id)?.name)
                    .filter(Boolean)
                    .join(', ')}`
                )
                return
              }
              progress.setDone(v.id, !done, total)
            }

            const toggleFolder: React.MouseEventHandler = (e) => {
              e.stopPropagation()
              toggleExpanded(v.id)
            }

            const onClickTile = () => {
              if (locked) {
                alert(
                  `Najpierw odblokuj poprzednika(-ów): ${requiredParents(v)
                    .map((id) => idToNode.get(id)?.name)
                    .filter(Boolean)
                    .join(', ')}`
                )
                return
              }
              editRP(v)
            }

            const highlighted = highlightSet.has(v.id)
            const dim = filterToHighlights && !highlighted && !(vars.some((x) => highlightSet.has(x.id)))

            return (
              <g key={v.id} transform={`translate(${pos.x}, ${pos.y})`} className={dim ? 'opacity-30' : ''}>
                <g className={locked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'} onClick={onClickTile}>
                  {/* highlight aura */}
                  {highlighted && (
                    <rect width={NODE_W + 6} height={NODE_H + 6} x={-3} y={-3} rx={14} className="fill-transparent stroke-emerald-400" strokeWidth={2} />
                  )}
                  <rect width={NODE_W} height={NODE_H} rx={12} className={rectCls} strokeWidth={1} />
                  <text x={NODE_W / 2} y={22} textAnchor="middle" className="fill-white text-[12px]">
                    {v.name}
                  </text>
                  <text x={NODE_W / 2} y={NODE_H - 38} textAnchor="middle" className="fill-white/70 text-[11px]">
                    {labelForVehicle(v)}
                  </text>

                  {/* done */}
                  <g transform={`translate(${NODE_W - 14}, 14)`} onClick={toggleDone} className="cursor-pointer">
                    <circle r={8} className={done ? 'fill-emerald-400' : 'fill-transparent stroke-white/40'} strokeWidth={done ? 0 : 1} />
                    {done && <text x={0} y={3} textAnchor="middle" className="fill-black text-[10px] font-bold">✓</text>}
                  </g>

                  {/* folder */}
                  {hasVariants && (
                    <g transform="translate(12, 12)" onClick={toggleFolder} className="cursor-pointer">
                      <rect x={-6} y={-10} width={34} height={18} rx={6} className="fill-white/8 stroke-white/20" />
                      <text x={11} y={2} textAnchor="middle" className="text-[11px] fill-white/80">
                        {isOpen ? '▾' : '▸'} {vars.length}
                      </text>
                    </g>
                  )}

                  {locked && <text x={14} y={NODE_H - 14} className="text-[11px] fill-white/70">🔒</text>}

                  {!done && total > 0 && (
                    <>
                      <rect x={10} y={NODE_H - 16} width={NODE_W - 20} height={8} rx={4} className="fill-white/10" />
                      <rect x={10} y={NODE_H - 16} width={(NODE_W - 20) * pct} height={8} rx={4} className="fill-emerald-400/80" />
                      <text x={NODE_W / 2} y={NODE_H - 22} textAnchor="middle" className="fill-white/60 text-[9px]">
                        {formatRp(cur)} / {formatRp(total)} RP
                      </text>
                    </>
                  )}
                </g>

                {/* panel wariantów po prawej */}
                {hasVariants && isOpen && (
                  <g transform={`translate(${NODE_W + 14}, -6)`}>
                    <rect width={VAR_W} height={vars.length * VAR_ROW_H + 10} rx={12} className="fill-neutral-800/95 stroke-white/15" />
                    {vars.map((vv, idx) => {
                      const vHighlighted = highlightSet.has(vv.id)
                      return (
                        <VariantRow
                          key={vv.id}
                          v={vv}
                          y={8 + idx * VAR_ROW_H}
                          idToNode={idToNode}
                          parentsMap={parentsMap}
                          prevVariantId={idx > 0 ? vars[idx - 1].id : null}
                          highlighted={vHighlighted}
                          dim={filterToHighlights && !vHighlighted}
                        />
                      )
                    })}
                  </g>
                )}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

function VariantRow({
  v,
  y,
  idToNode,
  parentsMap,
  prevVariantId,
  highlighted,
  dim,
}: {
  v: Vehicle
  y: number
  idToNode: Map<number, Vehicle>
  parentsMap: Map<number, number[]>
  prevVariantId: number | null
  highlighted: boolean
  dim: boolean
}) {
  const progress = useProgress()
  const total = v.rp_cost ?? 0
  const cur = progress.getRP(v.id)

  const isDone = (id: number): boolean => {
    const node = idToNode.get(id)
    const total = node?.rp_cost ?? 0
    const cur = progress.getRP(id)
    return progress.getDone(id) || (total > 0 && cur >= total)
  }

  // krawędzie + rodzic folderu + poprzedni wariant
  const req = useMemo(() => {
    const edgeParents = parentsMap.get(v.id) ?? []
    const folderParent = v.folder_of ? [v.folder_of] : []
    const prev = prevVariantId ? [prevVariantId] : []
    return Array.from(new Set([...edgeParents, ...folderParent, ...prev]))
  }, [v, parentsMap, prevVariantId])

  const canResearch = req.length === 0 || req.every(isDone)
  const done = isDone(v.id)
  const pct = total > 0 ? Math.min(1, Math.max(0, cur / total)) : 0

  const edit = () => {
    if (!total) return
    if (!canResearch) {
      alert(
        `Najpierw odblokuj poprzednika(-ów): ${req
          .map((id) => idToNode.get(id)?.name)
          .filter(Boolean)
          .join(', ')}`
      )
      return
    }
    const raw = window.prompt(`RP dla: ${v.name} (0–${total})`, String(cur))
    if (raw === null) return
    const num = Math.floor(Number(raw))
    if (!Number.isFinite(num)) return
    progress.setRP(v.id, Math.max(0, Math.min(num, total)), total)
  }
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!done && !canResearch) {
      alert(
        `Najpierw odblokuj poprzednika(-ów): ${req
          .map((id) => idToNode.get(id)?.name)
          .filter(Boolean)
          .join(', ')}`
      )
      return
    }
    progress.setDone(v.id, !done, total)
  }

  return (
    <g
      transform={`translate(0, ${y})`}
      className={`${canResearch ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'} ${dim ? 'opacity-30' : ''}`}
      onClick={edit}
    >
      {/* highlight aura */}
      {highlighted && (
        <rect x={6} y={-2} width={VAR_W - 12} height={VAR_ROW_H - 8} rx={12} className="fill-transparent stroke-emerald-400" strokeWidth={2} />
      )}
      <rect
        x={8}
        y={0}
        width={VAR_W - 16}
        height={VAR_ROW_H - 12}
        rx={10}
        className={done ? 'fill-neutral-700 stroke-white/25' : 'fill-neutral-900 stroke-white/15'}
      />
      <text x={(VAR_W - 16) / 2} y={18} textAnchor="middle" className="fill-white text-[12px]">
        {v.name}
      </text>
      <text x={(VAR_W - 16) / 2} y={38} textAnchor="middle" className="fill-white/70 text-[11px]">
        {labelForVehicle(v)}
      </text>
      {!done && total > 0 && (
        <>
          <text x={(VAR_W - 16) / 2} y={VAR_ROW_H - 26} textAnchor="middle" className="fill-white/60 text-[10px]">
            {formatRp(cur)} / {formatRp(total)} RP
          </text>
          <rect x={16} y={VAR_ROW_H - 18} width={VAR_W - 48} height={8} rx={4} className="fill-white/10" />
          <rect x={16} y={VAR_ROW_H - 18} width={(VAR_W - 48) * pct} height={8} rx={4} className="fill-emerald-400/80" />
        </>
      )}
      {!canResearch && <text x={14} y={VAR_ROW_H - 20} className="text-[12px] fill-white/70">🔒</text>}
      <g transform={`translate(${VAR_W - 26}, ${VAR_ROW_H / 2 - 1})`} onClick={toggle}>
        <circle r={7} className={done ? 'fill-emerald-400' : 'fill-transparent stroke-white/40'} strokeWidth={done ? 0 : 1} />
        {done && <text x={0} y={3} textAnchor="middle" className="fill-black text-[9px] font-bold">✓</text>}
      </g>
    </g>
  )
}

/** Algorytm układu gałęziowego */
function computeLaneLayout(nodes: Vehicle[], edges: Edge[]) {
  if (nodes.length === 0) return { idToPos: new Map<number, Pos>(), maxRow: 0, maxCol: 0 }

  const idToNode = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<number, number[]>()
  const parentOf = new Map<number, number>()

  for (const e of edges) {
    if (!idToNode.has(e.parent) || !idToNode.has(e.child)) continue
    if (!children.has(e.parent)) children.set(e.parent, [])
    children.get(e.parent)!.push(e.child)
    if (!parentOf.has(e.child)) parentOf.set(e.child, e.parent)
  }

  const roots = nodes.filter((n) => !parentOf.has(n.id))
  roots.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))

  const idToPos = new Map<number, Pos>()
  const occupied = new Set<string>()
  const spot = (r: number, c: number) => `${r}:${c}`
  const findFreeCol = (row: number, pref: number) => {
    let c = Math.max(0, pref)
    while (occupied.has(spot(row, c))) c++
    return c
  }

  let maxRow = 0, maxCol = 0, nextRootCol = 0

  const place = (id: number, row: number, prefCol: number) => {
    const col = findFreeCol(row, prefCol)
    occupied.add(spot(row, col))
    maxRow = Math.max(maxRow, row)
    maxCol = Math.max(maxCol, col)
    idToPos.set(id, { x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) })

    const ch = (children.get(id) ?? [])
      .slice()
      .sort((a, b) => {
        const na = idToNode.get(a)!, nb = idToNode.get(b)!
        const bra = na.br?.rb ?? na.br?.ab ?? na.br?.sb ?? 0
        const brb = nb.br?.rb ?? nb.br?.ab ?? nb.br?.sb ?? 0
        return na.rank - nb.rank || bra - brb || na.name.localeCompare(nb.name)
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
