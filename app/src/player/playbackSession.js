/*
 * One playback session: a stream attached to a <video> element, from the
 * first load to teardown. No React in here — the player page decides WHAT to
 * play and where to resume; this owns HOW: hls.js setup (native HLS as the
 * fallback), the resume seek, the stall-recovery ladder, seekability, and
 * sampling the position for progress saves. Everything it learns goes back
 * out through the callbacks; `destroy()` flushes once more and detaches.
 *
 * hls.js arrives via dynamic import() so it never enters the startup bundle.
 * It drives playback everywhere, the TV included: only hls.js lets us set a
 * deep, memory-bounded forward buffer, and the native webOS HLS pipeline
 * (shallow, untunable buffer) stuttered on heavy 1080p streams — it would
 * drain and stall repeatedly. Native canPlayType is kept only as a fallback
 * for when MSE is unavailable.
 */

const PROGRESS_FLUSH_MS = 5000 // persist watch progress cadence

// Native-path stall watchdog. The on-device webOS pipeline has no built-in
// gap/nudge recovery (hls.js runs its own gapController on the dev path), so a
// buffer hole or a decoder stall freezes playback until a manual seek — the
// "卡住，只能快进快退救回来" symptom. These drive the auto-recovery ladder:
// jump a hole -> nudge the decoder -> soft-reload from the last position ->
// finally surface the error screen.
const STALL_CHECK_MS = 1000
const STALL_NUDGE_AFTER_MS = 3000 // currentTime frozen this long -> jump/nudge
const STALL_RELOAD_AFTER_MS = 8000 // frozen + buffer not filling -> soft reload
const STALL_HARD_MS = 15000 // frozen this long -> reload even while "buffering"
const STALL_ADVANCE_EPS_S = 0.25 // currentTime moving less than this = frozen
const STALL_HOLE_MAX_S = 1 // a buffered-range gap up to this counts as a hole
const MAX_SOFT_RELOADS = 3 // consecutive soft reloads before the error screen
const RECOVERY_RESET_MS = 30000 // sustained playback clears the reload count

// hls.js buffering — the actual fix for stutter on heavy 1080p/high-bitrate
// streams. A deep forward buffer means a slow segment or a busy-CPU moment
// can't drain playback; maxBufferSize keeps that buffer bounded so a small-RAM
// TV never blows up. Back buffer is trimmed to return decoded memory.
const HLS_CONFIG = {
  maxBufferLength: 60, // target forward buffer, seconds (hls.js default 30)
  maxMaxBufferLength: 120, // hard ceiling on buffer length, seconds
  maxBufferSize: 60 * 1000 * 1000, // memory ceiling, ~60 MB
  backBufferLength: 30, // reclaim decoded data this far behind the playhead
}

// Highest quality below the 1440p tier — UHD is too heavy to auto-select.
// Returns -1 when the master has no such level; then hls.js keeps its own
// ABR choice.
function pickStartLevel(levels) {
  let best = -1
  for (let i = 0; i < levels.length; i++) {
    const h = levels[i].height || 0
    if (h >= 1440) continue
    if (
      best === -1 ||
      h > (levels[best].height || 0) ||
      (h === (levels[best].height || 0) && levels[i].bitrate > levels[best].bitrate)
    ) {
      best = i
    }
  }
  return best
}

// Flat short retries — exponential backoff turns one transient failure into a
// multi-second black screen before playback even starts.
const FLAT_RETRY = { maxNumRetry: 4, retryDelayMs: 200, maxRetryDelayMs: 200 }
const LOAD_POLICY = {
  default: {
    maxTimeToFirstByteMs: 8000,
    maxLoadTimeMs: 20000,
    timeoutRetry: FLAT_RETRY,
    errorRetry: FLAT_RETRY,
  },
}

