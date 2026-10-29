# 视频源调研：yfsp.tv 的播放地址与电视端播放方案

调研时间 2026-10-28，出口 IP 在美国（`region=US`）。样本是电视剧《美人余》（`uHcU4Clu390`）第 1、2 集，另抽查了两部电影（`6rCfqz37jLG`、`X4r3180qOd2`），全程未登录。文中把客户端 IP 写成 `<client-ip>`。

## 结论先说

- 能播。免费档是 576（标清），普通 HLS、MPEG-TS 分片、没有 `#EXT-X-KEY`，分片也没有伪装成图片，hls.js 直接吃。
- 必须走本地媒体代理，原因和 olevod 正好相反：CDN 不要 Referer，但只要带了不在白名单里的 `Origin`（包括 `null`、`file://`、`http://localhost`）或外站 `Referer`，Cloudflare 就回 520。电视上打包应用跑在 `file://`，hls.js 用 XHR 拉流时浏览器一定会带 `Origin: null`，所以直连必挂。代理只需要做一件事：出站时去掉 Origin（Referer 可以不带，或者带 `https://www.yfsp.tv/`）。
- API 不需要 Luna 中转也能通：`m10.yfsp.tv` 对任意 Origin（包括 `null`）都回显 `Access-Control-Allow-Origin`。沿用 olevod 的 Luna `fetch` 也没问题，二选一，下面会说取舍。
- 签名很简单，前端纯函数就能算：`vv = md5(pub + "&" + canonical(query).toLowerCase() + "&" + privateKey)`（`canonical` 先把各参数值 URL 解码，中文参数不解码会签错），`pub` 可以就是当前毫秒时间戳，不用先抓页面。
- 产品上要注意：未登录时 720 / 1080 / 4K 全部标着 VIP，只能拿到 576。实测《美人余》576 档是 864 × 362、约 550 kbps，在大电视上会比较糊。登录后的非会员是否能拿到 720 没法验证（不登录是调研规则）。

## 播放地址从哪来

站点是 Angular SPA，播放器是 hls.js 1.6.9（页面全局 `window.Hls`，打在 `scripts.*.js` 里），详情接口里写着 `player=CkPlayer&tech=HLS`，但实际页面上没有 CkPlayer 对象。

打开播放页后和视频相关的请求顺序：

1. `GET https://m10.yfsp.tv/v3/video/detail?cinema=1&device=1&player=CkPlayer&tech=HLS&country=HU&lang=cns&v=1&id={videoId}&region=US&vv=…&pub=…` 影片详情。
2. `GET https://m10.yfsp.tv/v3/video/languagesplaylist?cinema=1&vid={videoId}&lsk=1&taxis=0&cid=0,1,4,132&v=1&vv=…&pub=…` 剧集列表，每集有 `key`（11 位）、`name`（"01"、"1080P" 之类）、`isVip`。
3. `GET https://m10.yfsp.tv/v3/video/play?cinema=1&id=…&a=…&lang=none&usersign=1&region=US&device=1&isMasterSupport=1&v=1&vv=…&pub=…` 取播放地址，这是唯一要关心的接口。
4. 拉 m3u8，再拉 `media_N.ts`。

`play` 的 `id` / `a` 有两种组合，搞错会返回 `{"code":1,"msg":"视频不存在"}`：

| 场景 | `id` | `a` |
| --- | --- | --- |
| 进影片默认集（站点 URL `/play/{videoId}`） | 影片 id，如 `uHcU4Clu390` | `1` |
| 指定某一集（站点 URL `/play/{videoId}?id={episodeKey}`） | 剧集 key，如 `kBI2X7hTHj2` | `0` |

站点源码里 `getMedia()` 还会带 `sharpness`、`line`（来自本地配置），实测不带也正常返回。

### play 返回的结构

外层是 `{"ret":200,"data":{"code":0,"msg":"","info":[{...}]}}`，`data` 是明文 JSON，没有 olevod 那样的 AES 载荷。`info[0]` 里有用的字段：

