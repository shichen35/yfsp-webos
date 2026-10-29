/*
 * useSlidingCursor — the sliding white focus "pill" of the top tab bar
 * (TabBar): a horizontal capsule of focusable pills on row 0 of some focus
 * group. This hook gives it one of the app's sanctioned animations (listed in
 * the styles/index.css header) without the caller owning the tricky part.
 *
 * The pill is a SINGLE white node that slides between cells as the D-pad cursor
 * moves (100ms). It's the focus fill itself: the focused cell clears its own
 * background so the pill shows through, so at rest it looks exactly like the
 * old instant white fill — only the cursor now glides instead of jumping. The
 * motion runs via the Web Animations API, which is independent of the CSS
 * `transition/animation: none` ban (see styles/index.css header).
 *
 * Cursor vs. selection: the pill (cursor) tracks focus; a cell's selection mark
 * (selection) tracks the caller's active index, which lags by the 150ms hover
 * debounce. Showing both while navigating looks like the selection trailing the
 * cursor, so the returned `cursorOnBar` lets the caller HIDE the selection mark
 * while focus is on the bar — on the bar you see only the sliding cursor; once
 * focus leaves, the cursor hides and the selection mark appears on the active cell.
 *
 * Reads the focus engine (getCurrentFocus/onFocusChange) but never writes it —
 * the zero-rerender focus path is untouched.
 *
 * Requirements on the caller:
 *   - `containerRef` is the capsule element; it must be `position: relative`
 *     (it's the pill's offsetParent) and contain both the pill and the cells.
 *   - Spread the returned `pillProps` onto a bare <div> inside that capsule,
 *     behind the cells (it carries z-0). The cells must sit above it (z-1) with
 *     a transparent focused background.
 *   - The cells are focusables at `{layer}/{group}-{row}-{col}`, col = index.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { onFocusChange, getCurrentFocus } from './useFocus.js'

export function useSlidingCursor({ containerRef, layer = 'home', group, row = 0, activeIndex, revision }) {
  const pillRef = useRef(null)
  // Where the pill currently sits, so a move can slide from there. Null while
  // hidden (focus off the bar) — the next show places instantly, no fly-in.
  const prevGeom = useRef(null)

  // Live mirrors so the once-bound focus listener never reads a stale closure.
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex
  const prefixRef = useRef('')
  prefixRef.current = `${layer}/${group}-${row}-`

  // Is the D-pad cursor on this bar? Drives whether the caller shows its active
  // cell's selection mark. Only flips on enter/leave, so moving within the bar
  // is a same-value setState React bails on.
  const [cursorOnBar, setCursorOnBar] = useState(() => {
    const f = getCurrentFocus()
    return f == null || f.startsWith(`${layer}/${group}-${row}-`)
  })

  // The cell the pill should cover: the focused cell while focus is on the bar.
  // Focus elsewhere → -1 (hide the pill). Before the engine initializes focus
  // (null) we show it on the active cell so the bar isn't briefly bare on mount.
  const targetIndex = useCallback(() => {
    const f = getCurrentFocus()
    const p = prefixRef.current
    if (f == null) return activeIndexRef.current
    if (f.startsWith(p)) {
      const n = parseInt(f.slice(p.length), 10)
      if (Number.isInteger(n)) return n
    }
    return -1
  }, [])

  // Move the pill onto cell `idx` (or hide it if idx < 0). Absolute + offset
  // math means only this one node moves; cells never reflow. `animate` slides
  // from the previous spot; a hidden pill re-shows instantly.
  const placePill = useCallback(
    (idx, animate) => {
      const pill = pillRef.current
      const container = containerRef.current
      if (!pill || !container) return

      const el =
        idx >= 0 ? container.querySelector(`[data-focus-id="${prefixRef.current}${idx}"]`) : null
      if (!el) {
        pill.style.opacity = '0'
        prevGeom.current = null
        return
      }

      const left = el.offsetLeft
      const width = el.offsetWidth
      pill.style.transform = `translateX(${left}px)`
      pill.style.width = `${width}px`
      pill.style.top = `${el.offsetTop}px`
      pill.style.height = `${el.offsetHeight}px`
      pill.style.opacity = '1'

      const from = prevGeom.current
      prevGeom.current = { left, width }
      if (!animate || !from || (from.left === left && from.width === width)) return

      // The slide: transform only, on this one node, 100ms so the cursor stays
      // snappy. The width is already final; scaleX (origin left) stands in for
      // the size change, so the whole effect runs on the compositor — a width
      // keyframe would drag it onto the main thread with a layout per frame.
      // The rounded ends stretch slightly mid-slide, unnoticeable at 100ms.
      // Cancel any in-flight run so fast left/right presses chain into one
      // motion instead of stacking.
      pill.getAnimations().forEach((a) => a.cancel())
      pill.animate(
        [
          { transform: `translateX(${from.left}px) scaleX(${from.width / width})` },
          { transform: `translateX(${left}px) scaleX(1)` },
        ],
        { duration: 100, easing: 'ease' },
      )
    },
    [containerRef],
  )

  // Slide on every focus move (tracks the cursor across the bar, hides on leave)
  // and flip cursorOnBar — bound once; placePill/targetIndex read live refs.
  useEffect(
    () =>
      onFocusChange(() => {
        const f = getCurrentFocus()
        setCursorOnBar(f != null && f.startsWith(prefixRef.current))
        placePill(targetIndex(), true)
      }),
    [placePill, targetIndex],
  )

  // Reposition when the active cell changes (or the caller bumps `revision`, e.g.
  // the tab list reorders). First run places instantly; later runs slide. When
  // focus is on the bar this resolves to the focused cell, so it no-ops against
  // the focus-driven placement above.
  useLayoutEffect(() => {
    placePill(targetIndex(), prevGeom.current != null)
  }, [activeIndex, revision, placePill, targetIndex])

  const pillProps = {
    ref: pillRef,
    'aria-hidden': true,
    className: 'pointer-events-none absolute left-0 top-0 z-0 origin-left rounded-full bg-focus opacity-0',
  }
  return { pillProps, cursorOnBar }
}
