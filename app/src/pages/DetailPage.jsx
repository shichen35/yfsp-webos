/*
 * Full-screen detail overlay (the "detail" focus layer).
 *
 * No blown-up-poster-with-scrim treatment (that violates the performance red
 * lines): a plain poster <img> in the first grid column and a solid info column
 * from the second, with all text on opaque backgrounds.
 *
 * Focus rows in the content group:
 *   row 0     action buttons (focus lands on Play once data resolves; landing
 *             here also snaps the overlay's scroller to the very top — see
 *             OVERLAY_ROOT — so the poster and title block are never clipped)
 *   row 1     playlist controls after the 选集 heading — the order toggle, plus
 *             range chips on long lists (omitted entirely for a single-episode
 *             title, i.e. a movie)
 *   row 2+    the episode grid, on the poster grid's 6 columns; a movie has
 *             neither (its one "episode" is named after its quality, 576P)
 *
 * Episode order is a DISPLAY concern only. The source adapter's detail returns episodes
 * newest-first and that canonical list is never reordered ("next episode" goes
 * by index, see store/watchState.js) — this page reverses a copy for rendering
 * and remembers the choice per title (`store/episodeOrder.js`).
 *
 * The blurb stays clamped to three lines; 简介 opens the full text in a
 * scrollable dialog.
 *
 * VIP gate: there is no sign-in, so an episode marked VIP can't play. It
 * carries a VIP badge, and playing it shows a notice instead of opening the
 * player.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDetail } from '../api/feeds.js'
import { toSummary } from '../source/index.js'
import Thumb from '../components/Thumb.jsx'
import { BADGE } from '../components/VideoCard.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import SynopsisDialog from '../components/SynopsisDialog.jsx'
import { useFocusable, useFocusFrame, focusTo } from '../hooks/useFocus.js'
import { useStoreValue } from '../hooks/useStore.js'
import { favoritesStore, toggle as toggleFavorite } from '../store/favorites.js'
import { historyStore } from '../store/history.js'
import { primaryAction, episodeTitle } from '../store/watchState.js'
import { IconLabel } from '../components/Icon.jsx'
import { episodeOrderStore, setAscending } from '../store/episodeOrder.js'

const LAYER = 'detail'
const EP_COLS = 6
const CONTROLS_ROW = 1
// Past this many episodes the grid is split into range chips — a 233-episode
// anime is a 39-row scroll otherwise.
const RANGE_MIN = 60
const RANGE_SIZE = 50

// The overlay's scroll container. The literal `overlay` class carries no styles
// — it is the marker useFocus.js looks for (alongside `tab-content`) to snap a
// focused row-0 element's scroller back to the very top. Without it, moving up
// to the action row only scrolls the minimum needed to reveal the buttons, which
// leaves the poster and the title block clipped above the viewport.
const OVERLAY_ROOT =
  'overlay fixed inset-0 overflow-y-auto bg-bg will-change-scroll px-safe pt-content-top pb-content-bottom scroll-py-focus-safe'

// Primary (play) action: accent fill at rest; `focusable`'s .focused rules
// still win, so the white focus fill overrides it instantly.
const DETAIL_BTN = 'focusable tile-btn'

// 4374007 -> 437.4万, as the site shows heat.
function formatHot(n) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return String(n)
}

function ActionButton({ col, icon, label, primary, onSelect }) {
  const { props } = useFocusable({ layer: LAYER, group: 'content', row: 0, col, onSelect })
  return (
    <span className={`${DETAIL_BTN} ${primary ? 'bg-accent text-inverse' : 'bg-elev-2 text-fg'}`} {...props}>
      {icon ? <IconLabel icon={icon}>{label}</IconLabel> : label}
    </span>
  )
}

// Playlist control chip (row 1). Same shape as the category page's chips, and
// the same vocabulary: accent text and ring mark a SELECTED one (the range chips),
// while a plain chip is an action (the order toggle) — both distinct from the
// white focus fill.
function ControlChip({ col, icon, label, selected = false, onSelect }) {
  const { props } = useFocusable({ layer: LAYER, group: 'content', row: CONTROLS_ROW, col, onSelect })
  return (
    <span
      className={`focusable chip ${selected ? 'text-accent [&:not(.focused)]:border-accent' : 'text-fg'}`}
      {...props}
    >
      {icon ? <IconLabel icon={icon}>{label}</IconLabel> : label}
    </span>
  )
}

function EpCell({ row, col, title, subtitle, isResume, vip, onSelect }) {
  const { props } = useFocusable({ layer: LAYER, group: 'content', row, col, onSelect })
  return (
    <div
      className={`focusable relative flex h-[72px] flex-col items-center justify-center rounded-tile bg-elev-2 px-5 text-center text-label ${isResume ? 'text-fg' : 'text-fg-2'}`}
      {...props}
    >
      <div className="w-full truncate leading-[1.25]">{title}</div>
      {/* One tier dimmer than the title; dark on the white focus fill. */}
      {subtitle && <div className="mt-0.5 text-caption leading-[1.25] text-fg-3 focused:text-inverse">{subtitle}</div>}
      {isResume && (
        <span className={`${BADGE} -top-2 -right-1.5 bg-accent text-inverse`}>继续</span>
      )}
      {vip && (
        <span className={`${BADGE} -top-2 -left-1.5 bg-uhd text-inverse`}>VIP</span>
      )}
    </div>
  )
}

