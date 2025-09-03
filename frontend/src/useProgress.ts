import { useMemo, useSyncExternalStore } from 'react'

type Entry = {
  rp?: number
  done?: boolean
}

type Mode = 'local' | 'memory'

const STORAGE_KEY = 'gt_progress_v2'

// --- prosta busola do powiadamiania subskrybentów ---
let version = 0
const listeners = new Set<() => void>()
function emit() {
  version++
  for (const fn of listeners) fn()
}
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function getSnapshot() {
  return version
}

// --- persystencja ---
let mode: Mode = 'local'
let mem: Record<number, Entry> = {}

function readLocal(): Record<number, Entry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') return obj as Record<number, Entry>
    return {}
  } catch {
    return {}
  }
}
function writeLocal(map: Record<number, Entry>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}
function readAll(): Record<number, Entry> {
  return mode === 'local' ? readLocal() : mem
}
function writeAll(map: Record<number, Entry>) {
  if (mode === 'local') writeLocal(map)
  else mem = map
}

// publiczne API

export function setProgressPersistence(persist: boolean) {
  // true => localStorage, false => pamięć ulotna
  mode = persist ? 'local' : 'memory'
  if (!persist) mem = {} // czysty stan dla gościa
  emit()
}

export function useProgress() {
  // subskrybuj zmiany; snapshot to „wersja” — każda mutacja ją zwiększa
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

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
      setRP(id: number, rp: number, total?: number) {
        const all = readAll()
        const curr: Entry = all[id] ?? {}
        const max = typeof total === 'number' && total > 0 ? total : Number.POSITIVE_INFINITY
        const clamped = Math.min(Math.max(0, Math.floor(rp)), max)
        curr.rp = clamped
        if (typeof total === 'number' && total > 0) {
          curr.done = clamped >= total
        }
        all[id] = curr
        writeAll(all)
        emit()
      },
      setDone(id: number, done: boolean, total?: number) {
        const all = readAll()
        const curr: Entry = all[id] ?? {}
        curr.done = !!done
        if (done && typeof total === 'number' && total > 0) {
          // przy oznaczeniu „done” ustaw RP = total dla spójności
          curr.rp = total
        }
        all[id] = curr
        writeAll(all)
        emit()
      },
      clear(id?: number) {
        if (typeof id === 'number') {
          const all = readAll()
          delete all[id]
          writeAll(all)
        } else {
          writeAll({})
        }
        emit()
      }
    }
  }, [])

  return api
}
