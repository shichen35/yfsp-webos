/*
 * Store skeleton + React binding.
 *
 * Each store holds an in-memory snapshot and a set of listeners. A write
 * REPLACES the snapshot reference (never mutates it in place) and persists to
 * localStorage, then notifies. Because the reference only changes on write,
 * `getSnapshot` returns a stable value between writes — which is exactly what
 * useSyncExternalStore needs to avoid infinite re-render loops.
 *
 * On the real device this is the single seam where persistence swaps to Luna
 * file I/O; the store API above it stays identical.
 */
import { useSyncExternalStore } from 'react'

/**
 * Create a localStorage-backed store.
 * @param {string} key localStorage key
 * @param {*} defaultValue used when storage is empty or unreadable
 */
export function createStore(key, defaultValue) {
  let snapshot = read()
  const listeners = new Set()

  function read() {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return defaultValue
      return JSON.parse(raw)
    } catch {
      // Corrupt JSON / storage unavailable -> fall back to the default.
      return defaultValue
    }
  }

  function write(next) {
    snapshot = next // new reference; stable until the next write
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // Quota exceeded / storage disabled: keep working from memory this session.
    }
    listeners.forEach((l) => l())
  }

  return {
    get: () => snapshot,
    set: (updater) => {
      const next = typeof updater === 'function' ? updater(snapshot) : updater
      if (next !== snapshot) write(next)
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

/**
 * Create a store that lives only in memory — same get/set/subscribe contract
 * as createStore, for state that is persisted some other way (the encrypted
 * vault) or not at all.
 * @param {*} initialValue
 */
export function createMemoryStore(initialValue) {
  let snapshot = initialValue
  const listeners = new Set()
  return {
    get: () => snapshot,
    set: (updater) => {
      const next = typeof updater === 'function' ? updater(snapshot) : updater
      if (next === snapshot) return
      snapshot = next
      listeners.forEach((l) => l())
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

/**
 * Subscribe a component to a store.
 * @param store a store from createStore
 * @param selector picks a slice; MUST return a stable reference (pick, don't
 *   compute) — e.g. `s => s.items`, not `s => s.items.filter(...)`. Derive
 *   computed values with useMemo in the component instead.
 */
export function useStoreValue(store, selector = (s) => s) {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()))
}
