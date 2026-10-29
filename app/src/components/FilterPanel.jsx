/*
 * The category's extra filters (地区 / 语言 / 年份, plus 状态 or 形式 where
 * the channel has them — taxonomy's `panelFilters`), opened by the category
 * page's 额外筛选 button (sort lives on the filter bar itself). A fixed opaque panel on the right on its own "filter" focus layer —
 * no slide-in animation, no scrim over the content behind it (focus is on the
 * panel, so the grid underneath can't receive input anyway).
 *
 * Selecting any option applies immediately: the panel patches the category's
 * filter in the filters store and the grid refreshes from there. "Reset"
 * restores this category's defaults; "Done" and the
 * back key both close the panel and return focus to the 额外筛选 button. Reset
 * and Done sit in the header beside the title, one Up from the first row of
 * chips.
 *
 * Focus movement here is SPATIAL, not arithmetic. Each option group is ONE
 * focus row (col = option index) laid out as a 4- or 8-column grid, with the
 * header's Reset/Done above them all, so a visual step up or down inside a
 * group is not a row ±1 move. Rather than map option indices onto grid cells,
 * we read the chips' live DOM rectangles on each key press and move to the
 * nearest chip in the pressed direction. The shared focus engine still owns painting, selection, scrolling
 * and the layer stack; only the directional step is overridden, via the custom
 * key handler this layer already installs.
 */
import { useRef } from 'react'
import {
  useFocusable,
  useFocusFrame,
  setFocus,
  getCurrentFocus,
} from '../hooks/useFocus.js'
import { getCategory } from '../config/taxonomy.js'
import { useFilter, patchFilter, resetFilter } from '../store/filters.js'

const LAYER = 'filter'
const GROUP = 'panel'

// Chips whose top edges are within this many px count as the same wrapped row.
// Comfortably above sub-pixel rounding, well below one chip height + gap.
const ROW_TOL = 8

// Section index doubles as the focusable's `row` so ids stay unique; the value
// is irrelevant to navigation (that's geometric) — only ordering the ids is.
// The header's Reset/Done take a row past every section.
const ACTION_ROW = 99

// The chips of the wrapped row immediately above/below `cr` (`vdir` 'up'/'down'),
// or [] if `cr` is already on the edge row. "Nearest row" = the closest top edge
// in that direction, then everything sharing that top within ROW_TOL.
function adjacentRowEls(els, rects, cr, vdir) {
  const cand = els.filter((el) => {
    const t = rects.get(el).top
    return vdir === 'down' ? t > cr.top + ROW_TOL : t < cr.top - ROW_TOL
  })
  if (!cand.length) return []
  const rowTop = cand.reduce(
    (best, el) => {
      const t = rects.get(el).top
      if (vdir === 'down') return t < best ? t : best
      return t > best ? t : best
    },
    vdir === 'down' ? Infinity : -Infinity,
  )
  return cand.filter((el) => Math.abs(rects.get(el).top - rowTop) <= ROW_TOL)
}

// Move focus to the nearest chip in `dir`, reading live layout from `root`.
// up/down jump to the adjacent wrapped row and land on the chip whose center is
// closest horizontally — what the eye expects when rows hold different counts.
// left/right walk the current wrapped row and, at a row edge, wrap onward: Right
// past the last chip lands on the next row's first chip, Left past the first
// lands on the previous row's last chip (if such a row exists).
function moveByGeometry(dir, root) {
  if (!root) return
  const els = Array.from(root.querySelectorAll('[data-focus-id]'))
  if (!els.length) return

  const curId = getCurrentFocus()
  const cur = els.find((el) => el.getAttribute('data-focus-id') === curId) || els[0]
  const cr = cur.getBoundingClientRect()
  const curCenterX = cr.left + cr.width / 2

  // Cache rects once; this runs per key press over ~20-40 chips.
  const rects = new Map(els.map((el) => [el, el.getBoundingClientRect()]))
  let target = null

  if (dir === 'left' || dir === 'right') {
    // Same wrapped row, nearest neighbor toward the press.
    for (const el of els) {
      if (el === cur) continue
      const r = rects.get(el)
      if (Math.abs(r.top - cr.top) > ROW_TOL) continue // different wrapped row
      const ahead = dir === 'left' ? r.left < cr.left : r.left > cr.left
      if (!ahead) continue
      if (!target || Math.abs(r.left - cr.left) < Math.abs(rects.get(target).left - cr.left)) {
        target = el
      }
    }
    // At a row edge: wrap to the adjacent row's opposite end.
    if (!target) {
      const rowEls = adjacentRowEls(els, rects, cr, dir === 'right' ? 'down' : 'up')
      for (const el of rowEls) {
        const r = rects.get(el)
        if (!target) {
          target = el
          continue
        }
        const tr = rects.get(target)
        // Right -> leftmost chip of the next row; Left -> rightmost of the prev row.
        target = dir === 'right' ? (r.left < tr.left ? el : target) : (r.left > tr.left ? el : target)
      }
    }
  } else {
    for (const el of adjacentRowEls(els, rects, cr, dir)) {
      const r = rects.get(el)
      const dx = Math.abs(r.left + r.width / 2 - curCenterX)
      const bestDx = target
        ? Math.abs(rects.get(target).left + rects.get(target).width / 2 - curCenterX)
        : Infinity
      if (dx < bestDx) target = el
    }
  }

  if (target) setFocus(target.getAttribute('data-focus-id'))
}

