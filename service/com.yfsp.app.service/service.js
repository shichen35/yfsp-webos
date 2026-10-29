/*
 * com.yfsp.app.service — webOS background service (Node 16, CommonJS).
 *
 * One process, two channels:
 *   1. Luna bus methods `ping` / `fetch` — API JSON retrieval. The packaged
 *      webview runs from a file:// origin; until a real device proves direct
 *      fetch works there (architecture Q4), the service fetches m10/rankv21
 *      and returns decompressed JSON text over the bus.
 *   2. A 127.0.0.1 HTTP proxy — HLS streaming. The video CDN (Cloudflare,
 *      rotating *.vip hosts) answers 520 to any Origin or Referer that isn't
 *      the site's own, and hls.js always sends an Origin. The proxy forwards
 *      with no Origin, no Referer and a browser UA (curl UAs get 403), and
 *      passes Range through. Segment URIs are relative, so the playlist needs
 *      no rewriting.
 *
 * Runs standalone on a dev machine too (`npm run proxy` in app/): webos-service
 * is absent there, so only the proxy starts, and the browser and simulator find
 * it through GET /ping.
 */
'use strict'

var https = require('https')
var http = require('http')
var zlib = require('zlib')
var fs = require('fs')

// ---------------------------------------------------------------------------
// logging — service console output does not reach journald; append to a file
// that on-device debugging can read (or `tail -f` locally).
// ---------------------------------------------------------------------------
var LOG_FILE = '/tmp/yfsp-service.log'
function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + msg + '\n')
  } catch (e) {
    /* a failing log must never take the service down */
  }
}

// ---------------------------------------------------------------------------
// host allowlists — the service must never act as an open proxy
// ---------------------------------------------------------------------------
var API_HOSTS = ['m10.yfsp.tv', 'rankv21.yfsp.tv']

// CDN hosts are randomly generated *.vip domains that rotate, so a host list
// can't keep up: allow the suffixes plus playlist/segment paths only. Checked
// on the parsed URL — a string split let `/proxy/pipecdn.vip:x@example.com/`
// through to example.com — and userinfo is refused outright.
function isAllowedMediaUrl(u) {
  if (u.username || u.password) return false
  return /\.(vip|yfsp\.tv|global-cdn\.me)$/.test(u.hostname) && /\.(m3u8|ts)$/.test(u.pathname)
}

// TLS session reuse — a fresh handshake per media segment is expensive on the
// TV's CPU and shows up as stutter on seeks.
var agent = new https.Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 15000 })

var UA =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'

var UPSTREAM_TIMEOUT_MS = 10000

// ---------------------------------------------------------------------------
// upstream request helper shared by both channels.
// Identity encoding is REQUIRED on the byte path: the proxy pipes bytes through
// without re-emitting Content-Encoding, so a gzip response there would corrupt
// Content-Range/Content-Length and break the player's range requests.
// `extra.body` (JSON text) turns the request into a POST — API channel only.
// ---------------------------------------------------------------------------
function upstreamRequest(parsed, extra, cb) {
  var headers = {
    'User-Agent': UA,
    Accept: extra.media ? '*/*' : 'application/json, text/plain, */*',
    'Accept-Encoding': extra.media ? 'identity' : 'gzip, deflate',
  }
  // CDN requests carry no Origin and no Referer: a foreign one gets 520.
  if (extra.range) headers.Range = extra.range
  var isPost = typeof extra.body === 'string'
  if (isPost) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    headers['Content-Length'] = Buffer.byteLength(extra.body)
  }

  var done = false
  var req = https.request(
    {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 443,
      path: parsed.pathname + (parsed.search || ''),
      method: isPost ? 'POST' : 'GET',
      headers: headers,
      agent: agent,
    },
    function (res) {
      if (done) return
      done = true
      cb(null, res)
    },
  )
  // Without this, one stuck upstream socket freezes playback forever.
  req.setTimeout(UPSTREAM_TIMEOUT_MS, function () {
    req.destroy(new Error('upstream timeout'))
  })
  req.on('error', function (err) {
    if (done) return
    done = true
    cb(err)
  })
  req.end(isPost ? extra.body : undefined)
  return req
}

// Decompress the JSON channel. Some servers send raw deflate rather than
// zlib-wrapped — try inflate, then inflateRaw.
function decompress(res, cb) {
  var chunks = []
  res.on('data', function (c) {
    chunks.push(c)
  })
  res.on('end', function () {
    var buf = Buffer.concat(chunks)
    var enc = res.headers['content-encoding']
    if (enc === 'gzip') {
      zlib.gunzip(buf, function (e, r) {
        cb(e ? buf : r)
      })
    } else if (enc === 'deflate') {
      zlib.inflate(buf, function (e, r) {
        if (!e) return cb(r)
        zlib.inflateRaw(buf, function (e2, r2) {
          cb(e2 ? buf : r2)
        })
      })
    } else {
      cb(buf)
    }
  })
  res.on('error', function () {
    cb(Buffer.concat(chunks))
  })
}

