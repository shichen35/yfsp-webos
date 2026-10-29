// Run: node --test src/source/yfsp.test.js
// Fixtures are trimmed copies of real responses (2026-10-29), with the stream
// tokens and client IP replaced.
import test from 'node:test'
import assert from 'node:assert/strict'
import { detail, imageUrl, resolveStream, toSummary } from './yfsp.js'

const ok = (info) => JSON.stringify({ ret: 200, data: { code: 0, msg: '', info } })

const DETAIL = {
  id: 50365, key: 'uHcU4Clu390', title: '美人余', contxt: '好命富家女余梦险遭赘婿丈夫吃绝户',
  imgPath: 'https://static.yfsp.tv/upload/video/4e36c65af3504c21a3345729b3eddba3.gif',
  cid: '0,1,4,132', cidMapper: '都市,家庭,爱情', regional: '大陆', language: '国语', post_Year: '2026',
  stars: ['王佳佳', '李一桐'], directors: [], score: '8.1', lastName: '28集全', view: 4374007,
}
const PLAYLIST = { pageSize: 50, playList: [
  { key: 'on7Hba8mDqA', name: '01', isVip: false },
  { key: 'kBI2X7hTHj2', name: '02', isVip: false },
  { key: 'zzVip000003', name: '03', isVip: true },
] }
const M3U8 = 'https://exchange-x.pipecdn.vip/p/chunklist.m3u8?vendtime=1&vhash=x&vCustomParameter=0_0.0.0.0_US_1_0_1_0'
const PLAY = {
  clarity: [
    { title: '1080', description: '蓝光', isVIP: true, isEnabled: false, path: null },
    { title: '576', description: '标清', isVIP: false, isEnabled: true, path: { result: M3U8 } },
  ],
  flvPathList: [
    { isHls: false, link: 'https://ppt.yfsp.tv/c/c', result: 'https://global-cdn.me/ad.mp4' },
    { isHls: true, link: null, result: M3U8 },
  ],
}
const PLAY_VIP = { clarity: PLAY.clarity.map((c) => ({ ...c, isEnabled: false, path: null })), flvPathList: [PLAY.flvPathList[0]] }

// Answer each gateway path with its fixture; record the URLs asked for.
function mockGateway(t, routes) {
  const urls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url)
    const path = new URL(url).pathname
    return { ok: true, status: 200, text: async () => ok(routes[path]) }
  })
  return urls
}

test('detail normalizes fields and numbers episodes ascending, newest first', async (t) => {
  const urls = mockGateway(t, { '/v3/video/detail': [DETAIL], '/v3/video/languagesplaylist': [PLAYLIST] })
  const d = await detail('uHcU4Clu390')
  assert.equal(d.name, '美人余')
  assert.equal(d.score, 8.1)
  assert.equal(d.year, '2026')
  assert.equal(d.lang, '国语')
  assert.equal(d.cast, '王佳佳 / 李一桐')
  assert.equal(d.director, '')
  assert.equal(d.hot, 4374007)
  assert.deepEqual(d.episodes.map((e) => [e.index, e.title, e.vip]), [[3, '03', true], [2, '02', false], [1, '01', false]])
  assert.match(urls[1], /languagesplaylist\?cinema=1&vid=uHcU4Clu390&lsk=1&taxis=1&cid=0,1,4,132&v=1&vv=/)
  assert.deepEqual(Object.keys(toSummary(d)), ['id', 'name', 'pic', 'score', 'remarks', 'year', 'area', 'lang', 'uhd'])
})

test('resolveStream plays an episode key with a=0 and skips the pre-roll ad', async (t) => {
  const urls = mockGateway(t, { '/v3/video/play': [PLAY] })
  const s = await resolveStream('uHcU4Clu390', { key: 'kBI2X7hTHj2', vip: false })
  assert.deepEqual(s, { url: M3U8, type: 'hls', label: '标清 576P' })
  assert.match(urls[0], /play\?cinema=1&id=kBI2X7hTHj2&a=0&/)
})

test('resolveStream without an episode plays the title key with a=1', async (t) => {
  const urls = mockGateway(t, { '/v3/video/play': [PLAY] })
  await resolveStream('uHcU4Clu390')
  assert.match(urls[0], /play\?cinema=1&id=uHcU4Clu390&a=1&/)
})

test('a VIP episode with no playable tier throws a VIP message', async (t) => {
  mockGateway(t, { '/v3/video/play': [PLAY_VIP] })
  await assert.rejects(resolveStream('x', { key: 'zzVip000003', vip: true }), { name: 'ApiError', message: '该集需要 VIP 会员' })
})

test('imageUrl adds the static host and the CDN resize params', () => {
  assert.equal(imageUrl(''), '')
  assert.equal(imageUrl('/upload/video/a.gif'), 'https://static.yfsp.tv/upload/video/a.gif')
  assert.equal(imageUrl('https://static.yfsp.tv/a.gif', '384x560'), 'https://static.yfsp.tv/a.gif?w=384&h=560&format=jpg&mode=crop')
})