/*
 * createPlayback(video, options) -> { started, seekable, destroy() }
 *
 *   src          stream url to attach
 *   resumePos    seconds to start from (0 = the beginning)
 *   seekPending  () => bool; a seek the user is still stepping toward holds
 *                the watchdog off
 *   onStatus(status, kind)  'ok' on every 'playing'; 'error' with a kind
 *                (network | decode | source), or none when the stall ladder
 *                runs out
 *   onStart(canSeek)        first 'playing' of this load
 *   onPaused(paused)
 *   onTrack(info)           { width, height, bitrate } of the playing level
 *   onTime(pos, dur)        every timeupdate once the duration is known
 *   onBuffered(end, dur)    buffered end around the playhead
 *   onProgress(pos, dur)    the position worth saving: every 5s while
 *                playing, at the end, and on destroy
 *   onEnded()               after the final onProgress
 */
export function createPlayback(video, opts) {
  const { src, resumePos, seekPending } = opts
  let hls = null
  let cancelled = false
  let started = false // first 'playing' of THIS episode load
  let resumeCorrected = false
  const currentSrc = src // the watchdog reloads from here on a native-path stall
  let seekable = true // assume seekable until the stream says otherwise
  let pendingMeta = null // a native soft reload's seek-back, until metadata arrives

  const fail = (kind) => opts.onStatus('error', kind)

  // Live truth, not the sampled flag: resume decisions run before anything
  // has seen the update.
  const canSeek = () =>
    Number.isFinite(video.duration) && video.duration > 0 && video.seekable && video.seekable.length > 0
  const updateSeekable = () => {
    seekable = canSeek()
  }

  // Positions come from timeupdate ticks (lastKnown), never a live read at
  // flush time: on the TV's native pipeline currentTime can already read 0
  // during suspend/teardown, which must not clobber real progress.
  const lastKnown = { pos: NaN, dur: NaN }
  const flushProgress = () => {
    const { pos, dur } = lastKnown
    if (!started || !Number.isFinite(pos) || !Number.isFinite(dur) || dur <= 0) return
    opts.onProgress(pos, dur)
  }
  const flushTimer = setInterval(() => {
    if (started && !video.paused) flushProgress()
  }, PROGRESS_FLUSH_MS)

  // Re-attach the stream in place and seek back to `pos`, without tearing the
  // page down or flashing the loading screen. hls.js just re-arms its loader
  // (it can re-fetch from an exact position); the native pipeline needs the
  // src set again, then a seek once metadata is back.
  const softReload = (pos) => {
    const wantPos = Number.isFinite(pos) && pos > 1 ? pos : lastKnown.pos > 1 ? lastKnown.pos : 0
    if (hls) {
      try {
        hls.startLoad(wantPos > 0 ? wantPos : -1)
      } catch {
        /* loader already gone */
      }
      video.play().catch(() => {})
      return
    }
    if (!currentSrc) return
    if (pendingMeta) video.removeEventListener('loadedmetadata', pendingMeta)
    const onMeta = () => {
      video.removeEventListener('loadedmetadata', onMeta)
      pendingMeta = null
      if (wantPos > 0) {
        try {
          video.currentTime = wantPos
        } catch {
          /* duration not ready yet; timeupdate resume covers it */
        }
      }
      video.play().catch(() => {})
    }
    pendingMeta = onMeta
    video.addEventListener('loadedmetadata', onMeta)
    video.src = currentSrc
    video.load()
  }

  // Watchdog: once playback has started, currentTime must keep advancing.
  // With hls.js managing a deep buffer this rarely fires — it's the safety
  // net for a true stall. Crucially it is buffering-aware: while the buffer
  // is still filling, playback is rebuffering normally and we leave it be
  // (interrupting a healthy refill is what made recovery feel choppy). We
  // only intervene when frozen AND the buffer has stopped growing — or when
  // frozen past a hard ceiling (a decoder deadlock that never resumes).
  const bufferedEndNearby = () => {
    const b = video.buffered
    let end = 0
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= video.currentTime + 0.5 && b.end(i) > end) end = b.end(i)
    }
    return end
  }
  let lastAdvancePos = NaN
  let lastAdvanceAt = Date.now()
  let lastBufEnd = 0
  let nudged = false
  let softReloads = 0
  let lastReloadAt = 0
  const watchdog = setInterval(() => {
    const now = Date.now()
    if (!started || video.paused || video.ended || video.seeking || seekPending()) {
      lastAdvanceAt = now // not our kind of stall — keep the clock fresh
      return
    }
    const t = video.currentTime
    if (!Number.isFinite(lastAdvancePos) || Math.abs(t - lastAdvancePos) > STALL_ADVANCE_EPS_S) {
      lastAdvancePos = t
      lastAdvanceAt = now
      nudged = false
      if (now - lastReloadAt > RECOVERY_RESET_MS) softReloads = 0 // clean run
      return
    }
    const frozenMs = now - lastAdvanceAt
    // Buffer still growing? Healthy rebuffering — wait it out (up to the hard
    // ceiling), don't touch it. The freeze clock keeps running so a buffer
    // that grows forever without playback resuming still escalates.
    const end = bufferedEndNearby()
    const bufferGrowing = end > lastBufEnd + 0.1
    lastBufEnd = end
    if (bufferGrowing && frozenMs < STALL_HARD_MS) return

    if (frozenMs >= STALL_RELOAD_AFTER_MS) {
      if (softReloads >= MAX_SOFT_RELOADS) {
        opts.onStatus('error')
        return
      }
      softReloads += 1
      lastReloadAt = now
      lastAdvanceAt = now
      nudged = false
      softReload(t) // hls.js: re-arm its loader; native: re-attach + seek
      return
    }
    // Native fallback only — hls.js runs its own gapController/nudge, so a
    // second nudge on top would fight it.
    if (!hls && frozenMs >= STALL_NUDGE_AFTER_MS && !nudged) {
      nudged = true
      const b = video.buffered
      let jumped = false
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) > t && b.start(i) - t <= STALL_HOLE_MAX_S) {
          video.currentTime = b.start(i) + 0.01 // jump a buffered-range hole
          jumped = true
          break
        }
      }
      // Data present but the decoder is wedged — micro-nudge. Nothing buffered
      // (readyState low) means true starvation; leave it for the reload step.
      if (!jumped && video.readyState >= 2 /* HAVE_CURRENT_DATA */) {
        video.currentTime = t + 0.1
      }
      video.play().catch(() => {})
    }
  }, STALL_CHECK_MS)

  const onPlaying = () => {
    opts.onStatus('ok')
    // hls.js can snap the first frame back to 0 — correct once.
    updateSeekable()
    if (resumePos > 0 && !resumeCorrected) {
      resumeCorrected = true
      if (canSeek() && video.currentTime < resumePos - 3) video.currentTime = resumePos
    }
    if (!started) {
      started = true
      opts.onStart(canSeek())
    }
  }
  const onLoadedMeta = () => {
    // Native-HLS resume: seek as soon as the duration is known.
    if (resumePos > 0 && canSeek() && video.currentTime < resumePos - 3) video.currentTime = resumePos
  }
  const onDurationChange = () => updateSeekable()
  const onVideoError = () => {
    // MediaError: 2 = network, 3 = decode, 4 = source not supported.
    const code = video.error?.code
    fail(code === 2 ? 'network' : code === 3 ? 'decode' : 'source')
  }
  // Native-HLS fallback only: no level data, so the element's own frame size
  // is all there is. On the hls.js path LEVEL_SWITCHED is the better source.
  const onResize = () => {
    if (hls) return
    if (video.videoHeight > 0) opts.onTrack({ width: video.videoWidth, height: video.videoHeight, bitrate: 0 })
  }
  const onPlay = () => opts.onPaused(false)
  const onPause = () => opts.onPaused(true)
  const onTime = () => {
    const dur = video.duration
    if (!Number.isFinite(dur) || dur <= 0) return
    // Feed the flush position. A snap to exactly 0 from well into playback is
    // a pipeline reset, not a user seek — never let it become the flush value.
    if (!(video.currentTime === 0 && lastKnown.pos > 1)) {
      lastKnown.pos = video.currentTime
      lastKnown.dur = dur
    }
    opts.onTime(video.currentTime, dur)
  }
  const onEnded = () => {
    flushProgress()
    opts.onEnded()
  }
  const onProgress = () => {
    const dur = video.duration
    if (!Number.isFinite(dur) || dur <= 0) return
    opts.onBuffered(bufferedEndNearby(), dur)
  }
  video.addEventListener('playing', onPlaying)
  video.addEventListener('loadedmetadata', onLoadedMeta)
  video.addEventListener('durationchange', onDurationChange)
  video.addEventListener('resize', onResize)
  video.addEventListener('error', onVideoError)
  video.addEventListener('play', onPlay)
  video.addEventListener('pause', onPause)
  video.addEventListener('timeupdate', onTime)
  video.addEventListener('progress', onProgress)
  video.addEventListener('ended', onEnded)

  ;(async () => {
    try {
      // hls.js first — everywhere, TV included. The light build is enough (no
      // subtitles/alt-audio/DRM) and stays under the bundler's 500 kB warning.
      const { default: Hls } = await import('hls.js/light')
      if (cancelled) return
      if (Hls.isSupported()) {
        hls = new Hls({
          autoStartLoad: false, // wait for MANIFEST_PARSED to pick the start level
          ...HLS_CONFIG,
          manifestLoadPolicy: LOAD_POLICY,
          playlistLoadPolicy: LOAD_POLICY,
          fragLoadPolicy: LOAD_POLICY,
        })
        hls.on(Hls.Events.MANIFEST_PARSED, (_evt, parsed) => {
          const lvl = pickStartLevel(parsed.levels || [])
          if (lvl >= 0) {
            hls.startLevel = lvl
            hls.autoLevelCapping = lvl // ABR stays below the UHD tier
          }
          // Resume at load time — starting at 0 and seeking would double-buffer.
          hls.startLoad(resumePos > 0 ? resumePos : -1)
          video.play().catch(() => {})
        })
        // ABR moves between levels while playing; follow the one in use.
        hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, info) => {
          const lvl = hls?.levels?.[info.level]
          if (lvl) opts.onTrack({ width: lvl.width, height: lvl.height, bitrate: lvl.bitrate })
        })
        hls.on(Hls.Events.ERROR, (_evt, info) => {
          if (!info.fatal) return
          fail(
            info.type === Hls.ErrorTypes.NETWORK_ERROR
              ? 'network'
              : info.type === Hls.ErrorTypes.MEDIA_ERROR
                ? 'decode'
                : 'source',
          )
        })
        hls.attachMedia(video)
        hls.loadSource(src)
        return
      }

      // Fallback: native HLS (untunable, shallow buffer). Only reached where
      // MSE is unavailable; the watchdog's full recovery ladder covers it.
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src
        video.play().catch(() => {})
        return
      }
      fail('source') // no MSE and no native HLS
    } catch {
      if (!cancelled) fail('source')
    }
  })()

  return {
    get started() {
      return started
    },
    get seekable() {
      return seekable
    },
    destroy() {
      cancelled = true
      // Flush the outgoing episode's progress before teardown — covers exit,
      // retry, and episode switches alike.
      clearInterval(flushTimer)
      clearInterval(watchdog)
      flushProgress()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('loadedmetadata', onLoadedMeta)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('resize', onResize)
      video.removeEventListener('error', onVideoError)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('progress', onProgress)
      video.removeEventListener('ended', onEnded)
      // The <video> outlives this session: a seek-back still waiting for
      // metadata would otherwise fire on the next episode's load.
      if (pendingMeta) video.removeEventListener('loadedmetadata', pendingMeta)
      if (hls) hls.destroy()
      // Drop the native source too so no segment request outlives the page.
      video.removeAttribute('src')
      video.load()
    },
  }
}
