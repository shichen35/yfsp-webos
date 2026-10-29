/*
 * The single request entry point for the yfsp gateway. Business code calls
 * apiGet(HOST.m10, path, params) / apiPost(...) and gets back `data.info`.
 *
 * Pipeline per request: build the query (+ v=1) -> sign (vv/pub) -> transport
 * -> parse -> validate data.code === 0 -> return data.info. Payloads are plain
 * JSON; HTTP is 200 even for errors, the verdict is in `data.code`.
 *
 * Timeout + retry: each GET attempt has a hard 3s cutoff and we retry up to 3
 * times, RE-SIGNING each attempt. Only network/timeout/parse errors are
 * retried — a nonzero business code is a valid response and is thrown at once.
 * The one POST (search) gets 8s and no retry.
 *
 * code 5 means the gateway wants a Cloudflare Turnstile check, which a TV can't
 * pass. It sets a sticky flag so prefetching stops hammering the gateway.
 */
import { signParams } from './yfspSign.js'
import { transportGet, transportPost } from '../api/luna.js'

export const HOST = {
  m10: 'https://m10.yfsp.tv', // lists, detail, episodes, play
  rank: 'https://rankv21.yfsp.tv', // ranking, search, hot keywords
}

const TIMEOUT_MS = 3000
const RETRY_LIMIT = 3
const POST_TIMEOUT_MS = 8000
const CHALLENGE_CODE = 5

// A nonzero `data.code`. Thrown so callers can tell a valid business rejection
// apart from a transport failure — and so we never retry it.
export class ApiError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

let challenged = false

/** True once the gateway has asked for a human check (code 5) this session. */
export function isChallenged() {
  return challenged
}

// Object -> query string in insertion order (the signature covers the order the
// params are sent in). Commas stay literal, as the site sends `cid=0,1,4`.
export function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ',')}`)
    .join('&')
}

// Race a transport call against a hard cutoff. On the Luna path the underlying
// call can't be cancelled, so it simply finishes in the background while we
// reject here and move on.
function withTimeout(run, ms) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort() // genuinely cancels the direct-fetch path
      reject(new Error('timeout'))
    }, ms)
  })
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer))
}

export function unwrap(text) {
  const data = JSON.parse(text).data
  if (!data || typeof data.code !== 'number') throw new Error('bad response')
  if (data.code === 0) return data.info
  if (data.code === CHALLENGE_CODE) {
    challenged = true
    throw new ApiError('访问受限，请稍后再试', CHALLENGE_CODE)
  }
  // code 1 (bad signature, video not found), 4 (the site's "prevent" dialog)
  // and the rest: show the server's message, never retry.
  throw new ApiError(data.msg || `code ${data.code}`, data.code)
}

/**
 * GET a gateway path and return `data.info`.
 * @param {string} host HOST.m10 or HOST.rank
 * @param {string} path e.g. '/api/list/Search'
 * @param {object} params query params in the order the site sends them
 */
export async function apiGet(host, path, params = {}) {
  const qs = buildQuery({ ...params, v: 1 })
  let lastErr
  for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
    const url = `${host}${path}?${qs}&${signParams(qs)}` // fresh pub every attempt
    try {
      const text = await withTimeout((signal) => transportGet(url, { signal }), TIMEOUT_MS)
      return unwrap(text)
    } catch (e) {
      if (e instanceof ApiError) throw e
      lastErr = e // network / timeout / parse -> retry with a new signature
    }
  }
  throw lastErr || new Error('request failed')
}

/**
 * POST a form to a gateway path and return `data.info`. Like the site, the
 * form body is signed and the URL query is sent as is.
 */
export async function apiPost(host, path, query = {}, form = {}) {
  const url = `${host}${path}?${buildQuery({ ...query, v: 1 })}`
  const body = buildQuery(form)
  const signed = `${body}&${signParams(body)}`
  const text = await withTimeout((signal) => transportPost(url, signed, { signal }), POST_TIMEOUT_MS)
  return unwrap(text)
}
