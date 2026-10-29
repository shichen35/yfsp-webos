/*
 * Top-level tab model, derived from the taxonomy. The tab bar, routing,
 * and per-tab content areas all read TABS from here — so adding a category in
 * taxonomy.js grows this list with no edits here.
 *
 * Pinned tabs keep their place and can't be hidden: 搜索 at the front and the
 * personal tabs at the end (收藏 / 历史 / 设置) — 设置 holds the entry
 * that brings hidden tabs back. Tabs with an `icon` (a Material Symbols name,
 * see components/Icon.jsx) render as round icon
 * buttons outside the tab bar's text capsule. 首页 stays first in the capsule
 * whenever it is shown; the categories after it are the user-orderable middle.
 */
import { CATEGORIES } from './taxonomy.js'

// kind: 'home' | 'search' | 'category' | 'favorites' | 'history' | 'settings'
export const TABS = [
  { key: 'search', label: '搜索', kind: 'search', icon: 'search', pinned: true },
  { key: 'home', label: '首页', kind: 'home' },
  ...CATEGORIES.map((c) => ({
    key: `cat-${c.id}`,
    label: c.name,
    kind: 'category',
    categoryId: c.id,
  })),
  { key: 'favorites', label: '收藏', kind: 'favorites', icon: 'bookmark', pinned: true },
  { key: 'history', label: '历史', kind: 'history', icon: 'history', pinned: true },
  { key: 'settings', label: '设置', kind: 'settings', icon: 'settings', pinned: true },
]

export const HOME_TAB_KEY = 'home'

export function tabByKey(key) {
  return TABS.find((t) => t.key === key) || null
}

// The tabs the user can reorder and hide, in natural order.
export const MIDDLE_TABS = TABS.filter((t) => !t.pinned && t.key !== HOME_TAB_KEY)

/*
 * TABS rearranged by the user's saved order (settings.tabOrder — an array of
 * middle-tab keys) and filtered by the hidden set (settings.hiddenTabs). Pinned
 * tabs and 首页 keep their slots; the middle tabs follow the saved order, and
 * categories added after the order was saved keep their natural position at
 * the end of the middle section. Keys the order names but TABS no longer has
 * are ignored.
 */
export function orderedTabs(order, hidden = []) {
  const visible = (t) => t.pinned || !hidden.includes(t.key)
  const middle = MIDDLE_TABS.filter(visible)
  let sorted = middle
  if (order && order.length) {
    const byKey = new Map(middle.map((t) => [t.key, t]))
    sorted = []
    for (const key of order) {
      const t = byKey.get(key)
      if (t) {
        sorted.push(t)
        byKey.delete(key)
      }
    }
    for (const t of middle) {
      if (byKey.has(t.key)) sorted.push(t)
    }
  }
  const result = []
  let middleEmitted = false
  for (const t of TABS) {
    if (t.pinned || t.key === HOME_TAB_KEY) {
      if (visible(t)) result.push(t)
    } else if (!middleEmitted) {
      result.push(...sorted)
      middleEmitted = true
    }
  }
  return result
}

// Every middle tab's key in the effective order, hidden ones included — the
// complete list settings.tabOrder should hold so a re-shown tab keeps its slot.
function middleTabKeys(order) {
  return orderedTabs(order, []).filter((t) => !t.pinned && t.key !== HOME_TAB_KEY).map((t) => t.key)
}

/*
 * Tab bar editing (settings › 标签栏) over the saved { tabOrder, hiddenTabs }.
 * The transitions below are its only writers, and they keep its invariants:
 * every write but reset lists every middle tab in tabOrder, hidden ones
 * included, so a tab that is shown again lands back in its slot; 首页 never
 * moves (it isn't in tabOrder) and nothing swaps past it; pinned tabs are
 * never hidden. Each returns { state, rows } — the state to save and the rows
 * it yields — or null when there is nothing to do.
 */

// Dialog rows. shown: 首页 (unless hidden) then the visible middle tabs in bar
// order, each with whether its ▲ / ▼ can act. hidden: the hidden tabs in
// natural order.
export function tabRows({ tabOrder, hiddenTabs = [] }) {
  const tabs = orderedTabs(tabOrder, hiddenTabs).filter((t) => !t.pinned)
  const shown = tabs.map((tab, i) => {
    const movable = tab.key !== HOME_TAB_KEY
    return {
      tab,
      canUp: movable && i > 0 && tabs[i - 1].key !== HOME_TAB_KEY,
      canDown: movable && i < tabs.length - 1,
    }
  })
  return { shown, hidden: TABS.filter((t) => !t.pinned && hiddenTabs.includes(t.key)) }
}

const withRows = (state) => ({ state, rows: tabRows(state) })

// Swap a shown middle tab with its visible neighbour (dir -1 = up, 1 = down).
export function moveTab(state, key, dir) {
  const { shown } = tabRows(state)
  const i = shown.findIndex((r) => r.tab.key === key)
  if (i < 0 || !(dir < 0 ? shown[i].canUp : shown[i].canDown)) return null
  const keys = middleTabKeys(state.tabOrder)
  const a = keys.indexOf(key)
  const b = keys.indexOf(shown[i + dir].tab.key)
  ;[keys[a], keys[b]] = [keys[b], keys[a]]
  return withRows({ ...state, tabOrder: keys })
}

export function hideTab({ tabOrder, hiddenTabs = [] }, key) {
  const tab = tabByKey(key)
  if (!tab || tab.pinned || hiddenTabs.includes(key)) return null
  return withRows({ tabOrder: middleTabKeys(tabOrder), hiddenTabs: [...hiddenTabs, key] })
}

export function showTab({ tabOrder, hiddenTabs = [] }, key) {
  if (!hiddenTabs.includes(key)) return null
  return withRows({ tabOrder: middleTabKeys(tabOrder), hiddenTabs: hiddenTabs.filter((k) => k !== key) })
}

// Natural order, nothing hidden.
export function resetTabs() {
  return withRows({ tabOrder: null, hiddenTabs: [] })
}