const PANEL_CHIP = 'focusable chip'

// A grid cell: PANEL_CHIP's shape minus its padding (Tailwind emits px-[18px]
// after px-0, so appending px-0 would lose). Selected is distinct from focus
// (white fill): accent text plus an accent ring drawn in focusable's reserved
// border, so selecting never changes a chip's width. The :not(.focused) form
// yields to the white focus border by not matching, not by cascade order.
function OptChip({ row, col, label, selected, className = '', onSelect }) {
  const { props } = useFocusable({ layer: LAYER, group: GROUP, row, col, onSelect })
  return (
    <span
      className={`focusable rounded-full bg-elev-2 py-2 text-center text-label ${className} ${selected ? 'text-accent [&:not(.focused)]:border-accent' : 'text-fg'}`}
      {...props}
    >
      {label}
    </span>
  )
}

function Group({ title, options, value, row, onPick }) {
  return (
    <div className="mb-8">
      <div className="mb-3 text-caption text-fg-2">{title}</div>
      <div className="grid grid-cols-4 gap-3">
        {options.map((o, i) => (
          <OptChip
            key={o.value}
            row={row}
            col={i}
            label={o.label}
            selected={value === o.value}
            onSelect={() => onPick(o.value)}
          />
        ))}
      </div>
    </div>
  )
}

export default function FilterPanel({ category, onClose }) {
  const cfg = getCategory(category)
  const filter = useFilter(category)
  const rootRef = useRef(null)

  // Back closes the panel (focus returns to the 额外筛选 button in the home
  // layer); arrows navigate the wrapped chips spatially; Enter falls through to
  // the engine's onSelect.
  useFocusFrame({
    layer: LAYER,
    focus: `${LAYER}/${GROUP}-0-0`,
    onBack: onClose,
    onKey: (e) => {
      const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]
      if (dir) {
        e.preventDefault()
        moveByGeometry(dir, rootRef.current)
        return true
      }
      return false
    },
  })

  const reset = useFocusable({ layer: LAYER, group: GROUP, row: ACTION_ROW, col: 0, onSelect: () => resetFilter(category) })
  const done = useFocusable({ layer: LAYER, group: GROUP, row: ACTION_ROW, col: 1, onSelect: onClose })

  return (
    <div
      ref={rootRef}
      className="fixed inset-y-0 right-0 z-10 w-sheet overflow-y-auto border-l border-elev-2 bg-elev pl-10 pr-safe pt-[108px] pb-12 scroll-py-focus-safe"
    >
      <div className="mb-6 flex items-center justify-between">
        <div className="text-heading font-semibold text-fg">筛选 · {cfg.name}</div>
        <div className="flex gap-4">
          <span className={`${PANEL_CHIP} text-fg`} {...reset.props}>
            重置
          </span>
          <span className={`${PANEL_CHIP} text-fg`} {...done.props}>
            完成
          </span>
        </div>
      </div>
      {cfg.panelFilters.map((d, i) => (
        <Group key={d.key} title={d.title} options={d.options} value={filter[d.key]} row={i} onPick={(v) => patchFilter(category, { [d.key]: v })} />
      ))}
    </div>
  )
}
