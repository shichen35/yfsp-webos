/*
 * Poster card: 2:3 thumbnail + title + a small meta row, with optional badges
 * (rating, 4K, "Watched through EPxx") and a bottom watch-progress bar.
 *
 * Wrapped in React.memo so a parent re-render doesn't re-render a whole grid of
 * cards. Focus state is the border + title-color swap only — no scale, no
 * shadow, no transition. Grid cards skip off-screen rendering via
 * content-visibility (cv-auto); shelf cards don't (see GRID_CARD).
 */
import { memo } from 'react'
import Thumb from './Thumb.jsx'
import { IconLabel } from './Icon.jsx'
import { useFocusable } from '../hooks/useFocus.js'

// Badge base: opaque pill pinned inside the poster.
export const BADGE = 'absolute rounded-sm px-2 py-[5px] text-caption leading-none'

// Grid default: skip rendering rows far off screen (grids grow by a page at a
// time), remembering each card's real size once laid out. Shelves stay fully
// rendered: a row is capped at 12 cards and its strip is a composited scroller,
// so its cards are painted ahead instead of being un-skipped mid-scroll.
const GRID_CARD = 'cv-auto [contain-intrinsic-size:auto_var(--spacing-card)_auto_490px]'

// `className` sets the sizing context: shelves pass "w-card shrink-0" (fixed
// row of 6); grids pass nothing and the grid track sizes the card.
function VideoCardImpl({ item, layer, group, row, col, onSelect, watchedEp, progress, timeLabel, marker, markerIcon, className = GRID_CARD }) {
  const { props } = useFocusable({ layer, group, row, col, onSelect })

  const pct =
    progress && progress.duration > 0
      ? Math.min(100, Math.max(0, (progress.position / progress.duration) * 100))
      : 0

  return (
    <div className={className} {...props}>
      {/* The focus ring wraps only the poster: the border slot is reserved
          (transparent) so focusing never shifts layout, and the radius is the
          image radius (12px) + the 3px ring so the outer edge stays rounded. */}
      <div className="relative aspect-2/3 w-full overflow-hidden rounded-[15px] border-3 border-transparent bg-elev focused:border-focus">
        <Thumb pic={item.pic} alt={item.name} />
        {/* One decimal everywhere (9 → 9.0) so a row of badges reads evenly; cards
            already carrying watch progress drop it to keep the poster calm. */}
        {item.score > 0 && watchedEp == null && (
          <span className={`${BADGE} top-2 left-2 bg-elev font-semibold text-rating`}>{Number(item.score).toFixed(1)}</span>
        )}
        {/* A marker (history's 管理 mode) takes the 4K corner: what OK does
            right now matters more than the source's tier. */}
        {marker ? (
          <span className={`${BADGE} top-2 right-2 bg-uhd font-semibold text-inverse`}>
            {markerIcon ? (
              <IconLabel icon={markerIcon} size={22}>
                {marker}
              </IconLabel>
            ) : (
              marker
            )}
          </span>
        ) : (
          item.uhd && <span className={`${BADGE} top-2 right-2 bg-uhd font-semibold text-inverse`}>4K</span>
        )}
        {watchedEp != null && <span className={`${BADGE} bottom-3.5 left-2 bg-elev-2 text-fg`}>看到第{watchedEp}集</span>}
        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-elev-2">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="mt-2.5 truncate text-label text-fg-2 focused:text-fg">{item.name}</div>
      {/* One fixed-height line (22px × 1.35; Chromium 108 has no lh unit), so
          every card in a row is the same height even with an empty or long meta. */}
      <div className="mt-1 flex h-[30px] gap-3 overflow-hidden whitespace-nowrap text-caption text-fg-3">
        {/* History cards lead with when the title was last watched, in place
            of the year. */}
        {timeLabel ? <span className="shrink-0">{timeLabel}</span> : null}
        {item.year && !timeLabel ? <span className="shrink-0">{item.year}</span> : null}
        {item.remarks ? <span className="min-w-0 truncate">{item.remarks}</span> : null}
      </div>
    </div>
  )
}

// Compare by value, ignoring function props: the focus engine reads onSelect
// from a ref, so a new onSelect closure from the parent must NOT re-render the
// card. Without this, a parent setState re-renders an entire grid of cards.
function areEqual(a, b) {
  return (
    a.item === b.item &&
    a.className === b.className &&
    a.layer === b.layer &&
    a.group === b.group &&
    a.row === b.row &&
    a.col === b.col &&
    a.watchedEp === b.watchedEp &&
    a.timeLabel === b.timeLabel &&
    a.marker === b.marker &&
    a.markerIcon === b.markerIcon &&
    a.progress?.position === b.progress?.position &&
    a.progress?.duration === b.progress?.duration
  )
}

export default memo(VideoCardImpl, areEqual)
