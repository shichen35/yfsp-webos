/*
 * Search page: a search bar driven by the system keyboard (or the on-screen
 * keyboard panel next to it) + a suggestion strip + a 6-column result grid with
 * infinite scroll.
 *
 * The input is a REAL <input>: OK on the search box gives it DOM focus, which
 * is what pops the LG webOS system keyboard (there is no imperative "show
 * keyboard" API). While it has DOM focus the focus engine steps aside
 * (useFocus.js input guard) — the VKB owns the arrows, Enter commits the
 * search via the input's own onKeyDown, Back just closes the keyboard.
 *
 * Focus rows in the content group: row 0 = the search box, then the
 * recent-search strip (only while the box is empty and something was searched
 * before), then suggestion chips (hot keywords until the user types, then the
 * titles a quick search turns up, debounced — the site has no autocomplete),
 * then results — or, before any search is submitted, a 大家都在看 shelf (the
 * home page's 热播榜) in the results' place. Rows stay contiguous — an
 * absent strip shifts everything below it up, because navigate() only probes
 * the adjacent row.
 *
 * Same stale-response discipline as CategoryPage: a monotonically increasing
 * token per fetch family (suggest / results), late responses are dropped.
 */
import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import VideoCard from '../components/VideoCard.jsx'
import Shelf from '../components/Shelf.jsx'
import KeyboardPanel from '../components/KeyboardPanel.jsx'
import { IconLabel } from '../components/Icon.jsx'
import { searchList, searchSuggest, searchHotKeywords } from '../source/index.js'
import { loadHomeRank } from '../api/feeds.js'
import { useFocusable, focusTo, setGeometryVerticalGroup } from '../hooks/useFocus.js'
import { useStoreValue } from '../hooks/useStore.js'
import { searchHistoryStore, remember, clear as clearSearchHistory } from '../store/searchHistory.js'

const COLS = 6
const PAGE_SIZE = 36
const SUGGEST_DEBOUNCE_MS = 300
const HOT_LIMIT = 10

function Chip({ group, row, col, label, onSelect }) {
  const { props } = useFocusable({ layer: 'home', group, row, col, onSelect })
  return (
    <span className="focusable chip text-fg" {...props}>
      {label}
    </span>
  )
}

