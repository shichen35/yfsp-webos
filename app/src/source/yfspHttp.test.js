// Run: node --test src/source/yfspHttp.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiGet, buildQuery, isChallenged, unwrap, HOST } from './yfspHttp.js'
import { canonicalQuery } from './yfspSign.js'

const body = (code, msg = '', info = []) => JSON.stringify({ ret: 200, data: { code, msg, info } })

test('code 0 returns data.info', () => {
  assert.deepEqual(unwrap(body(0, '', [{ recordcount: 2 }])), [{ recordcount: 2 }])
})

test('code 1 is an ApiError with the server message', () => {
  assert.throws(() => unwrap(body(1, '用户签名错误')), (e) => e instanceof ApiError && e.code === 1 && e.message === '用户签名错误')
})

test('code 4 is a plain ApiError', () => {
  assert.throws(() => unwrap(body(4, '请求过于频繁')), (e) => e instanceof ApiError && e.code === 4 && e.message === '请求过于频繁')
})

test('code 5 is a challenge: own message and a sticky flag', () => {
  assert.equal(isChallenged(), false)
  assert.throws(() => unwrap(body(5, 'challenge')), (e) => e instanceof ApiError && e.code === 5 && e.message === '访问受限，请稍后再试')
  assert.equal(isChallenged(), true)
})

test('a body without data.code is a transport-level error', () => {
  assert.throws(() => unwrap('<html>520</html>'), (e) => !(e instanceof ApiError))
  assert.throws(() => unwrap(JSON.stringify({ ret: 500 })), (e) => !(e instanceof ApiError))
})

test('buildQuery keeps order and commas, encodes Chinese', () => {
  const qs = buildQuery({ cinema: 1, cid: '0,1,4', region: '大陆', skip: undefined })
  assert.equal(qs, 'cinema=1&cid=0,1,4&region=%E5%A4%A7%E9%99%86')
  assert.equal(canonicalQuery(qs), 'cinema=1&cid=0,1,4&region=大陆')
})

test('apiGet retries an HTTP error with a fresh signature, then gives up', async (t) => {
  const urls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url)
    return { ok: false, status: 520, text: async () => '' }
  })
  await assert.rejects(apiGet(HOST.m10, '/api/list/Search', { cinema: 1, region: '大陆' }), /HTTP 520/)
  assert.equal(urls.length, 3)
  assert.match(urls[0], /^https:\/\/m10\.yfsp\.tv\/api\/list\/Search\?cinema=1&region=%E5%A4%A7%E9%99%86&v=1&vv=[0-9a-f]{32}&pub=\d+$/)
})

test('apiGet does not retry a business error', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return { ok: true, status: 200, text: async () => body(1, '视频不存在') }
  })
  await assert.rejects(apiGet(HOST.m10, '/v3/video/play', { id: 'x' }), /视频不存在/)
  assert.equal(calls, 1)
})
