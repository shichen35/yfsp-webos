/*
 * Environment detection + transport selection. This is the ONE place the app is
 * allowed to call fetch() or touch the Luna bus, so the business layer never
 * knows whether it is talking to the network directly (browser/dev) or through
 * the Luna service (real device).
 *
 * Two channels:
 *   - API JSON  -> Luna service on the real device, direct fetch elsewhere.
 *   - Media     -> the local proxy in every environment: the video CDN rejects
 *                  any foreign Origin (hls.js always sends one), and only the
 *                  proxy can drop it. On the device the Luna service runs it;
 *                  in the browser and simulator it is `npm run proxy` on the Mac.
 *
 * Device mode is handshake-based, not presence-based: PalmSystem existing only
 * makes us TRY a service ping. The simulator has PalmSystem but no Node service
 * — the ping times out there and the API stays on direct fetch.
 */

const SERVICE = 'com.yfsp.app.service'
// Where `npm run proxy` listens during development (service.js DEFAULT_PORT).
const DEV_PROXY = 'http://127.0.0.1:7654'
const PING_TIMEOUT_MS = 2000
const FETCH_TIMEOUT_MS = 10000

// window.PalmSystem is injected only inside the webOS webview.
export const isTV = typeof window !== 'undefined' && !!window.PalmSystem

// Populated by initTvEnv(): serviceReady only on the real device, proxyPort
// wherever a proxy answered.
let serviceReady = false
let proxyPort = null

/**
 * One Luna bus call as a Promise. A bus call cannot be truly aborted (same
 * caveat as transportGet), so the timeout rejects and lets any
 * late response fall on the floor.
 */
function lunaCall(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    let bridge
    try {
      // PalmServiceBridge is the raw bus binding every webOS webview injects —
      // no webOSTV.js library needed in the bundle.
      bridge = new window.PalmServiceBridge()
    } catch (e) {
      reject(new Error('no luna bridge'))
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        bridge.cancel()
      } catch {
        /* already torn down */
      }
      reject(new Error(`luna ${method} timeout`))
    }, timeoutMs)

    bridge.onservicecallback = (raw) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error(`luna ${method} bad response`))
      }
    }
    bridge.call(`luna://${SERVICE}/${method}`, JSON.stringify(params || {}))
  })
}

/**
 * Startup hook, awaited before the first frame (main.jsx): on the real device,
 * ping the Luna service and learn the actual proxy port (it may have
 * incremented past its default on conflict). Otherwise (browser, simulator, or
 * a dead service) ask the dev proxy over HTTP. Never throws — no proxy just
 * means media won't load.
 */
export async function initTvEnv() {
  if (isTV) {
    try {
      const res = await lunaCall('ping', {}, PING_TIMEOUT_MS)
      if (res && res.ok && res.proxyPort) {
        serviceReady = true
        proxyPort = res.proxyPort
      }
    } catch {
      // Simulator, or the service failed to start: try the dev proxy.
    }
  }
  if (!proxyPort) {
    try {
      const res = await fetch(`${DEV_PROXY}/ping`, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) })
      const body = await res.json()
      if (body && body.ok && body.proxyPort) proxyPort = body.proxyPort
    } catch {
      // No proxy running.
    }
  }
  console.info(
    `[luna] ${serviceReady ? 'Luna service' : proxyPort ? 'direct + HTTP proxy' : 'direct, no proxy'}` +
      (proxyPort ? ` (proxy port ${proxyPort})` : ''),
  )
}

// Direct network fetch — the browser/dev path, and the safety-net fallback on
// the device. Returns the raw response text; the caller parses/validates.
async function directGet(url, opts = {}) {
  // The API gateway echoes any Origin back in Access-Control-Allow-Origin, so
  // the browser reaches it directly with no dev proxy.
  const res = await fetch(url, {
    signal: opts.signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// Direct form POST — the browser/dev path. A urlencoded body is a CORS simple
// request, so there is no preflight.
async function directPost(url, body, opts = {}) {
  const res = await fetch(url, {
    method: 'POST',
    signal: opts.signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// Real-device Luna transport: the service fetches m10/rankv21.yfsp.tv and
// returns decompressed text. The URL arrives fully built (and vv-signed for GET).
async function lunaFetch(url, method = 'GET', body) {
  const params = method === 'POST' ? { url, method, body } : { url }
  const res = await lunaCall('fetch', params, FETCH_TIMEOUT_MS)
  if (!res || res.returnValue !== true) {
    throw new Error(`luna fetch failed: ${res?.error || 'unknown'}`)
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
  return res.body
}

/**
 * Fetch a URL as text via the appropriate channel.
 * @param {string} url fully-built, already-signed URL
 * @param {{signal?: AbortSignal}} opts
 */
export async function transportGet(url, opts = {}) {
  if (isTV && serviceReady) {
    try {
      return await lunaFetch(url)
    } catch {
      // Service became unavailable mid-flight: fall back to direct fetch once.
      return directGet(url, opts)
    }
  }
  return directGet(url, opts)
}

/**
 * POST a form body via the appropriate channel.
 * Unlike transportGet there is no fall back to direct fetch on the device: a
 * Luna timeout doesn't mean the request never reached the server.
 * @param {string} url fully-built URL
 * @param {string} body urlencoded, already signed
 * @param {{signal?: AbortSignal}} opts
 */
export async function transportPost(url, body, opts = {}) {
  if (isTV && serviceReady) return lunaFetch(url, 'POST', body)
  return directPost(url, body, opts)
}

/**
 * Map a media (m3u8/.ts) URL to a loadable address: rewritten to the local
 * proxy whenever one answered, so the CDN never sees the page's Origin.
 * Segment URIs in the playlist are relative, so they follow through the proxy.
 */
export function mediaUrl(rawUrl) {
  if (proxyPort) {
    try {
      const u = new URL(rawUrl)
      return `http://127.0.0.1:${proxyPort}/proxy/${u.host}${u.pathname}${u.search}`
    } catch {
      return rawUrl
    }
  }
  return rawUrl
}

/**
 * Exit the app (webOS back-chain terminal). Kept here so environment probing
 * never leaks outside this module.
 */
export function exitApp() {
  // PalmSystem.platformBack hands Back to the system (exit confirmation and
  // all); window.webOS only exists when webOSTV.js is loaded, which this app
  // deliberately doesn't ship — probing it always fell through to
  // window.close(), killing the app with no prompt.
  if (window.PalmSystem?.platformBack) window.PalmSystem.platformBack()
  else window.close?.()
}
