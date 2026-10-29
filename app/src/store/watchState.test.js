// node --test app/src/store/watchState.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextEpisode, resumePosition, progressEntry, primaryAction, continueWatching, episodeTitle } from './watchState.js'

// Newest-first, like the source adapter's detail returns them.
const eps = (...idx) => idx.map((index) => ({ index }))
const w = (lastEpisodeIndex, position, finished = false) => ({ lastEpisodeIndex, position, duration: 1200, finished })

test('primary action and resume point per (episodes, watch)', () => {
  const rows = [
    // name, episodes, watch, [resumeIndex, caughtUp, playIndex, label], resumePosition(watch, resumeIndex)
    ['never watched', eps(3, 2, 1), null, [null, false, 1, '播放 第1集'], 0],
    ['mid-episode', eps(3, 2, 1), w(2, 600), [2, false, 2, '继续观看 第2集'], 600],
    ['barely started', eps(3, 2, 1), w(2, 20), [2, false, 2, '继续观看 第2集'], 0],
    ['position-0 queued next', eps(3, 2, 1), w(3, 0), [3, false, 3, '继续观看 第3集'], 0],
    ['finished, caught up', eps(3, 2, 1), w(3, 1200, true), [null, true, 1, '重新观看 第1集'], 0],
    ['finished, new episode aired', eps(4, 3, 2, 1), w(3, 1200, true), [4, false, 4, '继续观看 第4集'], 0],
    ['watched episode deleted', eps(3, 1), w(2, 600), [null, false, 1, '播放 第1集'], 0],
    ['finished episode deleted, newer one listed', eps(4, 2, 1), w(3, 1200, true), [4, false, 4, '继续观看 第4集'], 0],
    ['finished episode deleted, nothing newer', eps(2, 1), w(3, 1200, true), [null, false, 1, '播放 第1集'], 0],
    ['no episodes', [], null, [null, false, 1, '播放 第1集'], 0],
    ['watched, but the list came back empty', [], w(2, 600), [null, false, 1, '播放 第1集'], 0],
    ['movie, mid-way', eps(1), w(1, 600), [1, false, 1, '继续观看 第1集'], 600],
    ['movie, finished', eps(1), w(1, 1200, true), [null, true, 1, '重新观看 第1集'], 0],
    ['list starts past episode 1', eps(12, 11, 10), null, [null, false, 10, '播放 第10集'], 0],
  ]
  for (const [name, list, watch, [resumeIndex, caughtUp, playIndex, label], pos] of rows) {
    assert.deepEqual(primaryAction(list, watch), { resumeIndex, caughtUp, playIndex, label }, name)
    assert.equal(resumePosition(watch, resumeIndex), pos, name)
  }
})

test('resume only into the same, unfinished episode', () => {
  assert.equal(resumePosition(w(2, 600), 3), 0)
  assert.equal(resumePosition(w(3, 1200, true), 3), 0)
})

test('next episode goes by index, not list position', () => {
  assert.equal(nextEpisode(eps(5, 3, 2), 3).index, 5) // gap
  assert.equal(nextEpisode(eps(2, 5, 3, 1), 3).index, 5) // out of order
  assert.equal(nextEpisode(eps(5, 3, 2), 4).index, 5) // current not listed
  assert.equal(nextEpisode(eps(5, 3, 2), 5), null)
})

test('what to record when playback stops', () => {
  const list = eps(3, 2, 1)
  assert.deepEqual(progressEntry(list, 2, 600, 1200), w(2, 600))
  assert.deepEqual(progressEntry(list, 2, 1190, 1200), w(3, 0)) // finished -> next episode queued at 0
  assert.deepEqual(progressEntry(list, 3, 1190, 1200), w(3, 1200, true)) // finished the last one
})

test('continue shelf keeps queued and finished entries, drops bare opens', () => {
  const entries = [{ id: 1, watch: w(3, 0) }, { id: 2, watch: null }, { id: 3, watch: w(3, 1200, true) }]
  assert.deepEqual(continueWatching(entries).map((h) => h.id), [1, 3])
})

test('episode titles normalize bare ordinals and keep real titles', () => {
  assert.equal(episodeTitle({ index: 6, title: '第06集' }), '第6集')
  assert.equal(episodeTitle({ index: 6, title: '第6集' }), '第6集')
  assert.equal(episodeTitle({ index: 6, title: '06' }), '第6集')
  assert.equal(episodeTitle({ index: 800, title: '0801' }), '0801')
  assert.equal(episodeTitle({ index: 1181, title: 'SP01' }), 'SP01')
  assert.equal(episodeTitle({ index: 6 }), '第6集')
  assert.equal(episodeTitle({ index: 6, title: '' }), '第6集')
  assert.equal(episodeTitle({ index: 16, title: '第6集' }), '第6集') // another episode's ordinal is a title
  assert.equal(episodeTitle({ index: 3, title: '上期' }), '上期')
})
