/*
 * Favorites — a persisted list of favorited titles, most recently added first.
 */
import { createStore } from '../hooks/useStore.js'

export const favoritesStore = createStore('yfsp:favorites', [])

export function list() {
  return favoritesStore.get()
}

export function has(id) {
  return favoritesStore.get().some((x) => x.id === id)
}

// Add if absent (to the front), remove if present. Returns the new state.
export function toggle(item) {
  favoritesStore.set((prev) => {
    if (prev.some((x) => x.id === item.id)) return prev.filter((x) => x.id !== item.id)
    return [item, ...prev]
  })
  return favoritesStore.get()
}
