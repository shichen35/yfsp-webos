// Run: node --test src/store/filters.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FILTER, getFilter, patchFilter, resetFilter } from './filters.js'

test('a category starts at the default filter', () => {
  assert.equal(getFilter(1), DEFAULT_FILTER)
})

test('a chip pick survives a later panel pick', () => {
  patchFilter(2, { area: '大陆' }) // panel
  patchFilter(2, { genre: '6' }) // chip
  patchFilter(2, { year: '2024' }) // panel, reopened
  assert.deepEqual(getFilter(2), { ...DEFAULT_FILTER, area: '大陆', genre: '6', year: '2024' })
})

test('reset restores the defaults for that category only', () => {
  patchFilter(3, { genre: '7', sort: 'hot' })
  patchFilter(4, { letter: 'A' })
  resetFilter(3)
  assert.equal(getFilter(3), DEFAULT_FILTER)
  assert.equal(getFilter(4).letter, 'A')
  patchFilter(3, { year: '2023' })
  assert.deepEqual(getFilter(3), { ...DEFAULT_FILTER, year: '2023' })
})