function RetryCell({ onRetry }) {
  const { props } = useFocusable({ layer: LAYER, group: 'content', row: 0, col: 0, onSelect: onRetry })
  return (
    <span className={`${DETAIL_BTN} bg-elev-2 text-fg`} {...props}>
      <IconLabel icon="refresh">加载失败，重试</IconLabel>
    </span>
  )
}

// Split a list into fixed-size chunks (the range chips' windows).
function chunkList(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// A chunk's label spans its episode numbers, always written low-high so it
// reads the same in either sort direction ("184-233", not "233-184").
function rangeLabel(chunk) {
  const a = chunk[0].index
  const b = chunk[chunk.length - 1].index
  return a <= b ? `${a}-${b}` : `${b}-${a}`
}

export default function DetailPage({ id, onPlay, style }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  // Episode number pinning the visible range. Set by picking a range chip and
  // deliberately kept across a sort flip, so flipping the order leaves the same
  // stretch of episodes on screen instead of jumping back to the start.
  // null = fall back to the resume episode, then to the head of the list.
  const [anchorEp, setAnchorEp] = useState(null)
  const favorites = useStoreValue(favoritesStore)
  const isFav = favorites.some((x) => x.id === id)
  // Subscribed (not a one-shot read): closing the player must immediately flip
  // the primary button to "continue watching episode N".
  const history = useStoreValue(historyStore)
  const ascending = !!useStoreValue(episodeOrderStore)[id]

  // Generation token: a retry supersedes a still-running load.
  const loadGenRef = useRef(0)
  const load = useCallback(() => {
    const gen = ++loadGenRef.current
    setStatus('loading')
    loadDetail(id)
      .then((d) => {
        if (gen !== loadGenRef.current) return
        setData(d)
        setStatus('ok')
      })
      .catch(() => {
        if (gen === loadGenRef.current) setStatus('error')
      })
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const [synopsisOpen, setSynopsisOpen] = useState(false)
  // The VIP notice for an episode we can't play logged out.
  const [vipNotice, setVipNotice] = useState(false)

  // A different title starts over at its own default range.
  useEffect(() => setAnchorEp(null), [id])

  // Own the detail focus layer for this overlay's lifetime. No onBack: Back
  // reaches App's back chain, which pops this overlay off the stack.
  useFocusFrame({ layer: LAYER })

  // Once data lands, deterministically focus the play button.
  useEffect(() => {
    if (status === 'ok') focusTo(`${LAYER}/content-0-0`)
  }, [status])

  if (status === 'loading') {
    return (
      <div className={OVERLAY_ROOT} style={style}>
        <div className="absolute inset-0 flex items-center justify-center text-heading text-fg">加载中…</div>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className={OVERLAY_ROOT} style={style}>
        <div className="absolute inset-0 flex items-center justify-center text-heading text-fg">
          <RetryCell onRetry={load} />
        </div>
      </div>
    )
  }

  const episodes = data.episodes || []
  const watch = history.find((x) => x.id === id)?.watch || null
  const { resumeIndex, caughtUp, playIndex: primaryEp, label: primaryLabel } = primaryAction(episodes, watch)

  // Remarks usually carry the episode count ("28集全"); only without them
  // does the line say how many episodes there are.
  const eyebrow = [
    data.genreName?.replaceAll(',', ' / '), // 都市,家庭,爱情
    data.year,
    data.area,
    data.lang,
    data.remarks || (episodes.length > 1 && `共 ${episodes.length} 集`),
    data.hot > 0 && `热度 ${formatHot(data.hot)}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const crew = [data.director && `导演：${data.director}`, data.cast && `主演：${data.cast}`]
    .filter(Boolean)
    .join('　')

  const favItem = toSummary(data)

  // A movie: no playlist controls, and the play button drops its "第1集".
  const single = episodes.length <= 1
  // Ranges are cut from episode 1 up (1-50, 51-100, …, 201-233) whatever the
  // sort, so descending only flips the order of the ranges and of each range's
  // cells — the same episodes stay together. Copies: `episodes` stays canonical.
  const asc = [...episodes].reverse()
  let chunks = episodes.length > RANGE_MIN ? chunkList(asc, RANGE_SIZE) : [asc]
  if (!ascending) chunks = chunks.map((c) => [...c].reverse()).reverse()
  // The visible chunk is the one holding the anchor (a picked range, else the
  // resume episode); with neither, the head of the list — which follows the
  // sort, so it is the newest episode descending and episode 1 ascending.
  const pinned = anchorEp ?? resumeIndex
  const pinnedChunk = pinned == null ? -1 : chunks.findIndex((c) => c.some((e) => e.index === pinned))
  const activeChunk = pinnedChunk >= 0 ? pinnedChunk : 0
  const shown = chunks[activeChunk] || []
  const epRow0 = single ? CONTROLS_ROW : CONTROLS_ROW + 1

  // Every play action goes through the VIP gate: a VIP episode never reaches
  // the player.
  const playEpisode = (index) => {
    const ep = episodes.find((e) => e.index === index)
    if (ep?.vip) setVipNotice(true)
    else onPlay(index)
  }

  return (
    <div className={OVERLAY_ROOT} style={style}>
      {/* pt-4: content starts at y=108, the same line as the tab pages. */}
      <div className="flex min-h-full flex-col gap-10 pt-4">
        <div className="flex gap-gutter">
          {/* self-start: the stretched row would otherwise pull the poster off 2:3. */}
          <div className="aspect-2/3 w-card shrink-0 self-start overflow-hidden rounded-xl bg-elev">
            {/* Same sized asset as grid cards: usually already cached when
                arriving from a poster grid, so it paints immediately. */}
            <Thumb pic={data.pic} alt={data.name} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="mb-3 line-clamp-2 text-display font-bold text-fg">{data.name}</h1>
            <div className="mb-6 flex min-w-0 items-center gap-4">
              {data.score > 0 && <span className="text-heading font-bold text-rating">{Number(data.score).toFixed(1)}</span>}
              <span className="min-w-0 truncate text-label text-fg-2">{eyebrow}</span>
            </div>
            {/* 1104px ≈ 42 characters, the same measure as SynopsisDialog's body. */}
            <p className="mb-3 line-clamp-3 max-w-[1104px] text-body leading-normal text-fg-2">{data.synopsis}</p>
            <div className="mb-5 truncate text-label text-fg-2">{crew}</div>
            {/* mt-auto: a column shorter than the poster ends level with its bottom. */}
            <div className="mt-auto flex gap-5">
              <ActionButton
                col={0}
                icon={resumeIndex == null && caughtUp ? 'replay' : 'play_arrow'}
                label={single ? primaryLabel.replace(/ 第\d+集$/, '') : primaryLabel}
                primary
                onSelect={() => playEpisode(primaryEp)}
              />
              <ActionButton
                col={1}
                icon={isFav ? 'bookmark_added' : 'bookmark_add'}
                label={isFav ? '已收藏' : '收藏'}
                onSelect={() => toggleFavorite(favItem)}
              />
              {/* The blurb above is clamped to three lines; this opens the rest. */}
              {data.synopsis && <ActionButton col={2} label="简介" onSelect={() => setSynopsisOpen(true)} />}
            </div>
          </div>
        </div>

        <div>
          {/* Bleeds to the screen edges so STRIP_SAFE scrolling (useFocus.js)
              keeps the chips on the 84px margin; the trailing spacer's 72px +
              the 12px gap give the last chip the same margin on the right. */}
          {!single && (
            <div className="-mx-safe mb-6 flex items-center gap-3 overflow-x-auto pl-safe">
              <span className="shrink-0 pr-2 text-heading font-semibold text-fg">选集</span>
              {/* One toggle showing the order it is IN, not the one it would
                  switch to — the arrow carries the direction so it reads at a
                  glance from across the room. */}
              <ControlChip
                col={0}
                icon={ascending ? 'arrow_upward' : 'arrow_downward'}
                label={ascending ? '升序' : '降序'}
                onSelect={() => setAscending(id, !ascending)}
              />
              {chunks.length > 1 &&
                chunks.map((c, i) => (
                  <ControlChip
                    key={c[0].index}
                    col={1 + i}
                    label={rangeLabel(c)}
                    selected={i === activeChunk}
                    onSelect={() => setAnchorEp(c[0].index)}
                  />
                ))}
              <div className="w-18 shrink-0" aria-hidden="true" />
            </div>
          )}

          {!single && (
            <div className="grid grid-cols-6 gap-gutter">
              {shown.map((ep, i) => {
                // Main line is the episode's title; the ordinal drops to a sub
                // line unless the title already is the ordinal.
                const ordinal = `第${ep.index}集`
                const title = episodeTitle(ep)
                return (
                  <EpCell
                    key={ep.index}
                    row={epRow0 + Math.floor(i / EP_COLS)}
                    col={i % EP_COLS}
                    title={title}
                    subtitle={title === ordinal ? null : ordinal}
                    isResume={ep.index === resumeIndex}
                    vip={!!ep.vip}
                    onSelect={() => playEpisode(ep.index)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {synopsisOpen && (
        <SynopsisDialog title={data.name} text={data.synopsis} onClose={() => setSynopsisOpen(false)} />
      )}

      {vipNotice && (
        <ConfirmDialog
          title="会员剧集"
          description="这一集需要爱壹帆会员，本应用暂不支持登录。"
          confirmLabel="知道了"
          confirmKind="default"
          cancelLabel={null}
          onConfirm={() => setVipNotice(false)}
        />
      )}
    </div>
  )
}
