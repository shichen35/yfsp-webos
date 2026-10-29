/*
 * Request signature for the yfsp gateway — pure functions, no network.
 *
 *   vv = md5(pub + "&" + lower(canonicalQuery(qs)) + "&" + privateKey)
 *
 * GET appends `&vv=..&pub=..` to the query; POST appends it to the form body
 * (the URL query is not signed). Taken from the site bundle's uriSignature().
 *
 * Key mode: the site's own fallback — pub is the millisecond timestamp and the
 * private key is picked from a built-in table by pub % 8. The gateway does not
 * check freshness (±1 week passes), so the TV clock doesn't matter.
 */

// ---------------------------------------------------------------------------
// MD5 — pure JS. Chromium 108's WebCrypto has no MD5, so we bundle one.
// Operates on a UTF-8 byte view of the input and returns a lowercase hex digest.
// ---------------------------------------------------------------------------
function md5(input) {
  const msg = utf8Bytes(input)

  function rl(x, c) {
    return (x << c) | (x >>> (32 - c))
  }
  function add(a, b) {
    return (a + b) & 0xffffffff
  }
  function cmn(q, a, b, x, s, t) {
    return add(rl(add(add(a, q), add(x, t)), s), b)
  }
  const FF = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t)
  const GG = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t)
  const HH = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t)
  const II = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t)

  // Pad the message: append 0x80, zero-pad to 56 mod 64, then 64-bit length.
  const bitLen = msg.length * 8
  const withPad = [...msg, 0x80]
  while (withPad.length % 64 !== 56) withPad.push(0)
  // append length as 64-bit little-endian
  for (let i = 0; i < 8; i++) {
    withPad.push((bitLen / Math.pow(2, 8 * i)) & 0xff)
  }

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  for (let off = 0; off < withPad.length; off += 64) {
    const x = new Array(16)
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4
      x[i] = withPad[j] | (withPad[j + 1] << 8) | (withPad[j + 2] << 16) | (withPad[j + 3] << 24)
    }
    const aa = a
    const bb = b
    const cc = c
    const dd = d

    a = FF(a, b, c, d, x[0], 7, 0xd76aa478)
    d = FF(d, a, b, c, x[1], 12, 0xe8c7b756)
    c = FF(c, d, a, b, x[2], 17, 0x242070db)
    b = FF(b, c, d, a, x[3], 22, 0xc1bdceee)
    a = FF(a, b, c, d, x[4], 7, 0xf57c0faf)
    d = FF(d, a, b, c, x[5], 12, 0x4787c62a)
    c = FF(c, d, a, b, x[6], 17, 0xa8304613)
    b = FF(b, c, d, a, x[7], 22, 0xfd469501)
    a = FF(a, b, c, d, x[8], 7, 0x698098d8)
    d = FF(d, a, b, c, x[9], 12, 0x8b44f7af)
    c = FF(c, d, a, b, x[10], 17, 0xffff5bb1)
    b = FF(b, c, d, a, x[11], 22, 0x895cd7be)
    a = FF(a, b, c, d, x[12], 7, 0x6b901122)
    d = FF(d, a, b, c, x[13], 12, 0xfd987193)
    c = FF(c, d, a, b, x[14], 17, 0xa679438e)
    b = FF(b, c, d, a, x[15], 22, 0x49b40821)

    a = GG(a, b, c, d, x[1], 5, 0xf61e2562)
    d = GG(d, a, b, c, x[6], 9, 0xc040b340)
    c = GG(c, d, a, b, x[11], 14, 0x265e5a51)
    b = GG(b, c, d, a, x[0], 20, 0xe9b6c7aa)
    a = GG(a, b, c, d, x[5], 5, 0xd62f105d)
    d = GG(d, a, b, c, x[10], 9, 0x02441453)
    c = GG(c, d, a, b, x[15], 14, 0xd8a1e681)
    b = GG(b, c, d, a, x[4], 20, 0xe7d3fbc8)
    a = GG(a, b, c, d, x[9], 5, 0x21e1cde6)
    d = GG(d, a, b, c, x[14], 9, 0xc33707d6)
    c = GG(c, d, a, b, x[3], 14, 0xf4d50d87)
    b = GG(b, c, d, a, x[8], 20, 0x455a14ed)
    a = GG(a, b, c, d, x[13], 5, 0xa9e3e905)
    d = GG(d, a, b, c, x[2], 9, 0xfcefa3f8)
    c = GG(c, d, a, b, x[7], 14, 0x676f02d9)
    b = GG(b, c, d, a, x[12], 20, 0x8d2a4c8a)

    a = HH(a, b, c, d, x[5], 4, 0xfffa3942)
    d = HH(d, a, b, c, x[8], 11, 0x8771f681)
    c = HH(c, d, a, b, x[11], 16, 0x6d9d6122)
    b = HH(b, c, d, a, x[14], 23, 0xfde5380c)
    a = HH(a, b, c, d, x[1], 4, 0xa4beea44)
    d = HH(d, a, b, c, x[4], 11, 0x4bdecfa9)
    c = HH(c, d, a, b, x[7], 16, 0xf6bb4b60)
    b = HH(b, c, d, a, x[10], 23, 0xbebfbc70)
    a = HH(a, b, c, d, x[13], 4, 0x289b7ec6)
    d = HH(d, a, b, c, x[0], 11, 0xeaa127fa)
    c = HH(c, d, a, b, x[3], 16, 0xd4ef3085)
    b = HH(b, c, d, a, x[6], 23, 0x04881d05)
    a = HH(a, b, c, d, x[9], 4, 0xd9d4d039)
    d = HH(d, a, b, c, x[12], 11, 0xe6db99e5)
    c = HH(c, d, a, b, x[15], 16, 0x1fa27cf8)
    b = HH(b, c, d, a, x[2], 23, 0xc4ac5665)

    a = II(a, b, c, d, x[0], 6, 0xf4292244)
    d = II(d, a, b, c, x[7], 10, 0x432aff97)
    c = II(c, d, a, b, x[14], 15, 0xab9423a7)
    b = II(b, c, d, a, x[5], 21, 0xfc93a039)
    a = II(a, b, c, d, x[12], 6, 0x655b59c3)
    d = II(d, a, b, c, x[3], 10, 0x8f0ccc92)
    c = II(c, d, a, b, x[10], 15, 0xffeff47d)
    b = II(b, c, d, a, x[1], 21, 0x85845dd1)
    a = II(a, b, c, d, x[8], 6, 0x6fa87e4f)
    d = II(d, a, b, c, x[15], 10, 0xfe2ce6e0)
    c = II(c, d, a, b, x[6], 15, 0xa3014314)
    b = II(b, c, d, a, x[13], 21, 0x4e0811a1)
    a = II(a, b, c, d, x[4], 6, 0xf7537e82)
    d = II(d, a, b, c, x[11], 10, 0xbd3af235)
    c = II(c, d, a, b, x[2], 15, 0x2ad7d2bb)
    b = II(b, c, d, a, x[9], 21, 0xeb86d391)

    a = add(a, aa)
    b = add(b, bb)
    c = add(c, cc)
    d = add(d, dd)
  }

  return hex32(a) + hex32(b) + hex32(c) + hex32(d)
}

