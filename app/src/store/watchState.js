/*
 * 续播 policy: where a viewer stands in a title, answered from its episode
 * list and the watch entry history.js stores for it,
 * { lastEpisodeIndex, position, duration, finished }.
 *
 * Episodes follow their `index`, never their place in the list: "next" is the
 * smallest index above the current one, "first" the smallest overall. The
 * API's list is newest-first, so in practice that is the same as walking the
 * list backwards — but a gap or an out-of-order list can't make the player's
 * Up Next and the detail page's "continue" button point at different episodes.
 *
 * Plain functions with no storage or browser imports, so watchState.test.js
 * runs under `node --test`.
 */

const RESUME_MIN_S = 30 // only resume when more than this was watched
const FINISHED_TAIL_S = 15 // this close to the end counts as finished

/** The episode after `index` (listed or not), or null after the last one. */
export function nextEpisode(episodes, index) {
  let next = null
  for (const e of episodes) if (e.index > index && (!next || e.index < next.index)) next = e
  return next
}

/** Seconds into episode `index` to start at; 0 = from the beginning. */
export function resumePosition(watch, index) {
  // A finished entry holds its position at the episode's end only so a later
  // episode can pick up from it — never resume INTO it.
  return watch && !watch.finished && watch.lastEpisodeIndex === index && watch.position > RESUME_MIN_S
    ? watch.position
    : 0
}

/**
 * The watch entry to store after playing episode `index` up to `pos` of `dur`.
 * Near the end counts as finished: the resume point moves to the start of the
 * next episode, or, with none, stays on this one marked `finished`.
 */
export function progressEntry(episodes, index, pos, dur) {
  if (dur - pos > FINISHED_TAIL_S) return { lastEpisodeIndex: index, position: pos, duration: dur, finished: false }
  const next = nextEpisode(episodes, index)
  return next
    ? { lastEpisodeIndex: next.index, position: 0, duration: dur, finished: false }
    : { lastEpisodeIndex: index, position: dur, duration: dur, finished: true }
}

/**
 * An episode's display title: the API's own title, except that a bare ordinal
 * (dramas send "第06集") reads 第6集, so every screen spells an episode the same.
 */
export function episodeTitle(ep) {
  const ordinal = `第${ep.index}集`
  const title = ep.title || ordinal
  // yfsp names most episodes by bare number ("01"), which says no more than the ordinal.
  return new RegExp(`^(第)?0*${ep.index}(集)?$`).test(title) ? ordinal : title
}

/**
 * The detail page's primary button.
 *   resumeIndex  the episode to continue (also marked in the list), or null
 *   caughtUp     the last episode was finished and nothing newer has aired
 *   playIndex    what the button plays
 *   label        what it says
 * An unfinished entry resumes as long as its episode is still listed. A
 * finished one moves on to an episode that aired since; with none, the button
 * offers a rewatch rather than silently resetting to "播放 第1集".
 */
export function primaryAction(episodes, watch) {
  const listed = !!watch && episodes.some((e) => e.index === watch.lastEpisodeIndex)
  const resumeIndex = !watch
    ? null
    : watch.finished
      ? (nextEpisode(episodes, watch.lastEpisodeIndex)?.index ?? null)
      : listed
        ? watch.lastEpisodeIndex
        : null
  const caughtUp = !!watch?.finished && listed && resumeIndex == null
  const playIndex = resumeIndex ?? nextEpisode(episodes, -Infinity)?.index ?? 1
  const label =
    resumeIndex != null ? `继续观看 第${resumeIndex}集` : `${caughtUp ? '重新观看' : '播放'} 第${playIndex}集`
  return { resumeIndex, caughtUp, playIndex, label }
}

/**
 * History entries for the 继续观看 shelf. Any watch entry counts: position 0
 * is a queued next episode, and a finished title may yet air a new one.
 */
export function continueWatching(entries) {
  return entries.filter((h) => h.watch)
}
