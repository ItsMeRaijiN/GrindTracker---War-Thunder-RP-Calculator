import { useMemo } from 'react'

/** Struktura wpisu postępu dla jednego pojazdu. */
type Entry = {
  rp?: number   // aktualne RP
  done?: boolean // czy „wybadany”
}

const STORAGE_KEY = 'gt_progress_v2'

function readAll(): Record<number, Entry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    // kompatybilność wsteczna: kiedyś trzymaliśmy samą liczbę
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const v = (obj as any)[k]
        if (typeof v === 'number') {
          ;(obj as any)[k] = { rp: v } as Entry
        }
      }
      return obj as Record<number, Entry>
    }
    return {}
  } catch {
    return {}
  }
}

function writeAll(map: Record<number, Entry>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function useProgressStore() {
  const api = useMemo(() => {
    return {
      getRP(id: number): number {
        const all = readAll()
        return all[id]?.rp ?? 0
      },
      getDone(id: number): boolean {
        const all = readAll()
        return !!all[id]?.done
      },
      /** Ustaw RP (z klampowaniem 0..total). Gdy rp >= total, ustawia done=true. */
      setRP(id: number, rp: number, total?: number) {
        const all = readAll()
        const curr: Entry = all[id] ?? {}
        const max = typeof total === 'number' && total > 0 ? total : Number.POSITIVE_INFINITY
        const clamped = Math.max(0, Math.min(Math.floor(rp), max))
        curr.rp = clamped
        if (typeof total === 'number' && total > 0) {
          curr.done = clamped >= total
        }
        all[id] = curr
        writeAll(all)
      },
      setDone(id: number, done: boolean) {
        const all = readAll()
        const curr: Entry = all[id] ?? {}
        curr.done = !!done
        // gdy oznaczamy done, a nie było RP – zapisz RP = total w logice wywołującej (tam mamy total)
        all[id] = curr
        writeAll(all)
      },
      clear(id?: number) {
        if (typeof id === 'number') {
          const all = readAll()
          delete all[id]
          writeAll(all)
        } else {
          writeAll({})
        }
      }
    }
  }, [])
  return api
}
