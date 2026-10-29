/*
 * Home — the default landing screen. A featured row on top, then horizontal
 * shelves in this order:
 *   Continue Watching -> My Favorites -> 热播榜 -> Popular 电影 / 电视剧 / 综艺 / 动漫 / 短剧.
 *
 * The featured row is the first two carousel banners (ads already dropped by
 * the adapter); with none (or a failed request) the page simply opens on its
 * shelves.
 *
 * The popular rows are fetched concurrently (allSettled, so one channel failing
 * just empties that row) and the chart separately, so a failing chart just
 * leaves its row out. Continue Watching and Favorites come
 * from the local stores and update live. Empty rows are not rendered, and focus
 * rows are numbered in actual render order so up/down stays continuous.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Shelf from '../components/Shelf.jsx'
import Thumb from '../components/Thumb.jsx'
import { IconLabel } from '../components/Icon.jsx'
import { loadHomePopular, loadHomeRank, loadHomeBanners, invalidateHome, POPULAR } from '../api/feeds.js'
import { useStoreValue } from '../hooks/useStore.js'
import { historyStore } from '../store/history.js'
import { continueWatching } from '../store/watchState.js'
import { favoritesStore } from '../store/favorites.js'
import { settingsStore, getSetting } from '../store/settings.js'
import { useFocusable, setGeometryVerticalGroup } from '../hooks/useFocus.js'

function RetryButton({ group, onRetry }) {
  const { props } = useFocusable({ layer: 'home', group, row: 0, col: 0, onSelect: onRetry })
  return (
    <span className="focusable tile-btn bg-elev-2 text-fg" {...props}>
      <IconLabel icon="refresh">
        重试
      </IconLabel>
    </span>
  )
}

// Featured card: a wide still instead of a poster, so it gets its own card
// rather than VideoCard's 2:3 frame. Same focus ring and title treatment.
function FeaturedCard({ item, group, col, onSelect }) {
  const { props } = useFocusable({ layer: 'home', group, row: 0, col, onSelect })
  return (
    <div className="min-w-0" {...props}>
      <div className="h-[300px] overflow-hidden rounded-[15px] border-3 border-transparent bg-elev focused:border-focus">
        {/* Wide stills: request the original rather than a poster crop. */}
        <Thumb pic={item.pic} alt={item.name} size="" />
      </div>
      {/* One caption line keeps the first shelf fully on the first screen. */}
      <div className="mt-2.5 flex items-baseline gap-3 whitespace-nowrap">
        <div className="min-w-0 truncate text-body text-fg-2 focused:text-fg">{item.name}</div>
      </div>
    </div>
  )
}

export default function HomePage({ group = 'content', onOpenDetail, refreshNonce }) {
  const history = useStoreValue(historyStore)
  const favorites = useStoreValue(favoritesStore)
  const settings = useStoreValue(settingsStore)
  const [popular, setPopular] = useState(null) // null while loading; array once resolved
  const [rank, setRank] = useState([]) // the 热播榜 row, empty when the chart fails
  const [featured, setFeatured] = useState([]) // the first two carousel banners, if any

  // `clear` blanks to a loading state (initial load / retry); a refresh keeps
  // the old rows on screen until the new data lands (no blank flash).
  // genRef drops results from a superseded load, so a slow prefetch that lands
  // after a refresh can't put the older rows back.
  const genRef = useRef(0)
  const load = useCallback((clear = true) => {
    const token = ++genRef.current
    const current = () => token === genRef.current
    if (clear) setPopular(null)
    loadHomePopular()
      .then((rows) => current() && setPopular(rows))
      .catch(() => current() && setPopular(POPULAR.map((p) => ({ ...p, items: [] }))))
    loadHomeRank()
      .then((items) => current() && setRank(items))
      .catch(() => current() && setRank([]))
    loadHomeBanners()
      .then((list) => current() && setFeatured(list.slice(0, 2)))
      .catch(() => current() && setFeatured([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Shelves scroll independently, so up/down can't rely on a column index — it
  // moves by screen geometry instead, landing on the card in the adjacent shelf
  // whose horizontal center is nearest the current one (same spatial logic as
  // the filter panel).
  useEffect(() => {
    setGeometryVerticalGroup('home', group)
    return () => setGeometryVerticalGroup('home', group, false)
  }, [group])

  // refreshNonce bump (tab Enter): drop the cache and refetch WITHOUT
  // clearing. Skip the initial value so mount doesn't double-load.
  const firstNonce = useRef(refreshNonce)
  useEffect(() => {
    if (refreshNonce === firstNonce.current) return
    firstNonce.current = refreshNonce
    invalidateHome()
    load(false)
  }, [refreshNonce, load])

  const retry = useCallback(() => {
    invalidateHome()
    load()
  }, [load])

  // Build the shelf list in render order; row = index (kept continuous).
  // The local shelves can each be switched off in Settings.
  const continueItems = getSetting(settings, 'homeShowRecent') ? continueWatching(history).slice(0, 12) : []
  const favItems = getSetting(settings, 'homeShowFavorites') ? favorites.slice(0, 12) : []

  // The featured row owns row 0 when it is there, pushing the shelves down one.
  const featuredRow = featured.length ? (
    <section className="mb-11">
      {/* Two columns even with one banner, so a lone banner keeps its half width. */}
      <div className="grid grid-cols-2 gap-gutter">
        {featured.map((item, i) => (
          <FeaturedCard key={item.id} item={item} group={group} col={i} onSelect={() => onOpenDetail(item.id)} />
        ))}
      </div>
    </section>
  ) : null
  const rowOffset = featured.length ? 1 : 0

  const rows = []
  if (continueItems.length) rows.push({ key: 'continue', title: '继续观看', items: continueItems, isContinue: true })
  if (favItems.length) rows.push({ key: 'fav', title: '我的收藏', items: favItems })
  if (rank.length && getSetting(settings, 'homeShowRank')) rows.push({ key: 'rank', title: '热播榜', items: rank })
  for (const p of popular || []) if (p.items.length) rows.push(p)

  if (popular === null && rows.length === 0) {
    return (
      <div className="pt-4">
        {featuredRow}
        <div className="py-20 text-center text-body text-fg-2">加载中…</div>
      </div>
    )
  }
  if (popular !== null && rows.length === 0 && !featuredRow) {
    return (
      <div className="flex h-[860px] flex-col items-center justify-center gap-7 text-heading text-fg-2">
        <div>内容加载失败</div>
        <RetryButton group={group} onRetry={retry} />
      </div>
    )
  }

  return (
    <div className="pt-4">
      {featuredRow}
      {rows.map((r, i) => (
        <Shelf
          key={r.key}
          title={r.title}
          items={r.items}
          layer="home"
          group={group}
          row={rowOffset + i}
          onSelectItem={(it) => onOpenDetail(it.id)}
          cardExtras={
            r.isContinue
              ? (it) => {
                  const h = history.find((x) => x.id === it.id)
                  return { watchedEp: h?.watch?.lastEpisodeIndex, progress: h?.watch }
                }
              : undefined
          }
        />
      ))}
    </div>
  )
}