// ---------------------------------------------------------------------------
// Channel 2: local HTTP proxy — /proxy/{host}/{path}?{query}, plus GET /ping
// so a page that has no Luna bus (browser, simulator) can find the proxy.
// ---------------------------------------------------------------------------
var DEFAULT_PORT = 7654 // the dev frontend pings this one (api/luna.js)
var proxyPort = DEFAULT_PORT // requested port; increments on conflict, real value via ping

var proxyServer = http.createServer(function (req, res) {
  if (req.url === '/ping') {
    // Read cross-origin by the dev page on localhost:5173.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    return res.end(JSON.stringify({ ok: true, proxyPort: proxyPort }))
  }
  if (req.url.indexOf('/proxy/') !== 0) {
    res.writeHead(404)
    return res.end('not found')
  }

  var parsed
  try {
    parsed = new URL('https://' + req.url.slice('/proxy/'.length))
  } catch (e) {
    res.writeHead(400)
    return res.end('bad url')
  }
  var hostname = parsed.hostname

  if (!isAllowedMediaUrl(parsed)) {
    log('proxy 403 ' + hostname + parsed.pathname)
    res.writeHead(403)
    return res.end('not allowed')
  }

  upstreamRequest(parsed, { media: true, range: req.headers.range }, function (err, up) {
    if (err) {
      log('proxy 502 ' + hostname + ' ' + err.message)
      if (!res.headersSent) {
        res.writeHead(502)
        res.end(err.message)
      } else {
        res.destroy()
      }
      return
    }
    var h = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': up.headers['content-type'] || 'application/octet-stream',
    }
    if (up.headers['content-range']) h['Content-Range'] = up.headers['content-range']
    if (up.headers['content-length']) h['Content-Length'] = up.headers['content-length']
    if (up.headers['accept-ranges']) h['Accept-Ranges'] = up.headers['accept-ranges']
    res.writeHead(up.statusCode, h)
    up.pipe(res)
    // A half-delivered segment is exactly what an MSE player chokes on — tear
    // down on upstream error; free the upstream socket if the client leaves.
    up.on('error', function () {
      res.destroy()
    })
    res.on('close', function () {
      up.destroy()
    })
  })
})

proxyServer.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    proxyPort++
    proxyServer.listen(proxyPort, '127.0.0.1')
  } else {
    log('proxy fatal ' + err.message)
  }
})
proxyServer.listen(proxyPort, '127.0.0.1', function () {
  log('proxy listening on 127.0.0.1:' + proxyPort)
  console.log('[yfsp-service] proxy on 127.0.0.1:' + proxyPort)
})

// ---------------------------------------------------------------------------
// Channel 1: Luna bus methods (device only — webos-service is absent on a dev
// machine, where the proxy alone is what local acceptance tests).
// ---------------------------------------------------------------------------
var service = null
try {
  var Service = require('webos-service')
  service = new Service('com.yfsp.app.service')
} catch (e) {
  log('webos-service unavailable (dev machine): proxy-only mode')
}

if (service) {
  // Startup handshake: tells the frontend the service is up and which port the
  // proxy actually bound (it may have incremented past 7654).
  service.register('ping', function (m) {
    m.respond({ returnValue: true, ok: true, proxyPort: proxyPort })
  })

  // { url, method?, body? } -> decompressed response text. API hosts only; the
  // URL arrives fully built (and vv-signed for GET) from the frontend. method
  // 'POST' sends `body` as a signed form (search); anything else is a GET.
  service.register('fetch', function (m) {
    var payload = m.payload || {}
    var rawUrl = payload.url
    var parsed
    try {
      parsed = new URL(rawUrl)
    } catch (e) {
      return m.respond({ returnValue: false, error: 'invalid url' })
    }
    if (API_HOSTS.indexOf(parsed.hostname) < 0) {
      return m.respond({ returnValue: false, error: 'host not allowed' })
    }
    var extra = { media: false }
    if (payload.method === 'POST') {
      extra.body = typeof payload.body === 'string' ? payload.body : ''
    }
    upstreamRequest(parsed, extra, function (err, res) {
      if (err) return m.respond({ returnValue: false, error: err.message })
      decompress(res, function (buf) {
        m.respond({
          returnValue: true,
          status: res.statusCode,
          body: buf.toString('utf-8'),
        })
      })
    })
  })

  // Keep the background service alive — without an activity, webOS reaps the
  // idle process and the next Luna call has nothing to answer.
  var keepAliveActivity = null
  service.activityManager.create('keepAlive', function (activity) {
    keepAliveActivity = activity
    log('keepAlive activity created')
  })
}

// One bad upstream response must not take down the whole proxy.
process.on('uncaughtException', function (e) {
  log('uncaught ' + (e && e.stack ? e.stack : e))
})
