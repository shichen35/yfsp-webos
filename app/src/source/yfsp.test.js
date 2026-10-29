// Run: node --test src/source/yfsp.test.js
// Fixtures are trimmed copies of real responses (2026-10-29), with the stream
// tokens and client IP replaced.
import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryList, detail, homeBanners, homeShelves, imageUrl, rankList, resolveStream, searchHotKeywords, searchList, toSummary } from './yfsp.js'

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
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    urls.push(init?.body ? `${url} BODY ${init.body}` : url)
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

const LIST_ITEM = {
  key: 'kNyFnqHa7LB', title: '敦煌英雄', image: 'https://static.yfsp.tv/upload/video/c45.gif', rating: '6.0', score: '6.0',
  lastName: '', year: 2026, regional: '大陆', lang: '国语', vipResource: '4K', contxt: '简介不是 key',
}
const SEARCH_ITEM = {
  contxt: 'U15q33LhS28', title: '海上繁花', imgPath: 'https://static.yfsp.tv/upload/video/2021s.gif', score: '6.7', rating: 667,
  lastName: '41集全', postTime: '2021-01-01T00:00:00', regional: '大陆', lang: '国语', vipResource: '720P',
}
const RANK_ITEM = { contxt: 'uE22Zj9bavD', title: '空枪', imgPath: '/upload/video/f0c.gif', score: '7.9', year: '2026', viPsource: '2160p' }

test('list, search and ranking items normalize to the same Summary', async (t) => {
  mockGateway(t, {
    '/api/list/Search': [{ recordcount: 13850, maxpage: 30, result: [LIST_ITEM] }],
    '/v3/list/briefsearch': [{ recordcount: 7, result: [SEARCH_ITEM] }],
    '/api/list/GetVideoRank': { 'false_0,1,3': { week: [RANK_ITEM], month: [], year: [] } },
  })
  const [list] = (await categoryList({ cid: '0,1,3' })).items
  assert.deepEqual(list, { id: 'kNyFnqHa7LB', name: '敦煌英雄', pic: LIST_ITEM.image, score: 6, remarks: '', year: '2026', area: '大陆', lang: '国语', uhd: true })
  const [found] = (await searchList({ keyword: '繁花' })).items
  assert.deepEqual([found.id, found.pic, found.score, found.year, found.uhd], ['U15q33LhS28', 'https://static.yfsp.tv/upload/video/2021.gif', 6.7, '2021', false])
  const rank = await rankList()
  assert.deepEqual(Object.keys(rank), ['movie'])
  assert.deepEqual([rank.movie.week[0].id, rank.movie.week[0].pic, rank.movie.week[0].uhd], ['uE22Zj9bavD', '/upload/video/f0c.gif', true])
})

test('categoryList maps the filter onto list/Search params', async (t) => {
  const urls = mockGateway(t, { '/api/list/Search': [{ recordcount: 4146, maxpage: 30, result: [] }] })
  const page = await categoryList({ cid: '0,1,4', filter: { genre: '0,1,4,132', area: '大陆', lang: '0', year: '0', status: '1', sort: '3' }, page: 2 })
  assert.deepEqual([page.total, page.page, page.maxPage], [4146, 2, 30])
  assert.match(urls[0], /Search\?cinema=1&page=2&size=36&orderby=3&desc=1&cid=0,1,4,132&region=%E5%A4%A7%E9%99%86&isserial=1&isIndex=-1&isfree=-1&isVertical=-1&v=1&vv=/)
  // 全集 / 横屏 are 0, a real value rather than "All".
  await categoryList({ cid: '0,1,8', filter: { status: '0', form: '0' } })
  assert.match(urls[1], /cid=0,1,8&isserial=0&isIndex=-1&isfree=-1&isVertical=0&/)
})

test('searchList signs the form body and keeps the keyword in the URL', async (t) => {
  const urls = mockGateway(t, { '/v3/list/briefsearch': [{ recordcount: 0, result: [] }] })
  await searchList({ keyword: '繁花' })
  assert.match(urls[0], /briefsearch\?tags=%E7%B9%81%E8%8A%B1&orderby=4&page=1&size=36&desc=1&isserial=-1&v=1 BODY tags=%E7%B9%81%E8%8A%B1&vv=[0-9a-f]{32}&pub=\d+$/)
})

test('homeShelves follows taxonomy order and skips empty channels', async (t) => {
  mockGateway(t, { '/v3/home/getAllVideo': [{ tvList: [LIST_ITEM], filmList: [LIST_ITEM], sportList: [], circleList: null }] })
  const shelves = await homeShelves()
  assert.deepEqual(shelves.map((s) => [s.key, s.title, s.items.length]), [['movie', '电影', 1], ['drama', '电视剧', 1]])
})

test('homeBanners drops ads and never throws', async (t) => {
  const urls = mockGateway(t, {
    '/api/home/getmyregion': [{ regionCode: 'HK' }],
    '/v3/home/getflashbanner': [
      { title: '广告', external: true, listPath: '', image: 'a.jpg' },
      { title: '空枪', external: false, listPath: 'uE22Zj9bavD', image: 'https://static.yfsp.tv/upload/user/44e.jpg' },
    ],
  })
  assert.deepEqual(await homeBanners(), [{ id: 'uE22Zj9bavD', name: '空枪', pic: 'https://static.yfsp.tv/upload/user/44e.jpg' }])
  assert.match(urls[1], /region=HK/)
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 520, text: async () => '' }))
  assert.deepEqual(await homeBanners(), [])
})

test('searchHotKeywords takes the first (film) group, deduped', async (t) => {
  mockGateway(t, { '/v3/list/gethotsearchlist': [[{ title: '嫁金钗' }, { title: '玉簟秋' }, { title: '嫁金钗' }], [{ title: '用户视频' }]] })
  assert.deepEqual(await searchHotKeywords(10), ['嫁金钗', '玉簟秋'])
})
