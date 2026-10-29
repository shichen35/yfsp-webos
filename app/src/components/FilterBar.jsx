/*
 * Category page header (focus rows 0-1 of the content group): row 0 is a
 * horizontally scrollable strip of subtype chips (All + taxonomy genres);
 * row 1 is its own line with the three sort chips (最新 / 最热 / 评分), the
 * 额外筛选 button that opens the region/year/letter panel, and a
 * non-focusable summary of what that panel currently has set.
 *
 * Selecting a chip applies immediately (server-side filtering in CategoryPage).
 */
import { memo } from 'react'
import { useFocusable } from '../hooks/useFocus.js'
import { IconLabel } from './Icon.jsx'
import { getCategory, SORTS, DEFAULT_LETTER } from '../config/taxonomy.js'

function Chip({ group, row = 0, col, icon, label, selected, onSelect }) {
  const { props } = useFocusable({ layer: 'home', group, row, col, onSelect })
  // Selected is distinct from focus (white fill): accent text plus an accent
  // ring in focusable's reserved border, so selecting never changes the width.
  return (
    <span
      className={`focusable chip ${selected ? 'text-accent [&:not(.focused)]:border-accent' : 'text-fg'}`}
      {...props}
    >
      {icon ? <IconLabel icon={icon}>{label}</IconLabel> : label}
    </span>
  )
}

function summaryText(cfg, filter) {
  const parts = []
  if (filter.area && filter.area !== '0') parts.push(filter.area)
  if (filter.year && filter.year !== '0') parts.push(filter.year)
  if (filter.letter && filter.letter !== DEFAULT_LETTER) parts.push(`首字母 ${filter.letter}`)
  return parts.join(' · ')
}

function FilterBar({ category, group = 'content', filter, onSelectGenre, onSelectSort, onOpenFilter }) {
  const cfg = getCategory(category)
  const genres = cfg.genres

  return (
    <div className="mb-6 flex flex-col gap-4">
      {/* Bleeds to the screen edge like a Shelf; the spacer + gap is the end margin. */}
      <div className="-mx-safe flex gap-3 overflow-x-auto pl-safe">
        {genres.map((g, i) => (
          <Chip
            key={g.value}
            group={group}
            col={i}
            label={g.label}
            selected={filter.genre === g.value}
            onSelect={() => onSelectGenre(g.value)}
          />
        ))}
        <div className="w-18 shrink-0" aria-hidden="true" />
      </div>
      <div className="flex items-center gap-3">
        {SORTS.map((s, i) => (
          <Chip
            key={s.value}
            group={group}
            row={1}
            col={i}
            label={s.label}
            selected={filter.sort === s.value}
            onSelect={() => onSelectSort(s.value)}
          />
        ))}
        {/* Selected while any extra filter is on, like the genre and sort chips. */}
        <Chip group={group} row={1} col={SORTS.length} icon="tune" label="额外筛选" selected={!!summaryText(cfg, filter)} onSelect={onOpenFilter} />
        <div className="ml-3 shrink-0 whitespace-nowrap text-caption text-fg-2">{summaryText(cfg, filter)}</div>
      </div>
    </div>
  )
}

// Memoized: a page append re-renders CategoryPage, not its ~18 filter chips.
export default memo(FilterBar)
