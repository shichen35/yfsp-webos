/*
 * Tab bar dialog (settings): reorder the middle tabs, and hide or show any tab.
 *
 * Two sections — 显示中 and 已隐藏. Hiding moves a tab into 已隐藏 and out of the
 * tab bar; showing puts it back in the slot it had, because settings.tabOrder
 * keeps every middle tab (hidden ones included) and only the tab bar filters.
 * 首页 stays pinned first, so its arrows are inert. The pinned icon tabs (搜索
 * and 收藏 / 历史 / 设置) are never listed: 设置 carries the entry back
 * here, and they keep their places at the two ends of the bar.
 *
 * Writes land immediately, so the tab bar behind the dialog updates live.
 * Back or 完成 closes; 重置为默认 drops both the saved order and the hidden set.
 *
 * Focus grid (own "tabsort" layer): 显示中 rows first (col 0 = 上移, col 1 =
 * 下移, col 2 = 隐藏), then 已隐藏 rows (col 0 = 显示), then one row with
 * 完成 (col 0) and 重置 (col 1).
 * Hiding or showing changes the row count, so the follow-up focus is queued in
 * a ref and applied after the re-render, once the new ids are registered.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFocusable, useFocusFrame, focusTo } from '../hooks/useFocus.js'
import { useStoreValue } from '../hooks/useStore.js'
import { settingsStore, getSetting } from '../store/settings.js'
import { tabRows, moveTab, hideTab, showTab, resetTabs } from '../config/nav.js'
import Icon from './Icon.jsx'

const LAYER = 'tabsort'

function RowButton({ row, col, icon, label, disabled, wide = false, onSelect }) {
  const { props } = useFocusable({ layer: LAYER, group: 'content', row, col, onSelect })
  return (
    <div
      className={`focusable rounded-tile bg-elev-2 py-2.5 text-center text-label ${wide ? 'px-6' : 'w-21'} ${disabled ? 'text-fg-3' : 'text-fg-2'}`}
      {...props}
    >
      {/* 30px + 2×1.2px = 32.4px, a line of text-label, so icon and text rows match. */}
      {icon ? <Icon name={icon} size={30} className="mx-auto my-[1.2px] block" /> : label}
    </div>
  )
}

function DialogButton({ row, col, label, onSelect }) {
  const { props } = useFocusable({ layer: LAYER, group: 'content', row, col, onSelect })
  return (
    <button className="focusable tile-btn w-full bg-elev-2 text-fg" {...props}>
      {label}
    </button>
  )
}

export default function TabOrderDialog({ onClose }) {
  const settings = useStoreValue(settingsStore)
  const state = useMemo(
    () => ({ tabOrder: getSetting(settings, 'tabOrder'), hiddenTabs: getSetting(settings, 'hiddenTabs') }),
    [settings],
  )
  // Rows: everything except the pinned tabs, shown first and hidden after.
  const { shown, hidden: hiddenTabs } = useMemo(() => tabRows(state), [state])

  const doneRow = shown.length + hiddenTabs.length

  // Focus to apply once the changed row set has rendered.
  const pendingFocusRef = useRef(null)
  useEffect(() => {
    if (!pendingFocusRef.current) return
    focusTo(pendingFocusRef.current)
    pendingFocusRef.current = null
  })

  // Land on the first row that can actually move; with nothing movable
  // (everything hidden, or only 首页 left) land on 完成 instead of an inert
  // arrow or, worse, a 隐藏 button one OK press away.
  const firstMovable = shown.findIndex((r) => r.canDown)
  useFocusFrame({
    layer: LAYER,
    focus: firstMovable >= 0 ? `${LAYER}/content-${firstMovable}-1` : `${LAYER}/content-${doneRow}-0`,
    onBack: onClose,
  })

  const queueFocus = (row, col) => {
    pendingFocusRef.current = `${LAYER}/content-${row}-${col}`
  }

  // Save a transition's state in one write, then focus `key`'s row among the
  // rows it yields — 显示中 first, then 已隐藏 — or 完成 when there is none.
  const apply = (next, key, col = 0) => {
    if (!next) return
    settingsStore.set((prev) => ({ ...prev, ...next.state }))
    const { shown: rows, hidden: hiddenRows } = next.rows
    const shownAt = rows.findIndex((r) => r.tab.key === key)
    const hiddenAt = hiddenRows.findIndex((t) => t.key === key)
    queueFocus(shownAt >= 0 ? shownAt : rows.length + (hiddenAt >= 0 ? hiddenAt : hiddenRows.length), col)
  }

  const move = (key, dir) => apply(moveTab(state, key, dir), key, dir < 0 ? 0 : 1)
  const hide = (key) => apply(hideTab(state, key), key)
  const show = (key) => apply(showTab(state, key), key)
  const reset = () => apply(resetTabs(), null) // every listed tab is shown again -> 完成

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center">
      {/* Sized so the default 8 tabs fit without scrolling: one-line intro,
          70px rows, one footer row, ≈960px in all; hidden tabs add rows and
          the list scrolls. */}
      <div className="flex max-h-[960px] w-[720px] flex-col rounded-surface border border-elev-2 bg-elev px-10 pt-11 pb-8">
        <div className="mb-4 shrink-0 text-title text-fg">标签栏</div>
        <div className="mb-6 shrink-0 text-body leading-normal text-fg-2">
          首页固定在最前，其余可调整顺序或隐藏
        </div>

        <div className="mb-6 flex flex-col gap-2.5 overflow-y-auto scroll-py-focus-safe">
          {hiddenTabs.length > 0 && <div className="text-caption text-fg-3">显示中</div>}
          {/* Keyed by position, not tab.key: focus ids are positional, and a
              keyed DOM move would carry the imperative .focused class along
              with the node while its id changes underneath it. */}
          {shown.map(({ tab, canUp, canDown }, i) => (
            <div className="flex items-center gap-3 rounded-tile bg-bg py-1.5 pr-2.5 pl-6" key={i}>
              <span className="flex-1 truncate text-body text-fg">{tab.label}</span>
              <RowButton row={i} col={0} icon="keyboard_arrow_up" disabled={!canUp} onSelect={() => move(tab.key, -1)} />
              <RowButton row={i} col={1} icon="keyboard_arrow_down" disabled={!canDown} onSelect={() => move(tab.key, 1)} />
              <RowButton row={i} col={2} label="隐藏" wide onSelect={() => hide(tab.key)} />
            </div>
          ))}

          {hiddenTabs.length > 0 && <div className="mt-4 text-caption text-fg-3">已隐藏</div>}
          {hiddenTabs.map((tab, j) => (
            <div className="flex items-center gap-3 rounded-tile bg-bg py-1.5 pr-2.5 pl-6" key={`hidden-${j}`}>
              <span className="flex-1 truncate text-body text-fg-2">{tab.label}</span>
              <RowButton row={shown.length + j} col={0} label="显示" wide onSelect={() => show(tab.key)} />
            </div>
          ))}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3.5">
          <DialogButton row={doneRow} col={0} label="完成" onSelect={onClose} />
          <DialogButton row={doneRow} col={1} label="重置为默认" onSelect={reset} />
        </div>
      </div>
    </div>
  )
}