- `flvPathList`：数组。实测总是两项，第一项是前贴片广告（`isHls:false`、`result` 指向 `s1-a1.global-cdn.me/vod/*.mp4`、`link` 是 `ppt.yfsp.tv` 的点击统计、`duration:20`，配合 `maxFrontAds:1`），第二项才是正片（`isHls:true`、`link:null`）。
- 正片项的 `result` 和 `rtmp` 是同一个 m3u8，`dashResult` 是同路径的 `manifest.mpd`，`needSign:false`、`validator:null`、`backup:""`。
- `clarity`：清晰度列表，每项有 `title`（2160/1080/720/576）、`description`（4K/蓝光/高清/标清）、`isVIP`、`isEnabled`、`key`，只有当前可播的那一档 `path` 非空，内容和 `flvPathList` 里的正片项相同。
- `customData.t` 是时长（秒），`customData.v` 是宽高比（如 `"864:362"`）。
- `mediaKey` / `mediaTitle` 是实际播放的那一集。
- `pauseData` 是暂停广告图，`previewFormat` 是进度条缩略图（`global-cdn.me/sb/…/M{group}.jpg`）。
- 其他标志：`needLogin`、`isPreView`、`isLimitedStream`、`isLine`，样本里都是 0 / false。`isPreView` 推测是 VIP 集的试看，没碰到。

客户端取正片地址建议用 `clarity.find(c => c.isEnabled && c.path)?.path.result`，兜底再取 `flvPathList.find(p => p.isHls && !p.link)`。前贴片和暂停广告直接忽略。

清晰度没有「多线路」：`clarity[].line` 全是 0，`isLine:false`，每次只给一个可播档。切档要用该档的 `key` 当 `id`、`a=0` 再请求一次 `play`；未登录时请求 VIP 档没有意义。

### 签名

主包里的 `uriSignature()`：

```js
// canonical(query)：URL 里 ? 后面的部分，按 & 拆开、值做 decodeURIComponent、+ 换空格后再拼回
vv = md5(publicKey + '&' + canonical(query).toLowerCase() + '&' + privateKey)
url = url + '&vv=' + vv + '&pub=' + publicKey
```

`publicKey` / `privateKey` 有两个来源：

1. 页面 HTML 内联的 `pConfig: {publicKey, privateKey: [..]}`，每次请求页面都不同；
2. 没有 `pConfig` 时的兜底：`publicKey = String(Date.now())`，`privateKey = KEYS[Date.now() % 8]`，`KEYS = ["version001","vers1on001","vers1on00i","bersion001","vcrsion001","versi0n001","versio_001","version0o1"]`。

两种都实测能过 `play`。电视端用第 2 种，不用先抓 HTML。每次请求现算，不复用。签名错误时返回 `{"code":1,"msg":"用户签名错误"}`；`data.code === 5` 时站点会跳 `/challenge` 页（Cloudflare Turnstile 人机验证），电视端没法完成，只能提示失败，这是一个潜在风险，调研期间没触发过。

`rankv21.yfsp.tv` 下的部分列表接口（如 `gethotsearchlist`、`getCoBusiness`）站点自己都不签名，带 `cacheable=1`。

## m3u8 和分片

正片地址形如：

```
https://exchange-d1829s111.pipecdn.vip/ppotb62-{长路径}/chunklist.m3u8
  ?vendtime=1793420834&vhash={base64url}&vCustomParameter=0_<client-ip>_US_1_0_1_0&lb={32hex}&us=1
```

- 三个样本都落在 `exchange-d1829s111.pipecdn.vip`，背后是 Cloudflare。
- `vendtime` 约等于请求时间 + 48 小时，`vhash` 覆盖了整个查询串：改掉 `vCustomParameter` 里的 IP、去掉 `vhash` 都会 403。IP 被签进地址，所以拿地址和拉流最好来自同一出口；电视上 API 和代理都在电视本机发出，天然满足。是否真的校验请求方 IP 没法从单一出口验证。
- 站点播放时会在 m3u8 URL 后面再追加 `&vv=…&pub=…`，实测不追加也能拉到，CDN 不看它。

