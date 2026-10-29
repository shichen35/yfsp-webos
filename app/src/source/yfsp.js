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
 */
import { apiGet, ApiError, HOST } from './yfspHttp.js'

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
// `image` / `rating`, search and ranking use `contxt` / `imgPath` / `score`.
// imgPath may point at a small variant ("xxxs.gif"); the site strips the s.
function summary(v) {
  const pic = v.image || (v.imgPath ? v.imgPath.replace('s.', '.') : '')
  return {
    id: v.key || v.contxt,
    name: v.title || '',
    pic,
    score: Number(v.rating ?? v.score) || 0,
    remarks: v.lastName || '',
    year: v.year || v.post_Year || '',
    area: v.regional || '',
    lang: v.lang || v.language || '',
    uhd: v.vipResource === '4K' || v.vipResource === '2K',
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

export { ApiError }
