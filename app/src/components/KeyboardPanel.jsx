/*
 * On-screen alphanumeric keyboard for the search page — a fixed opaque sheet on
 * the right, on its own "keyboard" focus layer, same shape as the filter panel.
 *
 * Why a panel rather than Android TV's always-visible left column: the search
 * page keeps its box / suggestions / results stack, and the LG system keyboard
 * stays the default and the only way to type Chinese (the site's search does
 * not match pinyin initials). This is the D-pad fallback for English titles
 * and numbers.
 *
 * Every key edits the page's query live, so suggestions refresh while typing.
 *
 * Focus grid (group "panel"): rows 0-5 are the 6x6 key grid, row 6 is
 * 退格 / 清空, row 7 is 系统键盘 / 搜索 — plain arithmetic, the grid is regular.
 */
import { useFocusable, useFocusFrame } from '../hooks/useFocus.js'
import { IconLabel } from './Icon.jsx'

const LAYER = 'keyboard'
const GROUP = 'panel'
const COLS = 6
const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
const ACTION_ROW0 = KEYS.length / COLS // 6

function Key({ row, col, icon, label, onSelect, wide = false }) {
  const { props } = useFocusable({ layer: LAYER, group: GROUP, row, col, onSelect })
  return (
    <div
      className={`focusable flex items-center justify-center h-[72px] rounded-tile bg-elev-2 text-fg ${wide ? 'text-label' : 'text-heading'}`}
      {...props}
    >
      {icon ? <IconLabel icon={icon}>{label}</IconLabel> : label}
    </div>
  )
}

export default function KeyboardPanel({ value, onChange, onSubmit, onSystemKeyboard, onClose }) {
  // Closing returns focus to the 屏幕键盘 button.
  useFocusFrame({ layer: LAYER, focus: `${LAYER}/${GROUP}-0-0`, onBack: onClose })

  return (
    <div className="fixed inset-y-0 right-0 z-10 w-sheet overflow-y-auto border-l border-elev-2 bg-elev pl-10 pr-safe pt-[108px] pb-12 scroll-py-focus-safe">
      <div className="mb-6 text-heading font-semibold text-fg">屏幕键盘</div>
      {/* The query as typed so far; the search box is behind the panel. */}
      <div className="mb-8 flex h-[72px] items-center rounded-tile bg-bg px-6 text-heading text-fg">
        {value || <span className="text-fg-3">输入英文片名或数字</span>}
      </div>

      <div className="mb-4 grid grid-cols-6 gap-2.5">
        {KEYS.map((key, i) => (
          <Key
            key={key}
            row={Math.floor(i / COLS)}
            col={i % COLS}
            label={key}
            onSelect={() => onChange(value + key)}
          />
        ))}
      </div>

      <div className="mb-2.5 grid grid-cols-2 gap-2.5">
        <Key row={ACTION_ROW0} col={0} icon="backspace" label="退格" wide onSelect={() => onChange(value.slice(0, -1))} />
        <Key row={ACTION_ROW0} col={1} label="清空" wide onSelect={() => onChange('')} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Key row={ACTION_ROW0 + 1} col={0} label="系统键盘" wide onSelect={onSystemKeyboard} />
        <Key row={ACTION_ROW0 + 1} col={1} icon="search" label="搜索" wide onSelect={() => onSubmit(value)} />
      </div>
      <div className="mt-6 text-caption text-fg-2">这里只能输入字母和数字，中文片名请用系统键盘</div>
    </div>
  )
}