m3u8 内容（节选）：

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:20
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:11.04,
media_0.ts?vCustomParameter=…&lb=…&ab=a&verify=1793248072-{base64 HMAC}
…
#EXT-X-ENDLIST
```

- 单档媒体播放列表，没有 master，没有 `#EXT-X-KEY`、`#EXT-X-MAP`、`#EXT-X-DISCONTINUITY`，没有插入广告分片。
- 分片地址是相对路径，所以经代理加载时自然也走代理，不用改写 m3u8。
- `verify` 前半段是生成 m3u8 时的 Unix 时间，后半段是按分片签的：拿 `media_0` 的 `verify` 去请求 `media_5`、改 `ab`、去掉 `verify` 都是 403。浏览器里拿到的旧 `verify` 过了 5 分钟多仍然有效，确切有效期没测出来，可能就是 `vendtime` 的 48 小时，也可能更短。
- 分片是标准 MPEG-TS，首字节 `0x47`，`Content-Type: video/MP2T`，没有 PNG 头要剥。样本分片约 11 秒、766 KB。
- 响应头：`access-control-allow-origin: *`、`accept-ranges: bytes`（`Range` 返回 206）、分片 `cache-control: max-age=2147483648`，m3u8 `max-age=7200`、`vary: accept-encoding`。

站点还有一个悬停预览接口 `https://upload.yfsp.tv/api/video/MasterPlayList?id={mediaKey}`，不签名，返回一个带 20 个 `STREAM-INF` 的 master，每项指向不同的随机域名（`s100-e1.streampluxb.vip`、`s100-e1.globenete.vip`、`s100-e1.netsecurec.vip` 等），分片是跨域名的绝对地址，总长约 147 秒，各档 key 返回的内容相同，就是预告片段。正片用不到，但它说明这家 CDN 的域名是随机生成、会轮换的，代理白名单不能按固定后缀写死。

## CDN 访问校验（curl 实测）

以 m3u8 和 `media_0.ts` 为对象，结果两者一致：

| 请求头 | 结果 |
| --- | --- |
| 不带 Referer、不带 Origin，UA 为浏览器 / webOS / `node` / 空 | 200 |
| UA 为 curl 默认（`curl/x.y`） | 403，Cloudflare「Attention Required」 |
| `Origin: https://www.yfsp.tv`、`https://yfsp.tv`、`https://m.yfsp.tv`、`https://www.iyf.tv` | 200 |
| `Origin: null` / `file://` / `http://localhost` / `http://127.0.0.1:7654` / `https://example.com` | 520 |
| `Referer: https://example.com/`、`Referer: file:///…`、olevod 的 `Referer: https://www.olevod.com/` | 520 |
| `Referer: https://www.yfsp.tv/` | 200 |

也就是说 CDN 对 Origin / Referer 是「不带可以、带就得是自家域名」。不校验 cookie。时效靠 `vendtime` + `vhash`（m3u8）和 `verify`（分片）。

API 网关 `m10.yfsp.tv`：只认 `vv` / `pub`，`Origin: null` 和外站 Origin 都放行并回显到 `Access-Control-Allow-Origin`，curl 默认 UA 也能访问。

海外和国内的差异没法验证（只有美国出口）。`play` 请求带 `region`，返回地址里的 `vCustomParameter` 带国家码，CDN 节点大概率按地区分配，国内出口可能拿到别的域名。

## 电视端方案

### 为什么不能直连

hls.js 用 XHR / fetch 取 m3u8 和分片，跨域请求浏览器会自动加 `Origin`，页面在 `file://` 下就是 `Origin: null`，这个头 JS 改不掉，CDN 直接 520。`<video src>` 原生管线不发 Origin，理论上能播，但 olevod 已经验证过 webOS 原生 HLS 缓冲浅、高码率会反复卡，只能当兜底。

开发机浏览器同理：`npm run dev` 的页面在 `http://localhost:5173`，也会被 520。这一点和 olevod 不同，olevod 开发时可以直连，这里开发时也需要代理（Vite `server.proxy` 或者直接在本机跑服务端脚本）。

### 推荐：沿用 olevod 的双通道，代理规则改成下面这样

整体结构照搬 olevod（`doc/dev/data-channel.md`）：Luna 服务开 `127.0.0.1` 本地 HTTP 代理，前端 `mediaUrl()` 改写地址，ping 握手拿端口。和 olevod 的差别只在 `upstreamRequest()` 的出站头和白名单：

地址改写（前端，同 olevod）：

```
https://{host}{path}?{query}  ->  http://127.0.0.1:{port}/proxy/{host}{path}?{query}
```

代理出站头：

