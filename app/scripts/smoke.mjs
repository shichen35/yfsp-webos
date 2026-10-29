// End-to-end smoke test of the data layer, no UI: channel list -> detail ->
// stream -> playlist and first segment through the local proxy.
// Run from app/ with `npm run proxy` going in another terminal:
//   node scripts/smoke.mjs
import assert from 'node:assert/strict'
import { initTvEnv, mediaUrl } from '../src/api/luna.js'
import { categoryList, detail, resolveStream } from '../src/source/index.js'

const step = (msg) => console.log(`- ${msg}`)

await initTvEnv()
const probe = mediaUrl('https://x.pipecdn.vip/a.m3u8')
assert.ok(probe.startsWith('http://127.0.0.1:'), 'no local proxy answered /ping — start `npm run proxy` first')

const { items, total } = await categoryList({ cid: '0,1,3' })
assert.ok(items.length > 0, 'empty movie list')
step(`movie list: ${total} titles, first ${items[0].name} (${items[0].id})`)

const d = await detail(items[0].id)
assert.ok(d.episodes.length > 0, 'no episodes')
step(`detail: ${d.name}, ${d.episodes.length} episode(s)`)

const ep = d.episodes[d.episodes.length - 1] // index 1 (array is newest first)
const stream = await resolveStream(d.id, ep)
step(`stream: ${stream.label}, ${new URL(stream.url).hostname}`)

const playlistUrl = mediaUrl(stream.url)
const res = await fetch(playlistUrl)
assert.equal(res.status, 200, `playlist via proxy: HTTP ${res.status}`)
const playlist = await res.text()
assert.ok(playlist.startsWith('#EXTM3U'), 'not an m3u8')
const segment = playlist.split('\n').find((l) => l && !l.startsWith('#'))
step(`playlist: ${playlist.split('\n').filter((l) => l.startsWith('#EXTINF')).length} segments`)

// Relative segment URIs resolve against the proxied playlist URL, as in hls.js.
const segRes = await fetch(new URL(segment, playlistUrl))
assert.equal(segRes.status, 200, `segment via proxy: HTTP ${segRes.status}`)
const bytes = new Uint8Array(await segRes.arrayBuffer())
assert.equal(bytes[0], 0x47, 'first segment is not MPEG-TS')
step(`first segment: ${bytes.length} bytes, MPEG-TS sync byte ok`)
console.log('smoke ok')
