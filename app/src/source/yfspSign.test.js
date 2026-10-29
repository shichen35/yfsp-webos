// Run: node --test src/source/yfspSign.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { md5, canonicalQuery, sign, signParams } from './yfspSign.js'

// pConfig mode (the homepage's inlined keys): privateKey is derived from the
// publicKey — observed on 3 samples, only used here to replay captured vectors.
const derivePriv = (pub) => pub.slice(2, 6) + pub.slice(1, 17)
const tsPriv = (pub) =>
  ['version001', 'vers1on001', 'vers1on00i', 'bersion001', 'vcrsion001', 'versi0n001', 'versio_001', 'version0o1'][
    Number(pub) % 8
  ]

const P1 = 'CJSvCp8qE34qDounEJbVLLDVDZSkCJSqBZ8qE2uoC5yO6fcOcXkR6HePcR8Q61iRCBAmi9kRCPmoCnmRCJCmiIzDJGqPJDcE3OoOZTcDZavD38sOJ8oPMCpEMKoEJLaOJ1'
const P2 = 'CJSvCp8qE34uDYuqCZXVLLDVDZSkCJSqBZ8qE2uoC5yPiJARcHiPd9cPd1YQCB6QCJ8o6nYPcHgocHmnCnaQiAzOMPXP6CrCZKpCMCsEMKnC3bZP64pDcOnE34vCMHXCZ3'
const P3 = 'CJSvCp8qE3GuEIunE3DVLLDVDZSkCJSqBZ8qE2uoC5yp6Z2ScpAmi9cR69mQCfcS71oQCZ4p69mO71gP79omcozDparDsOoOZCrEM8vDsKpE6KpPM4qDcGoCpKoOpOvP32'

// [what, query as the browser sent it (no vv/pub), pub, vv captured in the browser]
const VECTORS = [
  ['getPaymentInfo, timestamp mode', 'isPromotion=4&region=US&v=1', '1793248121136', '9e2be7b65275af441ad7631abc173728'],
  ['getPaymentInfo, timestamp mode', 'isPromotion=4&region=US&v=1', '1793248147246', 'a38de8e058f39e4b2303ecf8b88818d8'],
  ['GetSearchCondition', 'version=1&v=1', P1, 'b65b83fc9b82490575a5c90996c590c1'],
  ['AllVideoType', 'cinema=1&cid=0,1,3&v=1', P1, '7f1e3a1818bc050673277eac87b6931f'],
  ['list/Search', 'cinema=1&page=1&size=36&orderby=0&desc=1&cid=0,1,3&isserial=-1&isIndex=-1&isfree=-1&isVertical=-1&v=1', P1, '904fa11b6834381581e168f274ceaebf'],
  ['video/play', 'cinema=1&id=uHcU4Clu390&a=1&lang=none&usersign=1&region=US&device=1&isMasterSupport=1&v=1', P2, 'db06a24b0f00b0aa5bad55efb537bd79'],
  ['video/detail', 'cinema=1&device=1&player=CkPlayer&tech=HLS&country=HU&lang=cns&v=1&id=uHcU4Clu390&region=US', P2, '54bd1f322385790f4d29a431c56185e2'],
  ['languagesplaylist', 'cinema=1&vid=uHcU4Clu390&lsk=1&taxis=0&cid=0,1,4,132&v=1', P2, 'add83511bee3d6860c6559a5d0d21452'],
  ['getRelativeVideo, Chinese title', 'cinema=1&cid=0,1,4,132&title=%E7%BE%8E%E4%BA%BA%E4%BD%99&size=10&set=1&id=50365&v=1', P2, '466629f095734e63403bb5c4c6b0ed5c'],
  ['list/Search, region=大陆', 'cinema=1&page=1&size=36&orderby=3&desc=1&cid=0,1,4&region=%E5%A4%A7%E9%99%86&isserial=-1&isIndex=-1&isfree=-1&isVertical=-1&v=1', P3, '379724af6acbea328a4161f3e81b908a'],
]

for (const [what, qs, pub, want] of VECTORS) {
  test(`browser vector: ${what}`, () => {
    const priv = /^\d+$/.test(pub) ? tsPriv(pub) : derivePriv(pub)
    assert.equal(sign(qs, pub, priv), want)
  })
}

test('md5 matches the reference digests', () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e')
  assert.equal(md5('大陆'), '6c2be72683d479a0103075f64e561cf0')
})

test('canonicalQuery decodes values and turns + into spaces', () => {
  assert.equal(canonicalQuery('a=%E5%A4%A7%E9%99%86&b=x+y&c'), 'a=大陆&b=x y&c')
})

test('signParams uses the timestamp key table', () => {
  assert.equal(signParams('isPromotion=4&region=US&v=1', 1793248121136), 'vv=9e2be7b65275af441ad7631abc173728&pub=1793248121136')
})
