// Stall ladder on the native-HLS path (hls.js reports no MSE under node).
// Run: node --test app/src/player/playbackSession.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlayback } from './playbackSession.js'

// A <video> whose decoder is wedged: writes to currentTime are recorded but
// never move the playhead; only advance() does. A 0.8s buffered hole sits
// just ahead of it.
function wedgedVideo(log) {
  const listeners = {}
  let t = 10
  return {
    paused: false,
    ended: false,
    seeking: false,
    readyState: 4,
    duration: 3600,
    seekable: { length: 1 },
    buffered: { length: 1, start: () => t + 0.8, end: () => t + 20 },
    src: '',
    get currentTime() {
      return t
    },
    set currentTime(_v) {
      log.push('nudge')
    },
    advance(s) {
      t += s
    },
    addEventListener(type, fn) {
      ;(listeners[type] ||= new Set()).add(fn)
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn)
    },
    emit(type) {
      for (const fn of [...(listeners[type] || [])]) fn()
    },
    canPlayType: () => 'maybe',
    play: () => Promise.resolve(),
    load() {
      log.push('reload')
    },
    removeAttribute() {},
  }
}

async function start(log) {
  const video = wedgedVideo(log)
  const pb = createPlayback(video, {
    src: 'http://example.test/a.m3u8',
    resumePos: 0,
    seekPending: () => false,
    onStatus: (s) => s === 'error' && log.push('error'),
    onStart() {},
    onPaused() {},
    onTrack() {},
    onTime() {},
    onBuffered() {},
    onProgress() {},
    onEnded() {},
  })
  // Wait for the hls.js import to settle; fail instead of hanging when it can't.
  for (let i = 0; !video.src; i++) {
    if (log.includes('error') || i > 1000) throw new Error('no source attached (is hls.js installed?)')
    await new Promise((r) => setImmediate(r))
  }
  video.emit('playing')
  return { video, pb }
}

test('escalates nudge -> soft reload x3 -> error on a frozen playhead, and resets after recovery', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  const log = []
  const { video, pb } = await start(log)
  const at = []
  const tickUntil = (ms, each) => {
    while (Date.now() < ms) {
      each?.()
      const n = log.length
      t.mock.timers.tick(1000)
      for (const e of log.slice(n)) at.push(`${Date.now() / 1000}s ${e}`)
    }
  }

  // Two stalls, each cured by a soft reload...
  tickUntil(17000)
  assert.deepEqual(at, ['4s nudge', '9s reload', '12s nudge', '17s reload'])

  // ...then 31s of clean playback clears the reload count...
  at.length = 0
  tickUntil(49000, () => video.advance(1))
  assert.deepEqual(at, [])

  // ...so the next stall gets the full three reloads before giving up.
  tickUntil(81000)
  assert.deepEqual(at, [
    '52s nudge',
    '57s reload',
    '60s nudge',
    '65s reload',
    '68s nudge',
    '73s reload',
    '76s nudge',
    '81s error',
  ])

  pb.destroy()
})
