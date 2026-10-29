/*
 * Full-screen HLS player (the "player" focus layer, above "detail").
 *
 * Key machine (all keys intercepted by the player layer's focus frame; Back
 * unwinds one level at a time):
 *   bar hidden: Down = show bar · Up = show the key hint · Left/Right = seek
 *               step (long-press repeats, step grows each held second)
 *               OK = play/pause (pausing shows the bar) · Back = exit
 *   bar shown:  Up = hide bar · Down = episode strip · Left/Right = same seek
 *               step · OK = play/pause · Back = hide bar
 *   strip open: Left/Right = move between episodes (focus engine scrolls the
 *               row) · OK = jump to it, strip stays up so you can keep hopping
 *               (the stream reloads behind the strip, no loading takeover) ·
 *               Up/Back = back to the plain bar
 *   any state: the remote's media keys — play / pause (or the combined
 *               play-pause), fast-forward and rewind by 30s, stop = leave the
 *               player. They never move focus, so no state can want them.
 *   Seeks accumulate into a pending target and only commit after the key has
 *   settled for ~500ms — no burst of segment requests while stepping.
 *
 * The strip lists episodes in the order the user picked for this title on the
 * detail page, so Left/Right walks them the same way in both places.
 *
 * Failures are told apart rather than pooled into one "加载失败": hls.js's
 * fatal error type and the <video> element's error code separate a network
 * problem from a decode problem from a dead source. A VIP episode is its own
 * case (auto-advance can land on one; there is no sign-in to offer), and so is
 * the gateway asking for a human check (code 5), which no retry here can pass.
 *
 * Every episode resolves its stream on the way in (resolveStream): the m3u8
 * carries a ~48h token signed for the requesting IP, so it is never cached.
 *
 * A stream the pipeline can't seek (no seekable range, or no finite duration)
 * turns every seek into a no-op; resume then starts from the beginning, with a
 * toast saying so, rather than silently losing the saved position.
 *
 * The title chip (top-left) shows/hides together with the control bar. A
 * smaller quality chip sits under it with the tier's name (标清 576P), the
 * playing resolution and the level's declared bitrate; it is dropped when
 * nothing is known yet. Logged out there is one playable tier, so there is no
 * quality picker; playback speed is always 1x — there is no bottom panel.
 *
 * Performance: progress/timecode updates go straight to the DOM via refs on
 * `timeupdate` — playback must not re-render the component every second.
 *
 * The stream itself — hls.js, the resume seek, stall recovery, position
 * sampling — lives in playbackSession.js; this page decides what to play and
 * where to resume, and renders what the session reports. PlayerPage itself is
 * lazy() (see App.jsx) and the session pulls hls.js in with import(), so
 * neither enters the startup bundle.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { loadDetail } from '../api/feeds.js'
import { mediaUrl } from '../api/luna.js'
import { resolveStream, toSummary } from '../source/index.js'
import { createPlayback } from './playbackSession.js'
import Icon, { IconLabel } from '../components/Icon.jsx'
import { recordHistory, recordProgress, getWatchState } from '../store/history.js'
import { nextEpisode, resumePosition, episodeTitle } from '../store/watchState.js'
import { episodeOrderStore } from '../store/episodeOrder.js'
import { useStoreValue } from '../hooks/useStore.js'
import { useFocusable, useFocusFrame, focusTo, isBackKey } from '../hooks/useFocus.js'

const LAYER = 'player'

const STEP_S = 15 // seek step per tap, bar shown or hidden (long-press ramps it)
const MEDIA_STEP_S = 30 // the remote's FF/REW keys jump further than the D-pad
const SEEK_SETTLE_MS = 500 // commit the pending seek once input settles
const SEEK_REPEAT_MS = 200 // long-press step cadence (native key repeat, throttled)
const BADGE_LINGER_MS = 800 // keep the target badge up briefly after committing
const BAR_HIDE_MS = 5000

const TOAST_MS = 3000
const HINT_MS = 6000 // the key table is longer than a toast; any key closes it sooner

const HINT_ROWS = [
  ['OK', '播放 / 暂停'],
  ['左 / 右', '快退 / 快进 15 秒，长按加速'],
  ['下', '调出控制条，再按下键选集'],
  ['上', '查看本提示'],
  ['返回', '退出播放'],
  ['媒体键', '播放暂停、快进快退 30 秒、停止退出'],
]

const UP_NEXT_S = 30 // remaining time that surfaces the Up Next card

// "1920 × 1080 · 5.2 Mbps" — the level's declared bitrate, not a bandwidth
// estimate. The native-HLS fallback has no level data, so it contributes the
// resolution alone; with nothing known at all the caller drops the line.
function fmtTrack(info) {
  if (!info || !info.height) return ''
  const size = `${info.width || '?'} × ${info.height}`
  if (!info.bitrate) return size
  const mbps = info.bitrate / 1000000
  return `${size} · ${mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${Math.round(info.bitrate / 1000)} kbps`}`
}

function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0
  s = Math.floor(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// webOS remote media keys. The key names cover browsers that report them
// instead of the webOS key codes.
const MEDIA_KEYCODES = { 415: 'play', 19: 'pause', 413: 'stop', 417: 'forward', 412: 'rewind' }
const MEDIA_KEYNAMES = {
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaPlayPause: 'toggle',
  MediaStop: 'stop',
  MediaFastForward: 'forward',
  MediaRewind: 'rewind',
}
function mediaKey(e) {
  return MEDIA_KEYCODES[e.keyCode] || MEDIA_KEYNAMES[e.key] || null
}

// What each failure means, in the words the couch needs.
const ERROR_TEXT = {
  network: '网络连接不稳定，请重试',
  decode: '解码失败，可换一集或稍后重试',
  source: '片源暂不可用',
  vip: '这一集需要爱壹帆会员，本应用暂不支持登录',
  challenge: '访问受限，请稍后再试',
}

// A failed resolveStream: an ApiError is the gateway's verdict, anything else
// a transport failure.
function resolveErrorKind(e) {
  if (e?.name !== 'ApiError') return 'network'
  return e.code === 5 ? 'challenge' : 'source'
}

function ErrorButton({ col, icon, label, primary, onSelect }) {
  const { props } = useFocusable({ layer: LAYER, group: 'content', row: 0, col, onSelect })
  return (
    <span
      className={`focusable tile-btn ${primary ? 'bg-accent text-inverse' : 'bg-elev-2 text-fg'}`}
      {...props}
    >
      {icon ? <IconLabel icon={icon}>{label}</IconLabel> : label}
    </span>
  )
}

// One cell in the episode strip. A real focusable (group 'episodes', single row)
// so the focus engine drives horizontal navigation + scrollIntoView for free,
// and a click jumps straight to that episode. The currently-playing cell is
// tinted with the accent so it reads even before focus lands on it. The 66px
// line-height is the 72px cell minus the focusable's 3px borders: it centers
// the label without flex, which would break the truncate ellipsis.
function StripCell({ col, label, isCurrent, onSelect }) {
  const { props } = useFocusable({ layer: LAYER, group: 'episodes', row: 0, col, onSelect })
  return (
    <div
      className={`focusable shrink-0 max-w-[240px] truncate h-[72px] rounded-tile bg-glass-active px-6 text-center text-label leading-[66px] ${isCurrent ? 'text-accent' : 'text-fg-2'}`}
      {...props}
    >
      {label}
    </div>
  )
}

export default function PlayerPage({ id, episodeIndex }) {
  const videoRef = useRef(null)
  const [data, setData] = useState(null) // normalized detail (title + episodes)
  const [curEp, setCurEp] = useState(episodeIndex)
  const [status, setStatus] = useState('loading') // loading | ok | error
  const [attempt, setAttempt] = useState(0) // bump to tear down and retry
  const [barVisible, setBarVisible] = useState(false)
  const [stripVisible, setStripVisible] = useState(false) // bottom episode strip
  const [toast, setToast] = useState(null) // resume notice; static, 3s
  const toastTimerRef = useRef(null)
  const [upNext, setUpNext] = useState(false) // Up Next card visible
  const [switching, setSwitching] = useState(false) // episode-change reload
  const [hint, setHint] = useState(false) // key-hint card
  const [paused, setPaused] = useState(false) // drives the bar's play/pause icon
  const [trackInfo, setTrackInfo] = useState(null) // { width, height, bitrate } of the playing level
  const [errorKind, setErrorKind] = useState(null) // network | decode | source | vip | challenge
  const [streamLabel, setStreamLabel] = useState('') // the tier resolveStream picked, e.g. 标清 576P
  const playbackRef = useRef(null) // the current episode's playback session

  const statusRef = useRef(status)
  statusRef.current = status
  const barRef = useRef(barVisible)
  barRef.current = barVisible
  const stripRef = useRef(stripVisible)
  stripRef.current = stripVisible
  const upNextRef = useRef(upNext)
  upNextRef.current = upNext
  const upNextDismissedRef = useRef(false) // per-episode: Back/Up dismissed it
  const hintRef = useRef(hint)
  hintRef.current = hint

  const epList = data?.episodes || []
  const epListRef = useRef(epList) // key handler reads the live list without re-binding
  epListRef.current = epList
  const curIdx = epList.findIndex((e) => e.index === curEp)
  const nextEp = nextEpisode(epList, curEp)
  const nextEpIndex = nextEp?.index ?? null
  const nextEpRef = useRef(null)
  nextEpRef.current = nextEpIndex

  // The 选集 strip mirrors the order the user picked on the detail page, so
  // Left/Right walk the episodes the same way in both places. `epList` itself
  // stays canonical, so only a reversed COPY is rendered, and the strip's own
  // cursor index has to be mirrored along with it.
  const ascending = !!useStoreValue(episodeOrderStore)[id]
  const stripList = ascending ? [...epList].reverse() : epList
  const stripIdx = curIdx < 0 ? 0 : ascending ? epList.length - 1 - curIdx : curIdx

  // High-frequency playback feedback goes straight to these DOM nodes.
  const playedRef = useRef(null)
  const bufferedRef = useRef(null)
  const curTimeRef = useRef(null)
  const remainRef = useRef(null)
  const badgeRef = useRef(null)

  const pendingSeekRef = useRef(null) // accumulated target while stepping
  const seekTimerRef = useRef(null) // settle timer
  const badgeTimerRef = useRef(null)
  const lastStepAtRef = useRef(0)
  const holdStartAtRef = useRef(0) // when the current long-press began
  const hideTimerRef = useRef(null)

  // ---------------------------------------------------------------------
  // control bar visibility + auto-hide
  // ---------------------------------------------------------------------
  const armHideTimer = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(function tick() {
      const v = videoRef.current
      if (v && v.paused) {
        // Stays visible while paused; check again later.
        hideTimerRef.current = setTimeout(tick, BAR_HIDE_MS)
        return
      }
      setBarVisible(false)
      setStripVisible(false)
    }, BAR_HIDE_MS)
  }, [])

  const showBar = useCallback(() => {
    setBarVisible(true)
    armHideTimer()
  }, [armHideTimer])

  const hideBar = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    setBarVisible(false)
    setStripVisible(false)
  }, [])

  // Episode strip is a sub-state of the shown bar: Down from the bar opens it,
  // Up/Back closes it back to the plain bar. Either way the bar's auto-hide keeps
  // running so both fade together after inactivity.
  const showStrip = useCallback(() => {
    setStripVisible(true)
    armHideTimer()
  }, [armHideTimer])

  const hideStrip = useCallback(() => {
    setStripVisible(false)
    armHideTimer()
  }, [armHideTimer])

  useEffect(
    () => () => {
      clearTimeout(hideTimerRef.current)
      clearTimeout(toastTimerRef.current)
    },
    [],
  )

  // ---------------------------------------------------------------------
  // seeking — accumulate, preview, commit on settle
  // ---------------------------------------------------------------------
  const showBadge = useCallback((dir, target) => {
    const el = badgeRef.current
    if (!el) return
    // Straight to the DOM like the timecodes: no re-render per step.
    el.children[0].style.display = dir < 0 ? 'block' : 'none'
    el.children[1].style.display = dir < 0 ? 'none' : 'block'
    el.children[2].textContent = fmtTime(target)
    el.style.display = 'flex'
    clearTimeout(badgeTimerRef.current)
  }, [])

  const stepSeek = useCallback(
    (deltaS, isRepeat) => {
      const v = videoRef.current
      const dur = v?.duration
      if (!v || !Number.isFinite(dur) || dur <= 0) return
      if (!playbackRef.current?.seekable) return // unseekable source: every step is a no-op
      const now = Date.now()
      if (!isRepeat) holdStartAtRef.current = now // a fresh press resets the ramp
      if (isRepeat && now - lastStepAtRef.current < SEEK_REPEAT_MS) return
      lastStepAtRef.current = now

      // Long-press acceleration: 4x per held second, unbounded; a tap is always 1x.
      const heldS = isRepeat ? Math.floor((now - holdStartAtRef.current) / 1000) : 0
      const mult = Math.max(1, heldS * 4)

      const base = pendingSeekRef.current ?? v.currentTime
      const target = Math.min(Math.max(base + deltaS * mult, 0), Math.max(dur - 2, 0))
      pendingSeekRef.current = target
      showBadge(deltaS, target)
      // Preview cursor: while the bar is up, the played track follows the target.
      if (barRef.current && playedRef.current) {
        playedRef.current.style.width = `${(target / dur) * 100}%`
      }

      clearTimeout(seekTimerRef.current)
      seekTimerRef.current = setTimeout(() => {
        const t = pendingSeekRef.current
        pendingSeekRef.current = null
        const vid = videoRef.current
        if (t != null && vid) vid.currentTime = t
        badgeTimerRef.current = setTimeout(() => {
          if (badgeRef.current) badgeRef.current.style.display = 'none'
        }, BADGE_LINGER_MS)
      }, SEEK_SETTLE_MS)
    },
    [showBadge],
  )

  useEffect(
    () => () => {
      clearTimeout(seekTimerRef.current)
      clearTimeout(badgeTimerRef.current)
    },
    [],
  )

  // Key hint: every video opened with no saved watch progress shows it, and
  // Up with the bar hidden recalls it any time; any key or 6s ends it.
  const hintTimerRef = useRef(null)
  const showHint = useCallback(() => {
    setHint(true)
    clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(false), HINT_MS)
  }, [])
  useEffect(() => {
    const w = getWatchState(id)
    if (!w || !(w.position > 0)) showHint()
    return () => clearTimeout(hintTimerRef.current)
  }, [id, showHint])

  // Switch episodes WITHOUT exiting the player: the playback effect's cleanup
  // flushes the outgoing episode's progress, then the new run reloads the URL
  // through the same quality-selection path. `keepUi` leaves the control bar and
  // episode strip up (picking from the strip) so you can keep hopping episodes;
  // otherwise (Up Next, auto-advance) the overlay is cleared.
  const switchEpisode = useCallback(
    (n, { keepUi = false } = {}) => {
      if (n == null) return
      upNextDismissedRef.current = false
      setUpNext(false)
      setSwitching(true)
      if (keepUi) {
        armHideTimer() // keep bar + strip up, just refresh the auto-hide countdown
      } else {
        setBarVisible(false)
        setStripVisible(false)
      }
      setCurEp(n)
    },
    [armHideTimer],
  )
  const switchEpisodeRef = useRef(switchEpisode)
  switchEpisodeRef.current = switchEpisode

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play().catch(() => {})
      armHideTimer()
    } else {
      v.pause()
      showBar() // pausing brings the bar up
    }
  }, [armHideTimer, showBar])

  // ---------------------------------------------------------------------
  // key machine — owns every key in the player layer
  // ---------------------------------------------------------------------
  // One frame for the player's lifetime; onKey is read through a ref, so it
  // always sees the latest callbacks without reopening the frame.
  useFocusFrame({
    layer: LAYER,
    onKey: (e) => {
      // Media keys first: they apply in every state (bar hidden, bar shown,
      // strip open) and never move focus. Seeking shows the usual target badge
      // but deliberately leaves the bar alone — reaching for these keys is how
      // you skip ahead WITHOUT lighting up the screen.
      const media = mediaKey(e)
      if (media) {
        e.preventDefault()
        if (statusRef.current !== 'ok') return true // nothing to drive yet
        const v = videoRef.current
        if (media === 'stop') window.dispatchEvent(new CustomEvent('tv-back'))
        else if (media === 'forward') stepSeek(MEDIA_STEP_S, e.repeat)
        else if (media === 'rewind') stepSeek(-MEDIA_STEP_S, e.repeat)
        else if (media === 'toggle') togglePlay()
        else if (media === 'play' && v?.paused) togglePlay()
        else if (media === 'pause' && v && !v.paused) togglePlay()
        return true
      }

      // Episode strip owns keys the moment it's open — evaluated before the
      // status gate so it stays fully navigable while the next pick is still
      // loading (the player never blanks to the loading screen mid-hop).
      // Left/Right/OK go to the focus engine (move highlight, scroll, select);
      // Up/Back peel the strip back to the plain bar; OK keeps the strip up.
      if (stripRef.current) {
        armHideTimer()
        if (isBackKey(e) || e.key === 'ArrowUp') {
          hideStrip()
          return true
        }
        switch (e.key) {
          case 'ArrowLeft':
          case 'ArrowRight':
          case 'Enter':
            return false
          default:
            return true // swallow Down and the rest
        }
      }

      // Error state: normal navigation drives the Retry focusable; Back exits.
      if (statusRef.current === 'error') return false
      if (statusRef.current !== 'ok') {
        // Loading: swallow nav/OK so keys can't leak to the detail layer
        // beneath; Back falls through and exits the player.
        return !isBackKey(e) && (e.key === 'Enter' || (e.key || '').startsWith('Arrow'))
      }

      // Any key dismisses the key hint, then keeps its normal meaning.
      if (hintRef.current) setHint(false)

      // Up Next card takes OK (switch now) and Up/Back (dismiss) first; other
      // keys keep their normal meaning while the card is up.
      if (upNextRef.current) {
        if (e.key === 'Enter') {
          switchEpisodeRef.current(nextEpRef.current)
          return true
        }
        if (isBackKey(e) || e.key === 'ArrowUp') {
          upNextDismissedRef.current = true
          setUpNext(false)
          return true
        }
      }

      if (isBackKey(e)) {
        if (barRef.current) {
          hideBar()
          return true
        }
        return false // default tv-back pops the player overlay
      }

      if (barRef.current) {
        armHideTimer() // any input while shown postpones auto-hide
        switch (e.key) {
          case 'ArrowUp':
            hideBar()
            return true
          case 'ArrowDown':
            if (epListRef.current.length > 1) showStrip() // Down again -> episode strip
            return true
          case 'ArrowLeft':
            stepSeek(-STEP_S, e.repeat)
            return true
          case 'ArrowRight':
            stepSeek(STEP_S, e.repeat)
            return true
          case 'Enter':
            togglePlay()
            return true
          default:
            return true
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          showBar()
          return true
        case 'ArrowLeft':
          stepSeek(-STEP_S, e.repeat)
          return true
        case 'ArrowRight':
          stepSeek(STEP_S, e.repeat)
          return true
        case 'Enter':
          togglePlay()
          return true
        case 'ArrowUp':
          showHint() // bar hidden: Up recalls the key hint
          return true
        default:
          return false
      }
    },
  })

  // The error state has this layer's only focusable; drop the bar/strip so their
  // focusables don't compete, then land on Retry deterministically.
  useEffect(() => {
    if (status === 'error') {
      setBarVisible(false)
      setStripVisible(false)
      focusTo(`${LAYER}/content-0-0`)
    }
  }, [status])

  // Opening the strip lands focus on the current episode. Child (cell) effects
  // register before this parent effect runs, so the target id already exists.
  // Jump the row to that cell with NO animation first; focusTo's own (possibly
  // smooth) scroll then finds it already in view and is a no-op — so opening
  // snaps into place and only later cursor moves animate.
  useEffect(() => {
    if (!stripVisible) return
    const target = `${LAYER}/episodes-0-${stripIdx}`
    document
      .querySelector(`[data-focus-id="${target}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
    focusTo(target)
  }, [stripVisible, stripIdx])

  // ---------------------------------------------------------------------
  // data: detail (title + episode list) from the shared page cache
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    // Detail is already cached by the page beneath us — this never refetches.
    loadDetail(id)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {
        if (!cancelled) {
          setErrorKind('network')
          setStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, attempt])

  // ---------------------------------------------------------------------
  // playback: wire the <video> to the current episode's stream
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!data) return
    const video = videoRef.current
    setStatus('loading')
    setTrackInfo(null) // quality belongs to the episode that is loading now
    setStreamLabel('')
    setErrorKind(null)
    playbackRef.current = null // the old session is gone; the new one starts once its stream resolves

    const fail = (kind) => {
      setErrorKind(kind)
      setStatus('error')
    }

    const resumePos = resumePosition(getWatchState(id), curEp)

    // Persist progress the session sampled. What a near-the-end position means
    // (finished, or the next episode queued) is watch state's call.
    const flushProgress = (pos, dur) => {
      recordProgress(id, epListRef.current, curEp, pos, dur)
    }

    const ep = data.episodes.find((e) => e.index === curEp) || data.episodes[data.episodes.length - 1]
    if (ep?.vip) {
      // The detail page gates this on the way in; auto-advance can still
      // land on a VIP episode.
      fail('vip')
      return
    }

    let cancelled = false
    let playback = null
    const startPlayback = (url) => createPlayback(video, {
      src: mediaUrl(url),
      resumePos,
      seekPending: () => pendingSeekRef.current != null,
      onStatus: (s, kind) => {
        if (s === 'error') {
          if (kind) setErrorKind(kind) // the stall ladder giving up carries no kind
          setStatus('error')
          return
        }
        setStatus('ok')
        setSwitching(false)
        setPaused(false)
      },
      onStart: (canSeek) => {
        recordHistory(toSummary(data))
        if (resumePos > 0) {
          setToast(canSeek ? `已从 ${fmtTime(resumePos)} 继续播放` : '此片源不支持跳转，已从头播放')
          clearTimeout(toastTimerRef.current)
          toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS)
        }
      },
      onPaused: (p) => {
        setPaused(p)
        // Any pause surfaces the bar (remote OK, or a future system event).
        if (p && statusRef.current === 'ok' && !video.ended) showBar()
      },
      onTrack: setTrackInfo,
      onTime: (t, dur) => {
        // While a seek is pending, the played track is a preview cursor — leave it.
        if (pendingSeekRef.current == null && playedRef.current) {
          playedRef.current.style.width = `${(t / dur) * 100}%`
        }
        if (curTimeRef.current) curTimeRef.current.textContent = fmtTime(t)
        if (remainRef.current) remainRef.current.textContent = `-${fmtTime(dur - t)}`
        // Up Next: surface once per episode when the tail comes into view.
        if (
          playback.started &&
          !upNextRef.current &&
          !upNextDismissedRef.current &&
          nextEpRef.current != null &&
          dur - t <= UP_NEXT_S
        ) {
          setUpNext(true)
        }
      },
      onBuffered: (end, dur) => {
        if (bufferedRef.current) bufferedRef.current.style.width = `${(end / dur) * 100}%`
      },
      onProgress: flushProgress,
      onEnded: () => {
        // The finished-tail rule has just marked this episode `finished` (or
        // rolled the resume point to the next episode, if there is one).
        if (nextEpRef.current != null) {
          switchEpisodeRef.current(nextEpRef.current)
        } else {
          // Last episode: leave the player; focus restores in the detail layer.
          window.dispatchEvent(new CustomEvent('tv-back'))
        }
      },
    })
    resolveStream(data.id, ep)
      .then((stream) => {
        if (cancelled) return
        setStreamLabel(stream.label)
        playback = startPlayback(stream.url)
        playbackRef.current = playback
      })
      .catch((e) => {
        if (!cancelled) fail(resolveErrorKind(e))
      })
    return () => {
      cancelled = true
      playback?.destroy()
    }
  }, [data, curEp, attempt, showBar])

  const trackText = [streamLabel, fmtTrack(trackInfo)].filter(Boolean).join(' · ')
  const episodes = data?.episodes || []
  // Same episode title as the detail grid and the strip.
  const epLabel = episodes.length > 1 ? (epList[curIdx] ? episodeTitle(epList[curIdx]) : `第${curEp}集`) : ''

  return (
    <div className="fixed inset-0 bg-black">
      <video ref={videoRef} className="h-full w-full bg-black object-contain" />

      {/* Title card — top-left, shows/hides together with the control bar.
          The quality line under the title is a quieter caption, dropped
          entirely when nothing is known yet rather than showing a placeholder
          that reads as noise from the couch. */}
      {barVisible && (
        <div className="glass-strong border border-glass-edge absolute top-12 left-safe max-w-[1100px] rounded-surface px-7 py-4">
          <div className="flex items-baseline gap-5">
            <span className="min-w-0 truncate text-heading text-fg">{data?.name || ''}</span>
            {epLabel && <span className="shrink-0 text-label text-fg-2">{epLabel}</span>}
          </div>
          {trackText && <div className="mt-1 text-caption text-fg-2">{trackText}</div>}
        </div>
      )}

      {/* Bottom chrome anchor, spanning the safe margins: the control bar and
          the episode strip stack in one column (opening the strip pushes the
          bar up), and the seek badge and Up Next card hang just above whatever
          of it is showing — or above the bottom edge when nothing is. */}
      <div className="absolute bottom-12 left-safe right-safe flex flex-col gap-5">
        {/* Control bar — always mounted so the DOM refs stay stable; visibility
            is an instant display toggle. */}
        <div className="glass-strong border border-glass-edge rounded-surface px-7 pt-6 pb-4" style={{ display: barVisible ? 'block' : 'none' }}>
          <div className="relative mb-3 h-2 overflow-hidden rounded-full bg-glass-active">
            <div ref={bufferedRef} className="absolute inset-y-0 left-0 w-0 bg-fg-3" />
            <div ref={playedRef} className="absolute inset-y-0 left-0 w-0 bg-accent" />
          </div>
          {/* Times row: current | play-pause icon centered | remaining */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center">
            <span ref={curTimeRef} className="text-label text-fg-2">00:00</span>
            <span className="flex items-center text-fg">
              {paused ? <Icon name="play_arrow" size={40} aria-label="播放" /> : <Icon name="pause" size={40} aria-label="暂停" />}
            </span>
            <span ref={remainRef} className="text-right text-label text-fg-2">-00:00</span>
          </div>
        </div>

        {/* Episode strip — horizontal scroller under the control bar, shown by
            a second Down from it. Cells are real focusables so the engine
            scrolls the row and clicking jumps to that episode. */}
        {stripVisible && episodes.length > 1 && (
          <div className="glass-strong border border-glass-edge rounded-surface px-7 py-5">
            <div className="mb-3 text-caption text-fg-2">选集</div>
            <div className="flex gap-gutter overflow-x-auto">
              {stripList.map((ep, i) => (
                <StripCell
                  key={ep.index}
                  col={i}
                  label={episodeTitle(ep)}
                  isCurrent={ep.index === curEp}
                  onSelect={() => switchEpisode(ep.index, { keepUi: true })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Seek target badge (rewind / fast-forward icon + mm:ss), shared by both
            seek modes; showBadge picks the icon and writes the time. */}
        <div ref={badgeRef} className="glass-strong border border-glass-edge absolute bottom-full mb-5 left-1/2 -translate-x-1/2 items-center gap-2 rounded-full px-8 py-2.5 text-heading text-fg" style={{ display: 'none' }}>
          <Icon name="fast_rewind" size={36} />
          <Icon name="fast_forward" size={36} />
          <span />
        </div>

        {/* Up Next: glass card, right-aligned; OK switches immediately. Hidden
            while the strip is open, since the strip owns OK then. */}
        {upNext && nextEpIndex != null && !stripVisible && (
          <div className="glass-strong border border-glass-edge absolute bottom-full mb-5 right-0 rounded-surface px-9 py-6 text-center">
            <div className="mb-2 text-caption text-fg-2">即将播放</div>
            <div className="mb-2 max-w-[560px] truncate text-heading text-fg">{episodeTitle(nextEp)}</div>
            <div className="text-caption text-fg-2">按 OK 立即播放</div>
          </div>
        )}
      </div>

      {toast && <div className="glass-strong border border-glass-edge absolute top-12 right-safe rounded-full px-7 py-3.5 text-label text-fg">{toast}</div>}

      {hint && (
        <div className="glass-strong border border-glass-edge absolute top-30 left-1/2 -translate-x-1/2 rounded-surface px-10 py-6 text-label">
          <div className="mb-4 text-heading text-fg">遥控键位</div>
          {/* Key | action table: the key column scans faster than a sentence. */}
          <div className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2">
            {HINT_ROWS.map(([key, action]) => (
              <Fragment key={key}>
                <span className="text-fg">{key}</span>
                <span className="text-fg-2">{action}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Full-screen loading takeover — suppressed while the strip is open so a
          strip pick reloads the stream behind the strip instead of blanking it. */}
      {status === 'loading' && !stripVisible && (
        <div className="absolute inset-0 flex items-center justify-center bg-black text-heading text-fg">
          {switching ? `正在加载 第${curEp}集…` : '加载中…'}
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-9 bg-black">
          <div className="text-heading text-fg">{ERROR_TEXT[errorKind] || ERROR_TEXT.source}</div>
          <div className="flex gap-5">
            <ErrorButton
              col={0}
              icon="refresh"
              label="重试"
              onSelect={() => setAttempt((n) => n + 1)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
