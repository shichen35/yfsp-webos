/*
 * 6-column poster grid over a local store's items (favorites, history). Cards
 * are focusables at `rowStart + floor(i / 6)`, `i % 6` in the given group.
 *
 * `manage` flips the grid's meaning for history: cards carry a 删除 marker and
 * OK removes that entry instead of opening it (a D-pad grid has no room for a
 * second focusable per card — col IS the card index).
 */
import VideoCard from './VideoCard.jsx'
import { formatWatchedAt } from '../store/history.js'

export const GRID_COLS = 6

export default function CardGrid({ items, group, onOpenDetail, withEp, rowStart = 0, manage = false, onDelete, emptyText = '这里还没有内容' }) {
  if (!items.length) return <div className="py-20 text-center text-body text-fg-2">{emptyText}</div>
  return (
    <div className="grid grid-cols-6 gap-x-gutter gap-y-6">
      {items.map((item, i) => (
        <VideoCard
          key={`${item.id}-${i}`}
          item={item}
          layer="home"
          group={group}
          row={rowStart + Math.floor(i / GRID_COLS)}
          col={i % GRID_COLS}
          marker={manage ? '删除' : undefined}
          markerIcon={manage ? 'delete' : undefined}
          onSelect={() => (manage ? onDelete(i) : onOpenDetail(item.id))}
          watchedEp={withEp ? item.watch?.lastEpisodeIndex : undefined}
          progress={withEp ? item.watch : undefined}
          timeLabel={withEp ? formatWatchedAt(item.updatedAt) : undefined}
        />
      ))}
    </div>
  )
}
