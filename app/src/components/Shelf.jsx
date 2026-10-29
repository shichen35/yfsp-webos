/*
 * A titled horizontal row of VideoCards. The caller decides the focus
 * coordinates ({layer, group, row}); each card takes col = its index in the
 * row. Horizontal scrolling is driven entirely by the focus engine
 * (scrollStripIntoView in useFocus.js) — no scroll handlers here.
 *
 * `cardExtras(item)` lets a page inject per-card props (e.g. the Continue
 * Watching shelf passing watchedEp + progress).
 */
import VideoCard from './VideoCard.jsx'

export default function Shelf({ title, items, layer, group, row, onSelectItem, cardExtras }) {
  if (!items || items.length === 0) return null

  // The strip bleeds to the screen edge (-mx-safe) with the first card resting
  // at the safe margin (pl-safe), so STRIP_SAFE in useFocus.js parks the focused
  // card on a column line and each step scrolls exactly one column. The trailing
  // spacer (+ its gap = safe) is the matching end margin: 6 cards fill exactly
  // 1920 and don't scroll. A spacer, not pr-safe: old Chromium may drop a flex
  // scroller's end padding from the scrollable range.
  // bg-bg + will-change-scroll: composited scrolling, same as .tab-content (App.jsx).
  return (
    <section className="mb-11">
      <h2 className="mb-[18px] text-heading font-semibold text-fg">{title}</h2>
      <div className="-mx-safe flex gap-gutter overflow-x-auto overflow-y-hidden bg-bg pl-safe will-change-scroll">
        {items.map((item, i) => (
          <VideoCard
            className="w-card shrink-0"
            key={item.id}
            item={item}
            layer={layer}
            group={group}
            row={row}
            col={i}
            onSelect={() => onSelectItem?.(item)}
            {...(cardExtras ? cardExtras(item) : null)}
          />
        ))}
        <div className="w-16 shrink-0" aria-hidden="true" />
      </div>
    </section>
  )
}
