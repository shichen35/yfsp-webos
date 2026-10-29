/*
 * Watch history — a capped, most-recent-first list of watched titles, each
 * carrying resume progress { lastEpisodeIndex, position, duration, finished }.
 *
 * `watch` is the resume point: position 0 means "start this episode from the
 * beginning" (the previous one was finished); null means never played far
 * enough to be worth resuming. `finished: true` marks that lastEpisodeIndex
 * was watched to its end with no next episode at the time — kept (instead of
 * cleared) so a title that later airs a new episode can resume there instead
 * of losing all trace of how far it got.
 *
 * `updatedAt` is when playback last wrote to this entry — the player is the
 * only writer, so opening a detail page never counts as watching it. Entries
 * saved before this field existed simply have no time to show.
 *
 * What a watch entry means for the viewer (resume point, next episode, the
 * detail page's primary button, the 继续观看 shelf) is watchState.js's call;
 * this file only stores it.
 */
import { createStore } from '../hooks/useStore.js'
import { progressEntry } from './watchState.js'

const CAP = 40

export const historyStore = createStore('yfsp:history', [])

export function list() {
  return historyStore.get()
}

// Record (or bump to front) that a title was opened. Preserves any existing
// resume progress for that title.
export function recordHistory(item) {
  historyStore.set((prev) => {
    const existing = prev.find((x) => x.id === item.id)
    const rest = prev.filter((x) => x.id !== item.id)
    const entry = { ...item, watch: existing?.watch || null, updatedAt: Date.now() }
    return [entry, ...rest].slice(0, CAP)
  })
}

// Record that episode `index` of `episodes` played up to `position` of
// `duration`, and bump the title to the front. If the title isn't in history
// yet, it is added (so progress from a fresh play is kept).
export function recordProgress(id, episodes, index, position, duration) {
  historyStore.set((prev) => {
    const existing = prev.find((x) => x.id === id)
    const rest = prev.filter((x) => x.id !== id)
    const base = existing || { id }
    return [
      { ...base, watch: progressEntry(episodes, index, position, duration), updatedAt: Date.now() },
      ...rest,
    ].slice(0, CAP)
  })
}

export function getWatchState(id) {
  return historyStore.get().find((x) => x.id === id)?.watch || null
}

/** Drop one title (the library's per-card delete in 管理 mode). */
export function remove(id) {
  historyStore.set((prev) => prev.filter((x) => x.id !== id))
}

export function clear() {
  historyStore.set([])
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * When an entry was last watched, in the words a history list wants:
 * 刚刚 / 今天 / 昨天 / 9月11日 / 2025年9月11日. The year only shows once it
 * differs from this one, and a missing timestamp renders nothing.
 */
export function formatWatchedAt(ts) {
  if (!ts) return ''
  const now = Date.now()
  if (now >= ts && now - ts < 60000) return '刚刚'
  const when = new Date(ts)
  const today = new Date()
  if (sameDay(when, today)) return '今天'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(when, yesterday)) return '昨天'
  const day = `${when.getMonth() + 1}月${when.getDate()}日`
  return when.getFullYear() === today.getFullYear() ? day : `${when.getFullYear()}年${day}`
}
