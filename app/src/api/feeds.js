/*
 * Shared feed loaders + cache keys. Both the pages and the startup prefetch go
 * through these so they hit the SAME pageCache keys — a prefetch and a page's
 * own fetch dedupe into one request (first caller wins, the rest read cache).
 * The cache keys live only here: pages load, page and invalidate a feed by its
 * own arguments and never see a key.
 */
import { categoryList, homeBanners, homeShelves, rankList, detail, isChallenged } from '../source/index.js'
import { CATEGORIES, getCategory } from '../config/taxonomy.js'
import { DEFAULT_FILTER } from '../store/filters.js'
import * as pageCache from '../store/pageCache.js'

const HOME_SHELVES_KEY = 'home:shelves'
const HOME_BANNERS_KEY = 'home:banners'
const HOME_RANK_KEY = 'home:rank'

// The home page's featured row. Failure is not an error state: the page simply
// opens on its shelves instead (homeBanners never throws).
export function loadHomeBanners() {
  return pageCache.loadOnce(HOME_BANNERS_KEY, homeBanners)
}

// The home page's channel shelves, one request for all of them.
export function loadHomeShelves() {
  return pageCache.loadOnce(HOME_SHELVES_KEY, homeShelves)
}

// The home page's 热播榜 shelf: the week charts of every channel that has
// one, interleaved (movie #1, drama #1, ... movie #2, ...), deduped, 12 cards.
export function loadHomeRank() {
  return pageCache.loadOnce(HOME_RANK_KEY, async () => {
    const charts = Object.values(await rankList()).map((r) => r.week)
    const seen = new Set()
    const items = []
    for (let i = 0; items.length < 12 && charts.some((c) => i < c.length); i++) {
      for (const c of charts) {
        const it = c[i]
        if (it && !seen.has(it.id) && items.length < 12) {
          seen.add(it.id)
          items.push(it)
        }
      }
    }
    return items
  })
}

// One title's detail (metadata + episode list). The detail page loads it and
// the player opened from it reads the same entry, so playback never refetches.
export function loadDetail(id) {
  return pageCache.loadOnce(`detail:${id}`, () => detail(id))
}

// Refresh / retry: forget the home feed (shelves, chart and banners) so the page's
// next load refetches.
export function invalidateHome() {
  pageCache.invalidate('home:')
}

const CATEGORY_PAGE_SIZE = 36

/**
 * One page of a category listing at filter `f`. Only page 1 is cached — it is
 * what a tab opens on and what the prefetch warms; later pages are
 * infinite-scroll appends and always hit the network.
 */
export function loadCategoryPage(category, f, page = 1) {
  const fetch = () => categoryList({ cid: getCategory(category).cid, filter: f, page, size: CATEGORY_PAGE_SIZE })
  if (page !== 1) return fetch()
  return pageCache.loadOnce(`cat:${category}:${JSON.stringify(f)}:p1`, fetch)
}

// Refresh: forget every cached filter of this category (other categories keep
// theirs) so the page's next load refetches.
export function invalidateCategory(category) {
  pageCache.invalidate(`cat:${category}:`)
}

/**
 * Sequential background prefetch: home first (the default landing tab), then
 * each category's first screen at its DEFAULT filter, which is also what its
 * page opens with, so the prefetch and the page share one cache key. One at a
 * time on purpose: how much traffic trips the gateway's human check (code 5)
 * is unknown, and once it has, prefetching stops for the session. Failures are
 * swallowed — a tab that's actually opened runs its own loading/retry path.
 * Pass a `shouldStop()` predicate to abort early (e.g. on unmount).
 */
export async function prefetchAll(shouldStop = () => false) {
  const stop = () => shouldStop() || isChallenged()
  const loaders = [loadHomeShelves, loadHomeBanners, loadHomeRank, ...CATEGORIES.map((c) => () => loadCategoryPage(c.id, DEFAULT_FILTER))]
  for (const load of loaders) {
    if (stop()) return
    try {
      await load()
    } catch {
      /* silent */
    }
  }
}
