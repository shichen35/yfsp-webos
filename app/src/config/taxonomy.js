/*
 * Category taxonomy — the single configuration-driven extension point for
 * navigation. Adding a category here makes it appear in the tab bar (nav.js),
 * get a route, and gain a category page automatically; no other file changes.
 *
 * Placeholder: channel ids and `cid` paths come from m10 /v3/list/MainMenuV3.
 * The per-channel filter options are filled in with the real dimensions in
 * M2-3; until then the option lists are empty. GUI labels are Chinese — the
 * app's interface language is Chinese.
 *
 * Sentinel value '0' means "All" for the genre/area/year filter segments.
 */

// Initial letter — kept only so the components copied from olevod still
// compile; the site has no initial-letter filter (removed in M2-4).
export const LETTERS = [{ value: '0', label: '全部' }]
export const DEFAULT_LETTER = '0'

// list/Search `orderby`; `desc=1` is always sent.
export const SORTS = [
  { value: '1', label: '最新' },
  { value: '2', label: '最热' },
  { value: '3', label: '评分' },
]
export const DEFAULT_SORT = '1'

function channel(id, name, cid) {
  return { id, name, cid, genres: [], areas: [], years: [] }
}

export const CATEGORIES = [
  channel('movie', '电影', '0,1,3'),
  channel('drama', '电视剧', '0,1,4'),
  channel('variety', '综艺', '0,1,5'),
  channel('anime', '动漫', '0,1,6'),
  channel('short', '短剧', '0,1,8'),
  channel('sport', '体育', '0,1,95'),
  channel('documentary', '纪录片', '0,1,7'),
]

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || null
}
