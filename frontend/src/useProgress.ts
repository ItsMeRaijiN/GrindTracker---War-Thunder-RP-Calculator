import { useMemo, useSyncExternalStore } from 'react'

type Entry = {
  rp?: number
  done?: boolean
}

type Mode = 'local' | 'memory'

// ---- NAMESPACE PER-USER ----
// Domyślnie „guest”. Po zalogowaniu App.tsx wywołuje setProgressUser(userId).
let _namespace: string = 'guest'
export function setProgressUser(userId: number | null) {
  _namespace = userId ? `u_${userId}` : 'guest'
  emit() // przełączony namespace -> odśwież subskrybentów
}

// Trzymamy oddzielne klucze w localStorage dla każdego namespace’a.
// Zmieniamy też „wersję” klucza, by nie mieszać z poprzednimi zapisami.
const STORAGE_KEY_PREFIX = 'gt_progress_v3:'
const storageKey = () => `${STORAGE_KEY_PREFIX}${_namespace}`

// --- busola do powiadamiania subskrybentów ---
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

// pamięć ulotna per-namespace (żeby guest i inni nie mieszali się wzajemnie)
const memStores: Record<string, Record<number, Entry>> = {}

function readLocal(): Record<number, Entry> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey()) : null
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? (obj as Record<number, Entry>) : {}
  } catch {
    return {}
  }
}
function writeLocal(map: Record<number, Entry>) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey(), JSON.stringify(map))
    }
  } catch {
    // ignore (np. quota exceeded / SSR)
  }
}
function readMem(): Record<number, Entry> {
  return memStores[_namespace] ?? {}
}
function writeMem(map: Record<number, Entry>) {
  memStores[_namespace] = map
}
function readAll(): Record<number, Entry> {
  return mode === 'local' ? readLocal() : readMem()
}
function writeAll(map: Record<number, Entry>) {
  if (mode === 'local') writeLocal(map)
  else writeMem(map)
}

// --- Public API konfiguracji ---
export function setProgressPersistence(persist: boolean) {
  // true => localStorage, false => pamięć ulotna
  mode = persist ? 'local' : 'memory'
  // nie czyścimy celowo pamięci ulotnej przy przełączeniu,
  // bo trzymamy ją per-namespace w memStores.
  emit()
}

// --- Hook i metody operowania na progresie ---
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
        const all = { ...readAll() }
        const curr: Entry = { ...(all[id] ?? {}) }
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
        const all = { ...readAll() }
        const curr: Entry = { ...(all[id] ?? {}) }
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
          const all = { ...readAll() }
          delete all[id]
          writeAll(all)
        } else {
          writeAll({})
        }
        emit()
      },

      // Przydatne do kaskadowego kalkulatora (jeśli chcesz wysłać 1 obiekt na backend)
      exportAll(): Record<number, Entry> {
        return { ...readAll() }
      },

      // Import (opcjonalnie – gdybyś chciał zmergować z zewnętrznym stanem)
      importAll(map: Record<number, Entry>, merge: boolean = true) {
        if (!map || typeof map !== 'object') return
        if (merge) {
          const merged = { ...readAll(), ...map }
          writeAll(merged)
        } else {
          writeAll({ ...map })
        }
        emit()
      }
    }
  }, [])

  return api
}
