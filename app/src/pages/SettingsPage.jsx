/*
 * 设置 tab: a page title, then a grouped list (rows 0-3, col 0 of the tab's
 * content group) with the app version as a plain label below. The tab bar's
 * order and visibility are edited in TabOrderDialog; clearing the watch
 * history lives on the 历史 tab, next to the records it deletes.
 */
import { useState } from 'react'
import PageTitle from '../components/PageTitle.jsx'
import Icon from '../components/Icon.jsx'
import TabOrderDialog from '../components/TabOrderDialog.jsx'
import { useFocusable } from '../hooks/useFocus.js'
import { useStoreValue } from '../hooks/useStore.js'
import { settingsStore, getSetting, toggleSetting } from '../store/settings.js'

// tvOS-style list row: transparent at rest, solid white fill + dark text when
// focused (from `focusable`).
const SETTINGS_ROW = 'focusable rounded-tile px-6 py-5 text-body text-fg'

function SettingsRow({ group, row, label, onSelect }) {
  const { props } = useFocusable({ layer: 'home', group, row, col: 0, onSelect })
  return (
    <div className={`${SETTINGS_ROW} flex min-h-[90px] items-center justify-between`} {...props}>
      <span>{label}</span>
      {/* Opens a dialog — the chevron tells it apart from the toggles above.
          min-h matches the toggle rows (their switch is taller than a line of
          text), so every row in the list is the same height. */}
      <Icon name="chevron_right" size={36} />
    </div>
  )
}

function SettingsToggle({ group, row, label, on, onToggle }) {
  const { props } = useFocusable({ layer: 'home', group, row, col: 0, onSelect: onToggle })
  return (
    <div className={`${SETTINGS_ROW} flex items-center justify-between`} {...props}>
      <span>{label}</span>
      {/* Apple-style switch: opaque track (accent when on), knob slides via
          margin. The focused: shades keep it readable on the white focused row. */}
      <span
        className={`flex h-11 w-19 items-center rounded-full p-1 ${on ? 'bg-accent' : 'bg-elev-2 focused:bg-track-focus'}`}
      >
        <span className={`size-9 rounded-full bg-fg focused:bg-white ${on ? 'ml-auto' : ''}`} />
      </span>
    </div>
  )
}

export default function SettingsPage({ group = 'content' }) {
  const [tabOrderOpen, setTabOrderOpen] = useState(false)
  const settings = useStoreValue(settingsStore)

  // Three grid columns wide and centered, on the same axis as the tab capsule.
  return (
    <div className="mx-auto w-span-3 pt-4">
      <PageTitle>设置</PageTitle>
      {/* iOS-style inset grouped list + version caption below. */}
      <div className="rounded-surface border border-elev-2 bg-elev p-1.5">
        <SettingsToggle
          group={group}
          row={0}
          label="首页显示收藏"
          on={getSetting(settings, 'homeShowFavorites')}
          onToggle={() => toggleSetting('homeShowFavorites')}
        />
        <SettingsToggle
          group={group}
          row={1}
          label="首页显示最近观看"
          on={getSetting(settings, 'homeShowRecent')}
          onToggle={() => toggleSetting('homeShowRecent')}
        />
        <SettingsToggle
          group={group}
          row={2}
          label="平滑滚动"
          on={getSetting(settings, 'smoothScroll')}
          onToggle={() => toggleSetting('smoothScroll')}
        />
        <SettingsRow group={group} row={3} label="标签栏顺序与显示" onSelect={() => setTabOrderOpen(true)} />
      </div>
      {/* 34px = group p-1.5 + border + row focus border + px-6: lines up with the row labels. */}
      <div className="mt-5 pl-[34px] text-caption text-fg-3">版本 {__APP_VERSION__}</div>

      {tabOrderOpen && <TabOrderDialog onClose={() => setTabOrderOpen(false)} />}
    </div>
  )
}