- 不发 `Origin`，也不转发客户端的 `Origin` / `Referer` / `Cookie`；
- `Referer` 不带，或固定为 `https://www.yfsp.tv/`（两种都实测 200，建议不带，少一个指纹）；
- `User-Agent` 固定一个 webOS / Chrome UA，Node 默认不发 UA 也行，但不能出现 `curl`；
- 透传 `Range`；
- `Accept-Encoding: identity`（m3u8 有 `vary: accept-encoding`，代理是字节透传，不能让上游给 gzip）。

代理回写：状态码、`Content-Type`、`Content-Length`、`Content-Range`、`Accept-Ranges`，加 `Access-Control-Allow-Origin: *`。上游 403 / 520 原样回给播放器，便于前端区分「地址过期」和网络错误。

m3u8 内容：正片是相对分片路径，不需要改写。为了防御将来出现绝对地址（预览 master 已经是这样），代理可以对 `Content-Type` 为 mpegurl 的响应做一次简单替换：把行首的 `https://{host}/` 换成 `http://127.0.0.1:{port}/proxy/{host}/`，`#EXT-X-KEY` / `#EXT-X-MAP` 的 `URI="…"` 同理。目前样本里都不需要，MVP 可以先不做。

白名单：CDN 域名是随机的 `.vip` 域名，固定后缀列表维护不了。建议两种做法选一：

1. 前端在拿到 `play` 结果后把正片 host 通过 Luna 注册给服务（动态白名单），代理只放行注册过的 host 及 `*.yfsp.tv`；
2. 简单版：放行 `*.yfsp.tv`、`*.global-cdn.me` 和所有 `.vip` 域名，同时要求路径匹配 `^/ppotb\w*-[^/]+/(chunklist\.m3u8|media_\d+\.ts)$`。

代理只监听 127.0.0.1，两种都不会变成对外开放代理，第 1 种更严。

### API 走哪条路

`m10.yfsp.tv` 对 `Origin: null` 放行，webview 里直接 `fetch` 就行，不需要 Luna `fetch`。保留 Luna 通道的理由只有一个：将来如果网关开始挡 `Origin: null` 或开启 Cloudflare 挑战，可以在服务端换头。建议架构上保留 olevod 的 `transportGet()` 分层（设备上优先 Luna、失败退直连），实现成本低，出事时只改服务端。

### 播放器侧要改的地方

- 取地址：按上面的 `id` / `a` 规则调 `play`，取 `clarity` 里 `isEnabled` 的那一档，忽略 `flvPathList` 里的广告项。
- 画质：只有一档，hls.js 的 level 选择逻辑（olevod 的 `pickStartLevel()`）基本用不上，画质卡片直接显示 `clarity` 的 `description`。
- 地址过期：`verify` 有效期不确定，长时间暂停后续播可能遇到分片 403。olevod 看门狗的软重载只是 `startLoad(pos)`，拿的还是旧地址；这里要在 hls.js 报 `fragLoadError` 且响应码 403 时重新请求 `play`，`loadSource()` 新地址后从当前位置继续。
- VIP：`clarity` 里 `isVIP:true && !isEnabled` 的档位只做展示或干脆不展示；剧集列表里 `isVip:true` 的集要先拦。`play` 返回 `needLogin` 非 0 时走登录提示。
- `code === 5`（人机验证）单独给一个错误文案，不要去重试。

## 可以复用的验证脚本

调研时写的探测脚本在 scratchpad（不进仓库），核心逻辑就是签名加一次 `play`：

```python
KEYS = ["version001","vers1on001","vers1on00i","bersion001","vcrsion001","versi0n001","versio_001","version0o1"]
ts = int(time.time() * 1000); pub = str(ts)
q = "cinema=1&id=uHcU4Clu390&a=1&lang=none&usersign=1&region=US&device=1&isMasterSupport=1&v=1"
vv = md5((pub + "&" + q.lower() + "&" + KEYS[ts % 8]).encode()).hexdigest()
url = "https://m10.yfsp.tv/v3/video/play?" + q + "&vv=" + vv + "&pub=" + pub
```

## 没验证的

- `verify` 和 `vendtime` 的确切有效期；
- 登录后非会员能拿到哪些档；VIP 档的地址形态（是否有 master、是否加密）；
- 国内出口拿到的 CDN 域名和校验规则；
- 真机 webview 实际发出的 `Origin` 值（按 Chromium 行为推断为 `null`，没上真机抓）；
- `code === 5` 人机验证的触发条件。
