/*
 * Episode-list order per title.
 *
 * The default is descending (newest episode first) — that is the API's own
 * order and the right one for a drama that is still airing weekly. Only the
 * exceptions are persisted: a title gets an entry when the user switches it to
 * ascending, and the entry is deleted when they switch back. The map therefore
 * stays bounded to titles the user actually touched and needs no cap.
 *
 * Display order only. Pages render a reversed copy; the canonical newest-first
 * list from the source adapter's `detail` is never reordered.
 *
 * Shape: { [vodId]: true }
 */
import { createStore } from '../hooks/useStore.js'

export const episodeOrderStore = createStore('yfsp:epOrder', {})

export function isAscending(id) {
  return !!episodeOrderStore.get()[id]
}

export function setAscending(id, ascending) {
  episodeOrderStore.set((prev) => {
    if (ascending === !!prev[id]) return prev // no-op writes must not notify
    const next = { ...prev }
    if (ascending) next[id] = true
    else delete next[id]
    return next
  })
}
