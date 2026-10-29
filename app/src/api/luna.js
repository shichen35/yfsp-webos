/*
 * Environment detection + transport selection. This is the ONE place the app is
 * allowed to call fetch() or touch the Luna bus, so the business layer never
 * knows whether it is talking to the network directly (browser/dev) or through
 * the Luna service (real device).
 *
 * Two channels:
 *   - API JSON  -> Luna service on the real device, direct fetch in the browser.
 *   - Media     -> local HTTP proxy on the real device, unchanged in the browser.
 *
 * Device mode is handshake-based, not presence-based: PalmSystem existing only
 * makes us TRY a service ping. The simulator has PalmSystem but no Node service
 * — the ping times out there and everything stays on direct fetch.
 */

const SERVICE = 'com.yfsp.app.service'
const PING_TIMEOUT_MS = 2000
const FETCH_TIMEOUT_MS = 10000

// window.PalmSystem is injected only inside the webOS webview.
export const isTV = typeof window !== 'undefined' && !!window.PalmSystem

// Populated by initTvEnv() on the real device.
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
 * incremented past its default on conflict). Browser/simulator: no-op /
 * timeout -> direct mode. Never throws — a dead service just means fallback.
 */
export async function initTvEnv() {
  if (!isTV) return
  try {
    const res = await lunaCall('ping', {}, PING_TIMEOUT_MS)
    if (res && res.ok && res.proxyPort) {
      serviceReady = true
      proxyPort = res.proxyPort
    }
  } catch {
    // Simulator, or the service failed to start: stay in direct mode.
  }
}

// Direct network fetch — the browser/dev path, and the safety-net fallback on
// the device. Returns the raw response text; the caller parses/validates.
async function directGet(url, opts = {}) {
  // Both the API gateway and the CDN return Access-Control-Allow-Origin:*, so
  // the browser reaches them directly with no dev proxy.
  const res = await fetch(url, {
    signal: opts.signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// Direct JSON POST — the browser/dev path. The API's CORS preflight allows any
// origin with a Content-Type header.
async function directPost(url, body, opts = {}) {
  const res = await fetch(url, {
    method: 'POST',
    signal: opts.signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// Real-device Luna transport: the service fetches api.olelive.com and returns
// decompressed text. The URL arrives fully built (and _vv-signed for GET).
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
 * POST a JSON body via the appropriate channel.
 * Unlike transportGet there is no fall back to direct fetch on the device: a
 * Luna timeout doesn't mean the request never reached the server, and sending
 * a login twice would consume the captcha and report a bogus failure.
 * @param {string} url fully-built URL
 * @param {string} body JSON text
 * @param {{signal?: AbortSignal}} opts
 */
export async function transportPost(url, body, opts = {}) {
  if (isTV && serviceReady) return lunaFetch(url, 'POST', body)
  return directPost(url, body, opts)
}

/**
 * Map a media (m3u8/.ts) URL to a loadable address.
 * Browser: returned unchanged. Real device: rewritten to the local proxy so the
 * proxy can inject the CDN Referer and pass through Range/CORS.
 */
export function mediaUrl(rawUrl) {
  if (isTV && serviceReady && proxyPort) {
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
