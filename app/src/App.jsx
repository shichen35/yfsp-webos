/*
 * App shell + view stack.
 *
 * The shell (tab bar + one content area per tab) stays mounted for the whole
 * session; opening detail or player pushes an opaque overlay and hides whatever
 * is beneath it with display:none (never unmount — state and scroll survive).
 *
 * Focus layers mirror the view stack: shell = "home", detail = "detail",
 * player = "player". Each overlay pushes its focus layer on mount and pops it
 * on unmount, so the back chain and focus memory stay in lockstep with the
 * stack.
 *
 * The player is the one lazy() page: its chunk (and hls.js) must stay out of
 * the startup bundle, and it genuinely unmounts on back so playback stops.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  initFocusEngine,
  focusTo,
  getCurrentFocus,
  setActiveContentGroup,
} from './hooks/useFocus.js'

// Each tab's content lives in its own focus group so all tabs can stay mounted
// without their focus ids colliding.
const contentGroup = (tabKey) => `content:${tabKey}`
import { orderedTabs, HOME_TAB_KEY } from './config/nav.js'
import TabBar from './components/TabBar.jsx'
import HomePage from './pages/HomePage.jsx'
import CategoryPage from './pages/CategoryPage.jsx'
import FilterPanel from './components/FilterPanel.jsx'
import DetailPage from './pages/DetailPage.jsx'
import FavoritesPage from './pages/FavoritesPage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import SearchPage from './pages/SearchPage.jsx'
import { settingsStore, getSetting } from './store/settings.js'
import { useStoreValue } from './hooks/useStore.js'
import { prefetchAll } from './api/feeds.js'
import { exitApp } from './api/luna.js'

export default function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [stack, setStack] = useState([{ type: 'shell' }])
  // Per-tab refresh nonce — bumped on tab Enter/click; consumed by pages.
  const [refreshNonce, setRefreshNonce] = useState({})
  const scrollersRef = useRef({}) // tab key -> its .tab-content scroller
  // Tabs mount on first activation and then stay mounted (state/scroll survive),
  // so switching back is instant and no tab fetches until it's first visited.
  const [activated, setActivated] = useState(() => new Set(['home']))
  // Filter panel: which category's panel is open. The selection itself lives in
  // the filters store, shared with that CategoryPage.
  const [filterPanel, setFilterPanel] = useState({ open: false, category: null })

  // Tab bar order and visibility follow the user's saved preference (settings
  // 里可调整).
  const settings = useStoreValue(settingsStore)
  const tabs = useMemo(
    () => orderedTabs(getSetting(settings, 'tabOrder'), getSetting(settings, 'hiddenTabs')),
    [settings],
  )

  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const stackRef = useRef(stack)
  stackRef.current = stack
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  // Hiding the active tab leaves the shell pointing at a tab that no longer
  // exists; fall back to the first one still shown.
  useEffect(() => {
    if (!tabs.some((t) => t.key === activeTab)) setActiveTab(tabs[0].key)
  }, [tabs, activeTab])

  const top = stack[stack.length - 1]
  const hasDetail = stack.some((f) => f.type === 'detail')
  const vis = (type) => ({ display: top.type === type ? 'block' : 'none' })

  const openDetail = useCallback((id) => setStack((s) => [...s, { type: 'detail', id }]), [])
  // Player arrives in M3-2.
  const openPlayer = useCallback(() => {}, [])

  const openFilterFor = useCallback((category) => setFilterPanel({ open: true, category }), [])
  const closeFilter = useCallback(() => setFilterPanel({ open: false, category: null }), [])

  useEffect(() => {
    initFocusEngine()
    setActiveContentGroup(contentGroup('home'))
    // Land on 首页 in the tab bar (搜索's icon button sits before it).
    const homeIndex = Math.max(0, tabsRef.current.findIndex((t) => t.key === HOME_TAB_KEY))
    focusTo(`home/tabbar-0-${homeIndex}`)
  }, [])

  // Background prefetch: warm every tab's cache sequentially so switching tabs
  // is spinner-free. Shares pageCache keys with the pages (no duplicate fetch).
  useEffect(() => {
    let stopped = false
    prefetchAll(() => stopped)
    return () => {
      stopped = true
    }
  }, [])

  // Remember every tab that has been shown so it stays mounted afterwards, and
  // point the tab bar's down-bridge at the active tab's content group.
  useEffect(() => {
    setActiveContentGroup(contentGroup(activeTab))
    setActivated((prev) => {
      if (prev.has(activeTab)) return prev
      const next = new Set(prev)
      next.add(activeTab)
      return next
    })
  }, [activeTab])

  // Back-navigation chain: player -> detail -> content(->tabbar) -> exit.
  useEffect(() => {
    const onBack = () => {
      const prev = stackRef.current
      if (prev.length > 1) {
        // Pop the top overlay; its unmount cleanup pops the matching focus layer.
        setStack(prev.slice(0, -1))
        return
      }
      // At the shell: if focus is in the content area, return it to the tab bar;
      // if it is already on the tab bar, hand Back to the system (exit prompt).
      const cur = getCurrentFocus() || ''
      if (cur.startsWith('home/content:')) {
        const idx = Math.max(0, tabsRef.current.findIndex((t) => t.key === activeTabRef.current))
        focusTo(`home/tabbar-0-${idx}`)
        return
      }
      exitApp()
    }
    window.addEventListener('tv-back', onBack)
    return () => window.removeEventListener('tv-back', onBack)
  }, [])

  return (
    <>
      <div className="relative h-[1080px] w-[1920px] bg-bg" style={vis('shell')}>
        <TabBar
          tabs={tabs}
          activeTab={activeTab}
          onHoverTab={setActiveTab}
          onCommitTab={(key) => {
            setActiveTab(key)
            setRefreshNonce((n) => ({ ...n, [key]: (n[key] || 0) + 1 }))
            // OK on a tab refreshes it from the top: focus stays on the tab
            // bar, so nothing else would bring a scrolled-down page back up
            // to its filter row / first shelf.
            scrollersRef.current[key]?.scrollTo({ top: 0 })
          }}
        />
        {/* Per-tab content areas (the sole scroll containers). Each starts at
            the very top so content passes under the translucent tab bar; the top
            padding keeps the resting position below it, and scroll-py-focus-safe
            (120px, > the bar's 84px) keeps every focus scroll from parking a card
            under the bar — it must be scroll-padding here rather than
            scroll-margin on the card, see the [data-focus-id] rule in index.css.
            The literal `tab-content` class is a marker for CategoryPage's
            closest(). bg-bg + will-change-scroll get it composited scrolling:
            Chromium at DSF 1 with LCD text keeps a transparent scroller on the
            main thread, repainting every scroll frame. */}
        {tabs.map((tab) => (
          <div
            key={tab.key}
            ref={(el) => {
              scrollersRef.current[tab.key] = el
            }}
            className="tab-content absolute inset-0 overflow-y-auto bg-bg will-change-scroll px-safe pt-content-top pb-content-bottom scroll-py-focus-safe"
            style={{ display: tab.key === activeTab ? 'block' : 'none' }}
          >
            {activated.has(tab.key) &&
              (tab.kind === 'home' ? (
                <HomePage group={contentGroup(tab.key)} onOpenDetail={openDetail} refreshNonce={refreshNonce[tab.key]} />
              ) : tab.kind === 'search' ? (
                <SearchPage group={contentGroup(tab.key)} onOpenDetail={openDetail} />
              ) : tab.kind === 'category' ? (
                <CategoryPage
                  category={tab.categoryId}
                  group={contentGroup(tab.key)}
                  onOpenDetail={openDetail}
                  onOpenFilter={() => openFilterFor(tab.categoryId)}
                  refreshNonce={refreshNonce[tab.key]}
                />
              ) : tab.kind === 'favorites' ? (
                <FavoritesPage group={contentGroup(tab.key)} onOpenDetail={openDetail} />
              ) : tab.kind === 'history' ? (
                <HistoryPage group={contentGroup(tab.key)} active={tab.key === activeTab} onOpenDetail={openDetail} />
              ) : (
                <SettingsPage group={contentGroup(tab.key)} />
              ))}
          </div>
        ))}
      </div>

      {filterPanel.open && (
        <FilterPanel
          category={filterPanel.category}
          onClose={closeFilter}
        />
      )}

      {hasDetail && (
        <DetailPage
          id={stack.find((f) => f.type === 'detail').id}
          onPlay={(episodeIndex) => openPlayer({ id: stack.find((f) => f.type === 'detail').id, episodeIndex })}
          style={vis('detail')}
        />
      )}
    </>
  )
}
