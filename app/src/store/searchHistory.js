/*
 * Recent search terms, most recent first and capped — the strip shown under an
 * empty search box. Persisted per device (localStorage), never sent anywhere.
 */
import { createStore } from '../hooks/useStore.js'

const LIMIT = 20

export const searchHistoryStore = createStore('yfsp:searchHistory', [])

/** Record a committed search; an existing entry moves back to the front. */
export function remember(word) {
  const term = (word || '').trim()
  if (!term) return
  searchHistoryStore.set((prev) => [term, ...prev.filter((w) => w !== term)].slice(0, LIMIT))
}

export function clear() {
  searchHistoryStore.set([])
}