// 32-bit int -> 8 lowercase hex chars, little-endian byte order (MD5 output order).
function hex32(n) {
  let s = ''
  for (let i = 0; i < 4; i++) {
    s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
  }
  return s
}

function utf8Bytes(str) {
  return Array.from(new TextEncoder().encode(str))
}

// ---------------------------------------------------------------------------
// vv signature
// ---------------------------------------------------------------------------

// The site's HttpClientHelper fallback table, indexed by pub % 8.
const FALLBACK_KEYS = [
  'version001', 'vers1on001', 'vers1on00i', 'bersion001',
  'vcrsion001', 'versi0n001', 'versio_001', 'version0o1',
]

// Mirrors the site's get_query(): split on &, decode each value and turn + back
// into spaces, keep the original order. Signing the raw percent-encoded query
// breaks every request with a Chinese value (region=大陆, search keywords).
export function canonicalQuery(qs) {
  return qs
    .split('&')
    .filter(Boolean)
    .map((kv) => {
      const i = kv.indexOf('=')
      if (i < 0) return kv
      return kv.slice(0, i) + '=' + decodeURIComponent(kv.slice(i + 1)).split('+').join(' ')
    })
    .join('&')
}

export function sign(qs, pub, privateKey) {
  return md5(`${pub}&${canonicalQuery(qs).toLowerCase()}&${privateKey}`)
}

// `vv=..&pub=..` to append to a GET query or a POST body.
export function signParams(qs, now = Date.now()) {
  const pub = String(now)
  return `vv=${sign(qs, pub, FALLBACK_KEYS[now % 8])}&pub=${pub}`
}

export { md5 }
