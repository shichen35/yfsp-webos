/*
 * yfsp business API + field normalization. Pages and feeds.js see only the
 * domain model below (via source/index.js), never the gateway's field names.
 *
 *   Summary  { id, name, pic, score, remarks, year, area, lang, uhd }
 *   Detail   Summary + { genreName, director, cast, synopsis, hot, cid, episodes }
 *   Episode  { index, title, vip, key }  — index counts up from 1; the array is
 *            newest first (like olevod, so the detail page, player and
 *            episodeOrder store work unchanged)
 *   Stream   { url, type: 'hls', label } — url is the raw m3u8; the player maps
 *            it through mediaUrl()
 *   Page     { items: Summary[], total, page, size, maxPage }
 *   Banner   { id, name, pic }
 */
import { apiGet, apiPost, ApiError, HOST } from './yfspHttp.js'
import { CATEGORIES } from '../config/taxonomy.js'

const IMG_BASE = 'https://static.yfsp.tv'

// Params the site sends with every play/detail request.
const PLAY_PARAMS = { lang: 'none', usersign: 1, region: 'US', device: 1, isMasterSupport: 1 }

/**
 * Full image URL, optionally resized by the image CDN to a 'WxH' box.
 * Relative paths (/upload/video/...) get the static host.
 */
export function imageUrl(pic, size) {
  if (!pic) return ''
  const full = /^https?:\/\//.test(pic) ? pic : IMG_BASE + (pic.startsWith('/') ? '' : '/') + pic
  const m = /^(\d+)x(\d+)$/.exec(size || '')
  if (!m) return full
  return `${full}${full.includes('?') ? '&' : '?'}w=${m[1]}&h=${m[2]}&format=jpg&mode=crop`
}

// One normalizer for every list shape: list/Search and getAllVideo use `key` /
// `image`, search and ranking use `contxt` / `imgPath` (in list items `contxt`
// is the synopsis, so `key` wins). imgPath may point at a small variant
// ("xxxs.gif"); the site strips the s. `score` is the 0-10 rating everywhere;
// search's `rating` is the same value x100.
function summary(v) {
  const pic = v.image || (v.imgPath ? v.imgPath.replace('s.', '.') : '')
  const year = v.year || v.post_Year || /^\d{4}/.exec(v.postTime || '')?.[0] || ''
  return {
    id: v.key || v.contxt,
    name: v.title || '',
    pic,
    score: Number(v.score) || Number(v.rating) || 0,
    remarks: v.lastName || '',
    year: String(year),
    area: v.regional || '',
    lang: v.lang || v.language || '',
    uhd: v.vipResource === '4K' || v.vipResource === '2K' || v.viPsource === '2160p',
  }
}

/** The Summary fields of a Detail (favorites and history store these). */
export function toSummary(d) {
  const { id, name, pic, score, remarks, year, area, lang, uhd } = d
  return { id, name, pic, score, remarks, year, area, lang, uhd }
}

// stars[] / directors[] are plain name strings.
const names = (list) => (list || []).filter(Boolean).join(' / ')

/**
 * Title detail with its episode list. Two requests: the episode list needs the
 * `cid` the detail returns. taxis=1 is the clean ascending order (taxis=0
 * scrambles long series: One Piece starts at 0801). Only info[0] is used; no
 * title seen so far has more than one (architecture Q10).
 */
export async function detail(id) {
  const [d] = await apiGet(HOST.m10, '/v3/video/detail', {
    cinema: 1, device: 1, player: 'CkPlayer', tech: 'HLS', country: 'HU', lang: 'cns', id, region: 'US',
  })
  if (!d) throw new ApiError('视频不存在', 1)
  const [list] = await apiGet(HOST.m10, '/v3/video/languagesplaylist', {
    cinema: 1, vid: id, lsk: 1, taxis: 1, cid: d.cid,
  })
  const episodes = (list?.playList || [])
    .map((e, i) => ({ index: i + 1, title: e.name, vip: !!e.isVip, key: e.key }))
    .reverse()

  return {
    ...summary(d),
    id: d.key || id,
    genreName: d.cidMapper || '',
    director: names(d.directors),
    cast: names(d.stars),
    synopsis: d.contxt || '',
    hot: Number(d.view) || 0,
    cid: d.cid,
    episodes,
  }
}

/**
 * The playable stream of one episode. An episode key goes with a=0; without
 * one (no episode list) the title key with a=1 plays the default episode.
 * Logged out only the 576P tier carries a path; none at all means the episode
 * is VIP-only.
 */
