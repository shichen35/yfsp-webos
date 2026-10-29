// Run with: node --test app/src/store/pageCache.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import * as pageCache from './pageCache.js'

// A stub fetcher whose calls resolve only when the test says so.
function stubFetcher() {
  const calls = []
  const fetch = (value) =>
    new Promise((resolve) => {
      calls.push(() => resolve(value))
    })
  return { calls, fetch }
}

test('concurrent loads of one key share a single request', async () => {
  pageCache.clear()
  const f = stubFetcher()
  const a = pageCache.loadOnce('home:popular', () => f.fetch('rows'))
  const b = pageCache.loadOnce('home:popular', () => f.fetch('rows'))
  await Promise.resolve()
  assert.equal(f.calls.length, 1)
  f.calls[0]()
  assert.equal(await a, 'rows')
  assert.equal(await b, 'rows')
  assert.equal(await pageCache.loadOnce('home:popular', () => f.fetch('again')), 'rows')
  assert.equal(f.calls.length, 1)
})

test("a refresh drops only its own feed's entries", async () => {
  pageCache.clear()
  await pageCache.loadOnce('cat:1:a', async () => 'cat1')
  await pageCache.loadOnce('cat:10:a', async () => 'cat10')
  await pageCache.loadOnce('home:popular', async () => 'home')
  pageCache.invalidate('cat:1:')
  assert.equal(await pageCache.loadOnce('cat:1:a', async () => 'cat1 fresh'), 'cat1 fresh')
  assert.equal(await pageCache.loadOnce('cat:10:a', async () => 'refetched'), 'cat10')
  assert.equal(await pageCache.loadOnce('home:popular', async () => 'refetched'), 'home')
})

test('a load from the old session does not land after a session change', async () => {
  pageCache.clear()
  const f = stubFetcher()
  const old = pageCache.loadOnce('detail:7', () => f.fetch('old account'))
  await Promise.resolve()
  pageCache.clear() // account changed
  const fresh = pageCache.loadOnce('detail:7', () => f.fetch('new account'))
  await Promise.resolve()
  assert.equal(f.calls.length, 2) // the new session does not reuse the old request
  f.calls[1]()
  assert.equal(await fresh, 'new account')
  f.calls[0]() // the old response arrives late
  assert.equal(await old, 'old account')
  assert.equal(await pageCache.loadOnce('detail:7', () => f.fetch('x')), 'new account')
})

test('a refresh outruns a stale load of the same key', async () => {
  pageCache.clear()
  const f = stubFetcher()
  const stale = pageCache.loadOnce('home:popular', () => f.fetch('stale'))
  await Promise.resolve()
  pageCache.invalidate('home:')
  const fresh = pageCache.loadOnce('home:popular', () => f.fetch('fresh'))
  await Promise.resolve()
  f.calls[1]()
  await fresh
  f.calls[0]()
  await stale
  assert.equal(await pageCache.loadOnce('home:popular', () => f.fetch('x')), 'fresh')
})
