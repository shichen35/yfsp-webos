/*
 * 历史 tab: the page title with the 管理 chip beside it (row 0), then a
 * 6-column card grid from row 1, fed live from the history store.
 *
 * 管理 mode turns the cards into 删除 targets (see CardGrid); OK removes that
 * entry and the cursor lands on whichever card slides into the slot. It also
 * reveals 全部删除 beside 完成 — the only way to clear the whole history, and
 * behind a confirm, since it is not undoable. Leaving the tab always leaves
 * 管理 mode: coming back to a grid where OK deletes, with no memory of having
 * armed it, is a trap.
 */
import { useCallback, useEffect, useState } from 'react'
import CardGrid, { GRID_COLS } from '../components/CardGrid.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import PageTitle from '../components/PageTitle.jsx'
import { useFocusable, focusTo } from '../hooks/useFocus.js'
import { useStoreValue } from '../hooks/useStore.js'
import { historyStore, clear as clearHistory, remove as removeHistory } from '../store/history.js'

const ACTION_ROW = 0
const GRID_ROW0 = 1

function ActionChip({ group, row, col, label, onSelect }) {
  const { props } = useFocusable({ layer: 'home', group, row, col, onSelect })
  return (
    <span className="focusable chip text-fg" {...props}>
      {label}
    </span>
  )
}

export default function HistoryPage({ group = 'content', active = true, onOpenDetail }) {
  const history = useStoreValue(historyStore)
  const [manage, setManage] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    if (!active) setManage(false)
  }, [active])

  // Everything gone: 管理 has nothing left to manage, and the cursor is on a
  // chip that is about to unmount — put it back on 管理.
  const clearAll = useCallback(() => {
    clearHistory()
    setConfirmClear(false)
    setManage(false)
    focusTo(`home/${group}-${ACTION_ROW}-0`)
  }, [group])

  // Delete the entry at `index` and keep the cursor in the grid. Ids are
  // positional, so the slot that just opened up is the same id — it belongs to
  // the next card now. The last card's slot disappears, so fall back one.
  const deleteAt = useCallback(
    (index) => {
      const item = history[index]
      if (!item) return
      removeHistory(item.id)
      const left = history.length - 1
      if (left === 0) {
        setManage(false)
        focusTo(`home/${group}-${ACTION_ROW}-0`)
        return
      }
      const target = Math.min(index, left - 1)
      focusTo(`home/${group}-${GRID_ROW0 + Math.floor(target / GRID_COLS)}-${target % GRID_COLS}`)
    },
    [history, group],
  )

  return (
    <div className="pt-4">
      <PageTitle
        actions={
          <>
            <ActionChip
              group={group}
              row={ACTION_ROW}
              col={0}
              label={manage ? '完成' : '管理'}
              onSelect={() => setManage((on) => !on)}
            />
            {manage && history.length > 0 && (
              <ActionChip group={group} row={ACTION_ROW} col={1} label="全部删除" onSelect={() => setConfirmClear(true)} />
            )}
            {manage && <span className="text-caption text-fg-2">按 OK 删除该条记录，删完按「完成」退出</span>}
          </>
        }
      >
        观看历史
      </PageTitle>
      <CardGrid
        emptyText="还没有观看记录"
        items={history}
        group={group}
        onOpenDetail={onOpenDetail}
        withEp
        rowStart={GRID_ROW0}
        manage={manage}
        onDelete={deleteAt}
      />

      {confirmClear && (
        <ConfirmDialog
          title="清除观看历史"
          description="将删除全部观看记录与继续观看进度，此操作无法撤销。"
          confirmLabel="清除"
          cancelLabel="取消"
          onConfirm={clearAll}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}
