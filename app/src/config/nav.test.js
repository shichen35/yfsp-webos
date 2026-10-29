// Run with: node --test app/src/config/nav.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { MIDDLE_TABS, HOME_TAB_KEY, tabRows, moveTab, hideTab, showTab, resetTabs } from './nav.js'

const NATURAL = MIDDLE_TABS.map((t) => t.key)
const EMPTY = { tabOrder: null, hiddenTabs: [] }
const shownKeys = (rows) => rows.shown.map((r) => r.tab.key)

test('hide then show puts a tab back in its slot', () => {
  const moved = moveTab(EMPTY, NATURAL[2], -1).state
  const before = shownKeys(tabRows(moved))
  const hidden = hideTab(moved, NATURAL[2])
  assert.ok(!shownKeys(hidden.rows).includes(NATURAL[2]))
  assert.deepEqual(hidden.rows.hidden.map((t) => t.key), [NATURAL[2]])
  assert.deepEqual(shownKeys(showTab(hidden.state, NATURAL[2]).rows), before)
})

test('reset gives the natural order with nothing hidden', () => {
  const messy = hideTab(moveTab(EMPTY, NATURAL[1], -1).state, NATURAL[3]).state
  assert.notDeepEqual(shownKeys(tabRows(messy)), [HOME_TAB_KEY, ...NATURAL])
  const { state, rows } = resetTabs()
  assert.deepEqual(state, EMPTY)
  assert.deepEqual(shownKeys(rows), [HOME_TAB_KEY, ...NATURAL])
  assert.deepEqual(rows.hidden, [])
})

test('首页 never moves and nothing swaps past it', () => {
  assert.equal(moveTab(EMPTY, HOME_TAB_KEY, 1), null)
  assert.equal(moveTab(EMPTY, NATURAL[0], -1), null)
  const [home, first] = tabRows(EMPTY).shown
  assert.deepEqual([home.canUp, home.canDown, first.canUp], [false, false, false])
  // With 首页 hidden, the first middle tab still can't go up.
  assert.equal(moveTab(hideTab(EMPTY, HOME_TAB_KEY).state, NATURAL[0], -1), null)
})

test('a category added after the order was saved shows up at the end', () => {
  const added = NATURAL.at(-1)
  const saved = { tabOrder: NATURAL.slice(0, -1).reverse(), hiddenTabs: [] }
  assert.equal(shownKeys(tabRows(saved)).at(-1), added)
  const hidden = hideTab(saved, added)
  assert.ok(hidden.state.tabOrder.includes(added))
  assert.equal(shownKeys(showTab(hidden.state, added).rows).at(-1), added)
})

test('hiding every middle tab leaves 首页 alone and inert', () => {
  let state = EMPTY
  for (const key of NATURAL) state = hideTab(state, key).state
  const rows = tabRows(state)
  assert.deepEqual(shownKeys(rows), [HOME_TAB_KEY])
  assert.deepEqual(rows.hidden.map((t) => t.key), NATURAL)
  assert.deepEqual(state.tabOrder, NATURAL)
  assert.equal(hideTab(state, 'search'), null)
  assert.equal(hideTab(state, NATURAL[0]), null)
  assert.deepEqual(shownKeys(hideTab(state, HOME_TAB_KEY).rows), [])
})
