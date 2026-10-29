/*
 * Filters — the one owner of each category's current filter selection, held
 * for the session only. The genre/sort chips on the category page and the
 * filter panel both patch it here, and both read it back from here, so neither
 * can open on (or write back) a stale copy of the other's picks.
 *
 * Deliberately NOT persisted. A saved filter is invisible from the tab bar, so
 * launching the app into a category that silently sits on last week's
 * 地区/年代 choice reads as an empty or broken list. Every launch starts from
 * the category's default filter instead.
 *
 * Shape: { [categoryId]: { genre, area, lang, year, status, form, sort } }
 */
import { createMemoryStore, useStoreValue } from '../hooks/useStore.js'
import { DEFAULT_SORT } from '../config/taxonomy.js'

// Every category's starting filter, and what the startup prefetch warms.
// '0' is "All" for genre/area/lang/year; status and form take the gateway's -1.
export const DEFAULT_FILTER = Object.freeze({
  genre: '0',
  area: '0',
  lang: '0',
  year: '0',
  status: '-1',
  form: '-1',
  sort: DEFAULT_SORT,
})

const filtersStore = createMemoryStore({})

export function getFilter(categoryId) {
  return filtersStore.get()[categoryId] || DEFAULT_FILTER
}

/** The category's live filter; re-renders when it changes. */
export function useFilter(categoryId) {
  return useStoreValue(filtersStore, (s) => s[categoryId] || DEFAULT_FILTER)
}

/** Merge `patch` (e.g. `{ genre }`) into the category's current filter. */
export function patchFilter(categoryId, patch) {
  filtersStore.set((s) => ({ ...s, [categoryId]: { ...(s[categoryId] || DEFAULT_FILTER), ...patch } }))
}

export function resetFilter(categoryId) {
  filtersStore.set((s) => ({ ...s, [categoryId]: DEFAULT_FILTER }))
}