export default function SearchPage({ group = 'content', onOpenDetail }) {
  const [keyword, setKeyword] = useState('')
  const [hotWords, setHotWords] = useState([])
  const [suggests, setSuggests] = useState([])
  const [submitted, setSubmitted] = useState('')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('idle') // idle | loading | ok | error
  // Idle filler: Home's 热播榜 row (usually cached already), so the page isn't
  // two-thirds empty before a search. Failure just leaves it out.
  const [popular, setPopular] = useState([])
  useEffect(() => {
    loadHomeRank()
      .then(setPopular)
      .catch(() => {})
  }, [])
  const [suggestStatus, setSuggestStatus] = useState('idle') // idle | ok | error
  const [suggestRetry, setSuggestRetry] = useState(0)
  const history = useStoreValue(searchHistoryStore)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  const inputRef = useRef(null)
  // Set while a commit (Enter) is the reason the input is about to blur, so the
  // blur handler can tell "search submitted" apart from "keyboard dismissed".
  const committingRef = useRef(false)
  // Cursor restore for chip picks: picking a chip re-runs the suggest fetch and
  // rebuilds the strip, which would unmount the focused chip and strand the
  // cursor. pickWord arms { col, kw } here; once the refreshed suggestions land
  // (suggestForRef tells whose keyword the current list answers) the cursor is
  // put back on the same column, clamped to the new strip.
  const restoreRef = useRef(null)
  const suggestForRef = useRef('')
  const suggestGenRef = useRef(0)
  const genRef = useRef(0)
  const pageRef = useRef(1)
  const loadingMoreRef = useRef(false)
  const rootRef = useRef(null)
  const sentinelRef = useRef(null)

  // Trending terms fill the strip before the user has typed anything.
  useEffect(() => {
    let alive = true
    searchHotKeywords(HOT_LIMIT)
      .then((words) => {
        if (alive) setHotWords(words)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Autocomplete: debounce keystrokes, drop out-of-order responses. An empty
  // box falls back to the hot keywords instead of firing a request. A failure
  // is shown rather than swallowed — the full title still searches fine, so the
  // strip offers a retry instead of blocking.
  useEffect(() => {
    const kw = keyword.trim()
    const token = ++suggestGenRef.current
    if (!kw) {
      setSuggests([])
      setSuggestStatus('idle')
      return undefined
    }
    const timer = setTimeout(() => {
      searchSuggest(kw)
        .then((words) => {
          if (token !== suggestGenRef.current) return
          suggestForRef.current = kw
          setSuggests(words)
          setSuggestStatus('ok')
        })
        .catch(() => {
          if (token === suggestGenRef.current) setSuggestStatus('error')
        })
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keyword, suggestRetry])

  const runSearch = useCallback((kw) => {
    const q = (kw || '').trim()
    if (!q) return
    // Close the system keyboard. Flag the blur as a commit so handleBlur keeps
    // the cursor on the box instead of dropping it to the suggestion strip —
    // but only when the input actually holds DOM focus (a chip/button-driven
    // search never fires blur, and a stale flag would swallow the next one).
    if (document.activeElement === inputRef.current) committingRef.current = true
    inputRef.current?.blur()
    remember(q)
    const token = ++genRef.current
    pageRef.current = 1
    setSubmitted(q)
    setStatus('loading')
    setItems([])
    searchList({ keyword: q, page: 1, size: PAGE_SIZE })
      .then((res) => {
        if (token !== genRef.current) return // superseded by a newer search
        setItems(res.items)
        setTotal(res.total)
        setStatus('ok')
      })
      .catch(() => {
        if (token === genRef.current) setStatus('error')
      })
  }, [])

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !submitted) return
    setItems((cur) => {
      if (cur.length === 0 || cur.length >= total) return cur
      loadingMoreRef.current = true
      const token = genRef.current
      const next = pageRef.current + 1
      searchList({ keyword: submitted, page: next, size: PAGE_SIZE })
        .then((res) => {
          loadingMoreRef.current = false
          if (token !== genRef.current) return // a newer search took over
          pageRef.current = next
          // A transition: mounting 24 cards yields to key input instead of blocking it.
          startTransition(() => setItems((prev) => [...prev, ...res.items]))
        })
        .catch(() => {
          loadingMoreRef.current = false
        })
      return cur
    })
  }, [submitted, total])

  // Infinite scroll against the tab's scroll container (same as CategoryPage).
  useEffect(() => {
    const scroller = rootRef.current?.closest('.tab-content')
    const sentinel = sentinelRef.current
    if (!scroller || !sentinel) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore()
      },
      { root: scroller, rootMargin: '0px 0px 900px 0px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [loadMore])

  const chips = keyword.trim() ? suggests : hotWords
  // Rows must stay contiguous for the focus grid: a hidden strip shifts the
  // rows below it up.
  const historyRow = !keyword.trim() && history.length > 0 ? 1 : null
  const chipsRow = historyRow === null ? 1 : 2
  const suggestFailed = !!keyword.trim() && suggestStatus === 'error' && chips.length === 0
  const resultRow = chips.length > 0 || suggestFailed ? chipsRow + 1 : chipsRow

  const pickWord = useCallback(
    (word, col) => {
      // Freeze the strip through the pick: on the hot-words branch, changing
      // the keyword would instantly swap in the still-empty suggest list and
      // unmount the chip under the cursor. Seeding suggests with the current
      // strip keeps every chip (and the cursor) in place until the refreshed
      // suggestions arrive; the armed restore then re-seats the cursor.
      restoreRef.current = { col, kw: word.trim() }
      setSuggests(chips)
      setKeyword(word)
      runSearch(word)
    },
    [chips, runSearch],
  )

  // Re-seat the cursor once the pick's refreshed suggestions are in (the
  // seeding update above doesn't match armed.kw and leaves the restore armed):
  // same column clamped to the new strip, or the box if the strip vanished.
  useEffect(() => {
    const armed = restoreRef.current
    if (!armed || suggestForRef.current !== armed.kw) return
    restoreRef.current = null
    if (suggests.length > 0) {
      focusTo(`home/${group}-1-${Math.min(armed.col, suggests.length - 1)}`)
    } else {
      focusTo(`home/${group}-0-0`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggests])

  // A recent term searches immediately. The strip disappears with the box no
  // longer empty, so the cursor goes back to the box rather than being stranded.
  const pickHistory = useCallback(
    (word) => {
      restoreRef.current = null
      setKeyword(word)
      runSearch(word)
      focusTo(`home/${group}-0-0`)
    },
    [group, runSearch],
  )

  // The chip strips scroll on their own and their chips vary in width, so a
  // column index says nothing about screen position: up/down move by geometry
  // (nearest horizontal center), as on Home.
  useEffect(() => {
    setGeometryVerticalGroup('home', group)
    return () => setGeometryVerticalGroup('home', group, false)
  }, [group])

  // OK on the box hands DOM focus to the input, which opens the VKB.
  const box = useFocusable({
    layer: 'home',
    group,
    row: 0,
    col: 0,
    onSelect: () => inputRef.current?.focus(),
  })
  const keyboardButton = useFocusable({
    layer: 'home',
    group,
    row: 0,
    col: 1,
    onSelect: () => setKeyboardOpen(true),
  })

  const fullyLoaded = status === 'ok' && items.length > 0 && items.length >= total

  return (
    <div className="pt-4" ref={rootRef}>
      <div className="mb-6 flex items-center gap-gutter">
        <div
          className="focusable flex h-[72px] w-span-3 shrink-0 items-center rounded-tile bg-elev-2 px-7"
          {...box.props}
        >
          <input
            ref={inputRef}
            value={keyword}
            onChange={(e) => {
              restoreRef.current = null // manual typing cancels a pending chip-pick restore
              setKeyword(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch(keyword)
              } else if (e.key === 'ArrowDown') {
                // Down leaves the field for the suggestion strip (browser dev
                // path; on TV the VKB consumes arrows and dismissing it fires
                // the same blur below).
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            onBlur={() => {
              // Keyboard dismissed mid-typing: hand the cursor to the first
              // suggestion so Down-out-of-the-VKB lands on the autocomplete
              // options. A commit (Enter) keeps it on the box; with no chips
              // registered yet focusTo is a no-op and the box stays focused.
              const wasCommit = committingRef.current
              committingRef.current = false
              if (!wasCommit && keyword.trim()) focusTo(`home/${group}-1-0`)
            }}
            placeholder="输入片名、演员或导演"
            className="w-full bg-transparent text-body text-fg outline-none placeholder:text-fg-3 focused:text-inverse"
          />
        </div>
        <span className="focusable chip text-fg" {...keyboardButton.props}>
          屏幕键盘
        </span>
        {submitted && status === 'ok' && total > 0 && <span className="ml-3 min-w-0 truncate text-caption text-fg-2">「{submitted}」· 共 {total} 部</span>}
      </div>

      {historyRow !== null && (
        <div className="mb-6 flex flex-col gap-3">
          <div className="text-caption text-fg-3">最近搜索</div>
          {/* Bleeds to the screen edge like a Shelf; the spacer + gap is the end margin. */}
          <div className="-mx-safe flex gap-3 overflow-x-auto pl-safe">
            {history.map((word, i) => (
              <Chip key={word} group={group} row={historyRow} col={i} label={word} onSelect={() => pickHistory(word)} />
            ))}
            <Chip
              group={group}
              row={historyRow}
              col={history.length}
              label="清除搜索记录"
              onSelect={() => {
                clearSearchHistory()
                focusTo(`home/${group}-0-0`)
              }}
            />
            <div className="w-18 shrink-0" aria-hidden="true" />
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mb-6 flex flex-col gap-3">
          <div className="text-caption text-fg-3">{keyword.trim() ? '相关搜索' : '热门搜索'}</div>
          <div className="-mx-safe flex gap-3 overflow-x-auto pl-safe">
            {chips.map((word, i) => (
              <Chip key={word} group={group} row={chipsRow} col={i} label={word} onSelect={() => pickWord(word, i)} />
            ))}
            <div className="w-18 shrink-0" aria-hidden="true" />
          </div>
        </div>
      )}

      {suggestFailed && (
        <div className="mb-6 flex items-center gap-4">
          <span className="text-caption text-fg-3">联想暂时不可用，输入完整片名仍可搜索</span>
          <Chip
            group={group}
            row={chipsRow}
            col={0}
            label={<IconLabel icon="refresh">重试联想</IconLabel>}
            onSelect={() => setSuggestRetry((n) => n + 1)}
          />
        </div>
      )}

      {!submitted ? (
        <Shelf title="大家都在看" items={popular} layer="home" group={group} row={resultRow} onSelectItem={(it) => onOpenDetail(it.id)} />
      ) : status === 'error' ? (
        <RetryRow group={group} row={resultRow} onRetry={() => runSearch(submitted)} />
      ) : status === 'ok' && items.length === 0 ? (
        <div className="py-20 text-center text-body text-fg-2">没有找到相关内容，换个关键词试试</div>
      ) : (
        <div className="grid grid-cols-6 gap-x-gutter gap-y-6">
          {items.map((item, i) => (
            <VideoCard
              key={`${item.id}-${i}`}
              item={item}
              layer="home"
              group={group}
              row={resultRow + Math.floor(i / COLS)}
              col={i % COLS}
              onSelect={() => onOpenDetail(item.id)}
            />
          ))}
        </div>
      )}

      {keyboardOpen && (
        <KeyboardPanel
          value={keyword}
          onChange={(next) => {
            restoreRef.current = null
            setKeyword(next)
          }}
          onSubmit={(next) => {
            setKeyboardOpen(false)
            runSearch(next)
          }}
          onSystemKeyboard={() => {
            setKeyboardOpen(false)
            inputRef.current?.focus()
          }}
          onClose={() => setKeyboardOpen(false)}
        />
      )}

      <div ref={sentinelRef} className="h-px w-full" />
      {status === 'loading' && <div className={items.length ? 'py-8 text-center text-caption text-fg-3' : 'py-20 text-center text-body text-fg-2'}>搜索中…</div>}
      {fullyLoaded && <div className="py-8 text-center text-caption text-fg-3">已加载全部 {total} 部</div>}
    </div>
  )
}

function RetryRow({ group, row, onRetry }) {
  const { props } = useFocusable({ layer: 'home', group, row, col: 0, onSelect: onRetry })
  return (
    <div className="py-20 text-center">
      <span className="focusable tile-btn bg-elev-2 text-fg" {...props}>
        <IconLabel icon="refresh">
          搜索失败，重试
        </IconLabel>
      </span>
    </div>
  )
}