export async function resolveStream(id, episode) {
  const [p] = await apiGet(HOST.m10, '/v3/video/play', {
    cinema: 1, id: episode?.key || id, a: episode?.key ? 0 : 1, ...PLAY_PARAMS,
  })
  const tier = (p?.clarity || []).find((c) => c.isEnabled && c.path?.result)
  // flvPathList[0] is a 20s pre-roll ad (isHls false, link set); skip it.
  const url = tier?.path.result || (p?.flvPathList || []).find((f) => f.isHls && !f.link)?.result
  if (!url) throw new ApiError(episode?.vip ? '该集需要 VIP 会员' : '暂时无法播放', -1)
  return { url, type: 'hls', label: tier ? `${tier.description} ${tier.title}P` : '' }
}

// ---------------------------------------------------------------------------
// lists
// ---------------------------------------------------------------------------

// '0' is "All" in every filter dimension; the gateway wants -1 or nothing.
const pick = (v) => (v && v !== '0' ? v : undefined)

/**
 * Filtered, sorted, paginated channel listing (list/Search).
 * `genre` is a type path like '0,1,3,19' and replaces the channel `cid`.
 * The gateway stops at maxPage (30) however many titles match.
 */
export async function categoryList({ cid, filter = {}, page = 1, size = 36 }) {
  const [d] = await apiGet(HOST.m10, '/api/list/Search', {
    cinema: 1, page, size, orderby: filter.sort || 1, desc: 1, cid: pick(filter.genre) || cid,
    region: pick(filter.area), language: pick(filter.lang), year: pick(filter.year),
    isserial: pick(filter.status) || -1, isIndex: -1, isfree: -1, isVertical: pick(filter.form) || -1,
  })
  return {
    items: (d?.result || []).map(summary),
    total: d?.recordcount || 0,
    page,
    size,
    maxPage: d?.maxpage || page,
  }
}

// getAllVideo groups its rows by channel under these keys.
const SHELF_KEYS = {
  filmList: 'movie', tvList: 'drama', varietyList: 'variety', animeList: 'anime',
  shortList: 'short', sportList: 'sport', documentaryList: 'documentary',
}

/** Every channel's home shelf in one request, in taxonomy order. */
export async function homeShelves() {
  const [d] = await apiGet(HOST.m10, '/v3/home/getAllVideo', { cinema: 1, set: 1, size: 13, isTopic: 1, cacheable: 1 })
  const byChannel = {}
  for (const [k, id] of Object.entries(SHELF_KEYS)) byChannel[id] = (d?.[k] || []).map(summary)
  return CATEGORIES.filter((c) => byChannel[c.id]?.length).map((c) => ({
    key: c.id, title: c.name, categoryId: c.id, items: byChannel[c.id],
  }))
}

/**
 * The hero carousel. It needs the viewer's region code (empty without it);
 * `external` entries are ads and dropped. Never throws: the home page simply
 * shows no carousel.
 */
export async function homeBanners() {
  try {
    const [r] = await apiGet(HOST.m10, '/api/home/getmyregion', { cinema: 1 })
    const list = await apiGet(HOST.m10, '/v3/home/getflashbanner', {
      cinema: 1, region: r?.regionCode || 'US', cid: '0,1', size: 8,
    })
    return (list || [])
      .filter((b) => !b.external && b.listPath)
      .map((b) => ({ id: b.listPath, name: b.title || '', pic: b.image || b.img || '' }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/** Trending keywords; the first group is long-form video. */
export async function searchHotKeywords(limit = 10) {
  const [films] = await apiGet(HOST.rank, '/v3/list/gethotsearchlist', { cinema: 1, size: limit, cacheable: 1 })
  return [...new Set((films || []).map((k) => k.title).filter(Boolean))]
}

/**
 * Keyword search, long-form video only (the site's second request, with
 * cinema=3, is user uploads). Like the site, the keyword goes in both the URL
 * and the signed form body. orderby 4 is the site's default (relevance).
 */
export async function searchList({ keyword, page = 1, size = 36 }) {
  const [d] = await apiPost(
    HOST.rank,
    '/v3/list/briefsearch',
    { tags: keyword, orderby: 4, page, size, desc: 1, isserial: -1 },
    { tags: keyword },
  )
  return { items: (d?.result || []).map(summary), total: d?.recordcount || 0, page, size, maxPage: d?.maxpage || page }
}

// ---------------------------------------------------------------------------
// ranking
// ---------------------------------------------------------------------------

/**
 * Charts per channel and period: { [categoryId]: { week, month, year } },
 * 50 titles each. Only movie, drama, variety and anime have charts.
 */
export async function rankList() {
  const info = await apiGet(HOST.rank, '/api/list/GetVideoRank', { key: 'All', cinema: 1 })
  const out = {}
  for (const c of CATEGORIES) {
    const r = info?.[`false_${c.cid}`]
    if (r) out[c.id] = { week: (r.week || []).map(summary), month: (r.month || []).map(summary), year: (r.year || []).map(summary) }
  }
  return out
}

export { ApiError }
