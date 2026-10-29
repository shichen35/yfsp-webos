# yfsp.tv 数据接口调研

调研时间 2026-10-28，出口 IP 在美国，全程未登录。方法是两条线并行：在浏览器里打开首页、分类页、搜索页、排行页和播放页，用 Performance API 记下真实请求；同时读站点主包 `main.e501da686e2f4d234e63.js` 里的 `ApiUrlHelper`（接口表）和 `HttpClientHelper`（签名、拦截、错误处理）。文中的接口都用 curl / node 脱离浏览器、不带任何 cookie 复测过。客户端 IP 一律写成 `<client-ip>`。

播放地址的细节（广告项怎么排除、清晰度、m3u8 和分片的特征、为什么要本地代理）在 [video-source.md](video-source.md) 里写得更细，这里只列接口本身。

## 结论先说

- 接口是明文 JSON，没有 olevod 那种 AES 载荷，主包里也没有任何 AES / RSA / CryptoJS 代码。
- 绝大多数 GET 要带签名 `vv` + `pub`，不带回 `{"code":1,"msg":"用户签名错误"}`。算法是一次 MD5：`vv = md5(pub + "&" + 小写化的 query + "&" + privateKey)`，其中 query 要先按站点的 `get_query()` 把各参数值 URL 解码（见下文「签名」）。
- `pub` 可以直接用当前毫秒时间戳，私钥从一张写死的 8 项表里按 `pub % 8` 取，这是站点自己的兜底逻辑。网关不校验时间，前后偏一周的时间戳都能过，所以不依赖电视时钟，也不用先抓首页。`mvp/sign-check.mjs` 用 10 个浏览器抓到的真实请求验证了算法。
- 不需要 cookie、token、Referer。API 对任意 `Origin`（包括 `null`）都回显 `Access-Control-Allow-Origin` 并带 `Access-Control-Allow-Credentials: true`，浏览器开发不用代理。这是 curl 的结论，打包应用在真机 `file://` 下能否直接 `fetch` 还没验证（olevod 当年同样回 `ACAO: *`，真机却直连不通），见架构文档 Q4。
- 没遇到 Cloudflare 挑战页，API 也不挑 User-Agent（curl 默认 UA 可以）。但视频 CDN（`*.pipecdn.vip`）挑 UA 和 Origin：`curl/*`、`python-requests/*` 回 403，带了非 `https://www.yfsp.tv` 的 Origin 回 520。媒体必须走本地代理。
- 站点有一套人机验证兜底：任意接口返回 `code:5` 时，前端会跳 `/challenge` 页面做 Cloudflare Turnstile（备用 Google reCAPTCHA），过了再调 `ClearWatch` 解封。调研期间大约发了一百多个请求，没有触发过。电视上无法完成 Turnstile，触发了只能提示用户。
- 地区由服务器按 IP 判断，`region` 参数改成 `CN`、`GL.` 或不带，返回的播放地址都一样（里面写的是 IP 所在国）。中国大陆 IP 能否访问没法验证。
- 未登录只能拿到 576（标清），720 及以上全部 `isVIP:true`。

## 域名

主包里的域名都是模板 `https://xxx.{Host}/`，`{Host}` 取当前页面的主域名，也就是 `yfsp.tv`。`cinema` 是站点常量，国际版固定为 1，决定了下面这张映射：

| 主包里的端点名 | 实际地址 | 用途 |
| --- | --- | --- |
| `API_ENDPOINT` | `https://m10.yfsp.tv/api` | 列表、筛选、分类、用户 |
| `APIV3_ENDPOINT` / `APIV4_ENDPOINT` | `https://m10.yfsp.tv/v3` | 首页、详情、选集、播放、菜单 |
| `APIM10_ENDPOINT` | `https://m10.yfsp.tv/api` | 同 `API_ENDPOINT` |
| `RANK_ENDPOINT` | `https://rankv21.yfsp.tv/api` | 排行、相关推荐 |
| `APIV3RANK_ENDPOINT` | `https://rankv21.yfsp.tv/v3` | 搜索、热搜 |
| `PUBLIC_ENDPOINT` | `https://ppt.yfsp.tv` | 广告投放、点击统计，客户端不需要 |
| `NEWS_ENDPOINT` | `https://upload.yfsp.tv/api` | 用户上传的短视频（`/watch?v=`），不在范围内 |
| `WEBAPI_ENDPOINT` / `ANYGATE_*` | `w.anybound.vip`、`api.anybound.vip`、`c1.anybound.vip` | 播放计数、观看记录（登录后），不需要 |
| `LIVE_ENDPOINT` | `https://api.miolive.tv/api` | 直播推荐，不需要 |

`cinema=2` 时会换成 `api8.` / `api10.`，那是姊妹站 wuye.tv 的配置，和我们无关。

静态资源：

- 封面图在 `https://static.yfsp.tv/upload/video/*.gif|jpg`，扩展名是 `.gif` 的其实是单帧竖图（350 × 490）。支持 `?w=300&h=420&mode=crop` 服务端缩放，能把体积压小一些。没有防盗链，任意 Referer / Origin 都是 200，带 `Access-Control-Allow-Origin: *`。
- 轮播和广告图在 `https://pptstatic.yfsp.tv/upload/video/*`。
- 列表项的 `imgPath` 有时带 `s` 后缀（如 `…5588s.gif`），站点会把 `s.` 换成 `.` 取大图，小图版本有的已经 404，客户端照做即可。

## 通用约定

### 响应外层

```json
{"ret":200,"data":{"code":0,"msg":"","info":[ ... ]},"msg":""}
```

HTTP 状态码总是 200（签名错也是 200）。真正的结果在 `data`：`code` 为 0 才算成功，数据在 `data.info`，绝大多数接口的 `info` 是只有一项的数组，真正的对象是 `info[0]`。

`data.code` 的含义来自主包 `globalHandler()`：

| code | 站点的处理 | 客户端应对 |
| --- | --- | --- |
| 0 | 正常 | |
| 1 | 弹出 `msg`（如「用户签名错误」「视频不存在」） | 当业务错误抛出，不重试 |
| 2 | 「用户信息错误，请重新登录」，登出 | 只有登录态会遇到 |
| 3 | 「帐户在别处登录」，登出 | 同上 |
| 4 | 弹 prevent 对话框 | 记录日志，提示用户 |
| 5 | 跳 `/challenge?return=…&triggerindex={msg}` 做人机验证 | 提示用户稍后再试，停止自动重试 |

### 公共参数

- `cinema=1`：几乎所有接口的默认参数，带上。
- `v=1`：主包的 `appendApiVersion()` 会给 `m10 / rankv21 / ppt` 下 `/api/`、`/v3/` 开头的请求统一追加 `v=1`。它参与签名，要先拼 `v=1` 再算签名。
- `cacheable=1`：站点 `getWithCache()` 发的请求会带这个标记，而且这类请求不签名，服务端也放行（首页 `getAllVideo`、菜单 `MainMenuV3`、热搜、`getAllHotVideoTop`、`getCoBusiness`）。并不是加了 `cacheable=1` 就能免签：给 `list/Search` 加上它照样报签名错误。保险起见客户端一律签名，签名对这些接口也无害。

### Cookie 与登录态

匿名访问完全不需要 cookie。站点虽然用 `withCredentials:true` 发请求，但匿名时没有任何鉴权 cookie，只有 `dn_config`（`device=desktop&player=CkPlayer&tech=HLS&region=US&…` 这类偏好）和 GA 的 cookie。

登录后 `appendUserInfo()` 会把 token 对象的字段（主包里能看到的有 `uid`、`token`、`expire`、`gid`、`sign`）合进 query 一起签名。我们不登录，不展开。

## 签名

主包 `HttpClientHelper.uriSignature()` 的逻辑整理成伪代码：

```text
canonical(qs):              # qs 是 URL 里 ? 之后的部分（GET）或表单 body（POST）
  对每个 k=v（按 & 拆，保持原顺序）:
    v = decodeURIComponent(v)，再把 "+" 换成空格
  用 & 拼回 "k=v&k=v..."

vv  = md5_hex(pub + "&" + lower(canonical(qs)) + "&" + privateKey)
GET : url + "&vv=" + vv + "&pub=" + pub
POST: body + "&vv=" + vv + "&pub=" + pub        # URL 上的 query 不签
```

要点：

- 参数顺序就是发出去的顺序，不排序。
- 先解码再小写：中文值按 UTF-8 字符参与 MD5，视频 key 这种大小写混合的值也会被小写化（服务端同样处理）。
- query 已经带了 `vv=` 或 `pub=` 时站点不会重签。
- 空 query 时签的是空串（`md5(pub + "&&" + priv)`），实际接口都有参数，碰不到。

`pub` / `privateKey` 有两种来源，网关都认：

1. 时间戳模式（推荐）。`HttpClientHelper` 构造时如果页面上没有 `window.pConfig`，就令 `pub = String(Date.now())`，`privateKey = PRIV[pub % 8]`，其中

   ```js
   const PRIV = ['version001','vers1on001','vers1on00i','bersion001','vcrsion001','versi0n001','versio_001','version0o1'];
   ```

   这是站点首屏第一批请求实际在用的方式（`payment/getPaymentInfo?…&pub=1793248121136`）。实测时间戳前后偏一天、一周都能通过，网关不检查时效。

2. pConfig 模式。首页 HTML 内联了 `var injectJson = {"config":[{… "pConfig":{"publicKey":"CJSv…(130 字符)","privateKey":["SvCp…(20 字符)"]}}]}`，Angular 启动后 `shortCut(pConfig)` 把 `pub` 换成这个 `publicKey`，私钥取 `privateKey[0]`。每请求一次首页，这对 key 就换一次。三组样本都满足 `privateKey == publicKey[2:6] + publicKey[1:17]`，但这只是观察，不建议依赖；真要用这种模式就老老实实从 HTML 里解析。

选时间戳模式的理由：不用先抓首页 HTML，不依赖设备时钟，算法完全本地。风险是这条兜底路径哪天被服务端收紧，到时退回 pConfig 模式（多一次 `GET https://www.yfsp.tv/` 再用正则抠 `injectJson`）即可，签名函数本身不用改。

验证：`node mvp/sign-check.mjs` 用浏览器里抓到的 10 个真实请求（两种模式都有，含中文参数）复算 `vv`，全部一致；加 `--live` 会用时间戳模式真打两次 `list/Search`，其中一次带 `region=大陆`。

shell 里调试可以用这个函数（下文的 curl 例子都依赖它）：

```bash
# 用法：yfsp 'https://m10.yfsp.tv/api/list/Search?cinema=1&...&v=1'
yfsp() {
  curl -s "$(node -e '
    const c=require("crypto"),P=["version001","vers1on001","vers1on00i","bersion001","vcrsion001","versi0n001","versio_001","version0o1"];
    const u=process.argv[1],[b,q=""]=u.split("?"),ts=Date.now();
    const s=q.split("&").filter(Boolean).map(x=>{const[k,...v]=x.split("=");return k+"="+decodeURIComponent(v.join("=")).split("+").join(" ")}).join("&");
    console.log(u+"&vv="+c.createHash("md5").update(ts+"&"+s.toLowerCase()+"&"+P[ts%8]).digest("hex")+"&pub="+ts)' "$1")"
}
```

## 接口清单

客户端用得到的接口。「签名」一列是实测结果：「必需」表示不签会报「用户签名错误」。

| 用途 | 方法与地址 | 签名 |
| --- | --- | --- |
| 首页各频道推荐 | `GET m10/v3/home/getAllVideo` | 不需要 |
| 首页轮播 | `GET m10/v3/home/getflashbanner` | 必需 |
| 顶部频道菜单 | `GET m10/v3/list/MainMenuV3` | 不需要 |
| 各频道热播 Top10 | `GET rankv21/api/list/getAllHotVideoTop` | 不需要 |
| 频道下的类型（喜剧、爱情…） | `GET m10/api/list/AllVideoType` | 必需 |
| 筛选项（地区、语言、年份…） | `GET m10/v3/list/GetSearchCondition` | 必需 |
| 分类列表 + 筛选 + 分页 | `GET m10/api/list/Search` | 必需 |
| 关键字搜索 | `POST rankv21/v3/list/briefsearch` | 实测可不签 |
| 热搜词 | `GET rankv21/v3/list/gethotsearchlist` | 不需要 |
| 影片详情 | `GET m10/v3/video/detail` | 必需 |
| 选集列表 | `GET m10/v3/video/languagesplaylist` | 必需 |
| 播放地址 | `GET m10/v3/video/play` | 必需 |
| 排行榜（按频道 × 时段） | `GET rankv21/api/list/GetVideoRank` | 必需 |
| 相关推荐 | `GET rankv21/api/home/getRelativeVideo` | 必需 |
| 当前 IP 所在地区 | `GET m10/api/home/getmyregion` | 必需 |

主包接口表一共 240 项，其余是会员、商城、相册、动态、弹幕、评论、消息、支付等，电视端用不上。

### 首页：getAllVideo

```bash
curl -s 'https://m10.yfsp.tv/v3/home/getAllVideo?cinema=1&set=1&size=13&isTopic=1&v=1&cacheable=1'
```

`info[0]` 是一个对象，按频道分组：

| 字段 | 说明 |
| --- | --- |
| `filmList` / `tvList` / `varietyList` / `animeList` | 电影、电视剧、综艺、动漫，各 `size` 条（13） |
| `sportList` / `documentaryList` / `shortList` | 体育、纪录片、短剧，各 8 条 |
| `topicList` | 专题（合集），每项有 `key`、`imgs[]`、`filmCount` |
| `circleList` / `gameList` / `liveList` | 实测为空或 null |

每个影片项的字段（各列表、`list/Search` 结果通用）：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `key` | `7C9xxyLBFj6` | 影片 id，11 位，进详情、播放都用它 |
| `title` | 街头王国：奏响你的声音。 | |
| `image` | `https://static.yfsp.tv/upload/video/….gif` | 竖版封面 |
| `atypeName` | 电影 | 频道名 |
| `videoClassID` | `0,1,3,28` | 分类路径，前三段是频道 |
| `cid` / `cidMapper` | 剧情 | 类型 |
| `regional` / `lang` / `year` | 日本 / 日语 / 2026 | |
| `rating` | `6.0` | 评分（字符串） |
| `lastName` | `22`、`18集全`、空 | 更新进度，电影一般为空 |
| `isSerial` | false | 是否连载中 |
| `lastKey` | `jiJwRgQlcj5` | 最新一集的 key |
| `contxt` | 简介 | 注意：搜索接口里这个字段是影片 key，见下 |
| `hot` / `favoriteCount` / `comments` | | 热度类数字 |

### 首页轮播：getflashbanner

```bash
yfsp 'https://m10.yfsp.tv/v3/home/getflashbanner?cinema=1&region=US&cid=0,1&size=8&v=1'
```

不带 `region` 时 `info` 为空数组，要带上 `getmyregion` 拿到的 `regionCode`。首页 HTML 的 `injectJson` 里也内联了一份（键名 `slide-list_region_US_cid_0,1_size_8`）。

| 字段 | 说明 |
| --- | --- |
| `title` | 标题 |
| `image` / `img` | 横幅图，`pptstatic.yfsp.tv`，约 1903 × 666 |
| `listPath` | 影片 key，点击进 `/play/{listPath}` |
| `external` | true 表示是广告（`url` 指向 `ppt.yfsp.tv/c/c?…` 统计跳转），客户端应过滤 |
| `url` | 站内项是 `https://www.yfsp.tv/play/{key}` |

实测 8 条里第 1 条是广告，其余 7 条是影片。

### 频道菜单：MainMenuV3

```bash
curl -s 'https://m10.yfsp.tv/v3/list/MainMenuV3?cinema=1&cid=0,1&v=1&cacheable=1'
```

`info[0].channelList[]`：`label`（电影）、`path`（movie）、`category`（`0,1,3`）。视频频道的 `category` 就是 `list/Search` 要的 `cid`：

| 频道 | path | cid |
| --- | --- | --- |
| 电影 | movie | `0,1,3` |
| 电视剧 | drama | `0,1,4` |
| 综艺 | variety | `0,1,5` |
| 动漫 | anime | `0,1,6` |
| 短剧 | short | `0,1,8` |
| 体育 | /list/sport | `0,1,95` |
| 纪录片 | documentary | `0,1,7` |

后面的「新闻」「华人」「娱乐」等 `category` 不是数字路径，是用户上传区（`upload.yfsp.tv`），不做。

### 筛选项：AllVideoType + GetSearchCondition

类型（每个频道不同）：

```bash
yfsp 'https://m10.yfsp.tv/api/list/AllVideoType?cinema=1&cid=0,1,3&v=1'
```

`info` 是数组（电影 18 项），每项 `className`（喜剧）、`path`（`0,1,3,19`，用作 `list/Search` 的 `cid`）、`taxis`（排序）。

其余维度：

```bash
yfsp 'https://m10.yfsp.tv/v3/list/GetSearchCondition?version=1&v=1'
```

`info[0].conditions` 按维度给出选项，每项 `{title, link}`，`link` 是要传给 `list/Search` 的值：

| 维度 | 选项 | `list/Search` 参数 |
| --- | --- | --- |
| `region` | 大陆、香港、台湾…（9 项） | `region=大陆` |
| `language` | 国语、粤语、英语…（11 项） | `language=国语` |
| `year` | 今年、去年、更早…（6 项，实测 `year=今年` 可用） | `year=今年` |
| `vipResource` | 4K、1080P、900P、720P | `vipResource=4K` |
| `isSerial` | 全部 -1 / 全集 0 / 连载中 1 | `isserial=` |
| `isVertical` | 全部 -1 / 横屏 0 / 竖屏 1 | `isVertical=` |

`info[0].orders[]` 规定了每个频道显示哪些维度、按什么顺序（如电影是 类型、地区、语言、年份、画质、状态）。

### 分类列表：list/Search

```bash
yfsp 'https://m10.yfsp.tv/api/list/Search?cinema=1&page=1&size=36&orderby=0&desc=1&cid=0,1,4&region=%E5%A4%A7%E9%99%86&isserial=-1&isIndex=-1&isfree=-1&isVertical=-1&v=1'
```

| 参数 | 说明 |
| --- | --- |
| `cid` | 频道或类型路径，`0,1,4` 或 `0,1,4,132` |
| `page` / `size` | 从 1 开始；网页用 36，实测 `size=100` 也行 |
| `orderby` | 0 添加时间、1 更新时间、2 人气、3 评分（网页上的四个排序按钮） |
| `desc` | 1 降序 |
| `region` / `language` / `year` / `vipResource` / `label` | 筛选，中文值要 URL 编码；签名按解码后的值算 |
| `isserial` / `isIndex` / `isfree` / `isVertical` | -1 表示不限 |

返回 `info[0]`：`recordcount`（总条数）、`maxpage`、`result[]`（影片项，字段同首页）。

注意 `maxpage` 封顶 30：电影频道 13850 条，`page=31` 起返回空。想翻得深就加大 `size`，或者靠筛选缩小范围。

### 搜索：briefsearch

```bash
curl -s -X POST -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'tags=%E7%B9%81%E8%8A%B1' \
  'https://rankv21.yfsp.tv/v3/list/briefsearch?tags=%E7%B9%81%E8%8A%B1&orderby=4&page=1&size=36&desc=1&isserial=-1&v=1'
```

站点的做法是关键字同时放在 URL 和 body 里，按 POST 规则签 body（`tags=繁花&vv=…&pub=…`），URL 不签。实测 body 不签名也返回同样结果，客户端还是照站点的方式签上。网页上会同时发两次：不带 `cinema` 的是影视，`cinema=3&cid=0,3` 的是用户上传视频，我们只要前者。

URL 参数：`orderby`（站点默认 4，含义未细究，按相关度）、`page`、`size`、`desc`、`isserial`，还可以加 `cid`、`year`、`language`、`region`、`star`、`director`。

返回 `info[0]`：`recordcount`、`firstCID`、`result[]`。结果项和列表项字段不一样，要单独映射：

| 字段 | 说明 |
| --- | --- |
| `contxt` | 影片 key（站点 `transformFromList` 里写的是 `key: t.key \|\| t.contxt`） |
| `title` / `atypeName` / `regional` / `lang` / `score` / `lastName` | 同列表 |
| `imgPath` | 封面，可能带 `s` 后缀，按站点做法 `replace("s.", ".")` |
| `starring` / `directed` | 演员、导演 |
| `languagesPlayList.playList[]` | 直接带了选集列表，结构同 `languagesplaylist` |

没有输入联想接口。站点的「搜索建议」(`getSearchSuggestList`) 其实就是热搜：

```bash
curl -s 'https://rankv21.yfsp.tv/v3/list/gethotsearchlist?cinema=1&size=10&v=1&cacheable=1'
```

`info` 是两组数组，每项 `title`（热搜词）、`num`（热度），第一组是影视。

### 详情：video/detail

```bash
yfsp 'https://m10.yfsp.tv/v3/video/detail?cinema=1&device=1&player=CkPlayer&tech=HLS&country=HU&lang=cns&v=1&id=uHcU4Clu390&region=US'
```

参数照抄站点即可，`id` 是影片 key。`info[0]` 关键字段：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `id` | 50365 | 数字 id，`getRelativeVideo` 要用 |
| `key` | `uHcU4Clu390` | |
| `title` / `contxt` | 美人余 / 简介 | |
| `imgPath` | 封面 | |
| `channel` / `cidMapper` / `cid` | 电视剧 / 都市,家庭,爱情 / `0,1,4,132` | `cid` 用于选集和相关推荐 |
| `regional` / `language` / `post_Year` | 大陆 / 国语 / 2026 | |
| `stars[]` / `directors[]` | 演员、导演 | |
| `score` | `8.1` | |
| `serialCount` / `lastName` / `isSerial` | 28 / 28集全 / false | |
| `source` / `vipSource` | 576 / 2160 | 免费最高清晰度 / VIP 最高清晰度 |
| `view` / `favoriteCount` / `comments` | | |
| `playRecordURL` | `w.anybound.vip/api/Counter/PlusOne?token=…` | 播放计数，客户端不调 |
| `extraList[]` | | 详情页广告位，忽略 |

### 选集：languagesplaylist

```bash
yfsp 'https://m10.yfsp.tv/v3/video/languagesplaylist?cinema=1&vid=uHcU4Clu390&lsk=1&taxis=0&cid=0,1,4,132&v=1'
```

`info[0]`：`pageSize`（50）、`playListType`、`playList[]`。`lsk` 的含义没查清：抽了 24 部粤语片，`lsk=1` 和 `lsk=0` 下 `info` 都只有一项。语言版本在站点上有两种放法：单独成片（「新闻女王(粤)」），或者作为同一部片里的不同剧集（《叶问3》的 `playList` 是「1(国语)」「1(粤语)」两项）。每集：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `key` | `on7Hba8mDqA` | 剧集 key，传给 `video/play` 的 `id`（`a=0`） |
| `name` | `01`，电影是 `1080P` | 显示名 |
| `id` | 1611513 | |
| `isVip` / `isBought` | false | |
| `updateDate` | | |

不分页：《海贼王》（`Jov3Yy1Hm6G`）1182 项一次全部返回（1176 个单集编号、两个合并项 `0268-0269` 和 `0277-0278`、SP01 到 SP04），`pageSize:50` 只是网页上每个选集标签页放 50 集。

`taxis` 影响顺序。短剧集两种取值都是 01、02… 正序；长剧集 `taxis=0` 的顺序是乱的（以 0801 开头，中间 0292 后面直接跳 0351），`taxis=1` 才是干净的 0001…1180、SP01…SP04（编号 268/269、277/278 各合并成一项，所以总数是 1182 而不是 1184）。客户端用 `taxis=1`，或者拿到后自己按 `name` 排。

### 播放：video/play

```bash
# 默认集：id 用影片 key，a=1
yfsp 'https://m10.yfsp.tv/v3/video/play?cinema=1&id=uHcU4Clu390&a=1&lang=none&usersign=1&region=US&device=1&isMasterSupport=1&v=1'
# 指定集：id 用剧集 key，a=0
yfsp 'https://m10.yfsp.tv/v3/video/play?cinema=1&id=kBI2X7hTHj2&a=0&lang=none&usersign=1&region=US&device=1&isMasterSupport=1&v=1'
```

`a` 和 `id` 搭配错了会返回 `{"code":1,"msg":"视频不存在"}`。电影也一样：影片 key 配 `a=1`，或从选集列表拿唯一一集的 key 配 `a=0`。

`info[0]` 里客户端关心的：

| 字段 | 说明 |
| --- | --- |
| `clarity[]` | 清晰度，`title`（2160/1080/720/576）、`description`（4K/蓝光/高清/标清）、`isVIP`、`isEnabled`、`key`；只有可播那档 `path` 非空，`path.result` 就是 m3u8 |
| `flvPathList[]` | 实测两项：第一项是 20 秒前贴片广告（`isHls:false`、`link` 指向 `ppt.yfsp.tv`），第二项是正片（`isHls:true`、`link:null`） |
| `mediaKey` / `mediaTitle` | 实际播的那一集 |
| `customData.t` | 时长（秒） |
| `needLogin` / `isPreView` / `isLimitedStream` | 样本里都是 0 / false |

取正片：`clarity.find(c => c.isEnabled && c.path)?.path.result`，兜底 `flvPathList.find(p => p.isHls && !p.link)?.result`。请求 VIP 档的 key 不报错，但会退回 576。

m3u8 形如 `https://exchange-xxx.pipecdn.vip/{长路径}/chunklist.m3u8?vendtime={10 位秒}&vhash=…&vCustomParameter=0_<client-ip>_US_1_0_1_0&lb=…&us=1`：

- `vendtime` 比当前时间晚 48 小时，是地址有效期。
- `vCustomParameter` 里写着请求接口时的客户端 IP 和国家，大概率绑定 IP。电视自己请求接口、自己拉流，不受影响；但别在开发机上取了地址再丢给另一个出口的设备。
- 站点的 hls.js 会给 m3u8 地址再追加 `&vv=…&pub=…`，CDN 不检查，不带也是 200。
- 分片是相对路径 `media_N.ts?…&verify={秒}-{签名}`，无 `#EXT-X-KEY`。

CDN 的请求头要求（实测）：

| 条件 | 结果 |
| --- | --- |
| 不带 Origin，UA 为空 / `Mozilla/5.0` / `node` / webOS UA | 200 |
| UA 是 `curl/*` 或 `python-requests/*` | 403（Cloudflare「Attention Required」页） |
| 带 `Origin: https://www.yfsp.tv` | 200，`Access-Control-Allow-Origin: *` |
| 带 `Origin: null`、`file://`、`http://localhost:5173`、`http://127.0.0.1:7654` | 520 |
| 不带 Referer | 200（不需要 Referer） |
| `Range: bytes=0-1023` | 206，带 `Content-Range` |

所以电视上 hls.js 从 `file://` 发的 XHR 一定带 `Origin: null`，直连必然 520；浏览器开发时 `localhost` 的 Origin 也是 520。媒体要走本地代理，代理出站时不发 Origin（或者写成 `https://www.yfsp.tv`），UA 不要用 curl。

### 排行：GetVideoRank / getAllHotVideoTop

完整排行榜（`/rank` 页）：

```bash
yfsp 'https://rankv21.yfsp.tv/api/list/GetVideoRank?key=All&cinema=1&v=1'
```

`info` 是对象，键是 `false_{cid}`（`false_0,1,3` 电影、`false_0,1,4` 电视剧、`false_0,1,5` 综艺、`false_0,1,6` 动漫），每个下面有 `hour` / `day` / `week` / `month` / `year` 五个时段，各 50 条。条目字段：`contxt`（影片 key）、`title`、`imgPath`（相对路径 `/upload/video/…`，前面拼 `https://static.yfsp.tv`）、`cid`、`regional`、`lang`、`viPsource` 等。

首页右侧的各频道 Top10：

```bash
curl -s 'https://rankv21.yfsp.tv/api/list/getAllHotVideoTop?cinema=1&pageSize=10&v=1&cacheable=1'
```

`info[]` 每项 `{cid, rankList[]}`，条目里影片 key 在 `link`，另有 `title`、`score`、`regional`、`updVname`（如 2160p）。没有封面图。

### 相关推荐：getRelativeVideo

```bash
yfsp 'https://rankv21.yfsp.tv/api/home/getRelativeVideo?cinema=1&cid=0,1,4,132&title=%E7%BE%8E%E4%BA%BA%E4%BD%99&size=10&set=1&id=50365&v=1'
```

`cid`、`title`、`id`（数字 id）都来自 `video/detail`。`info` 是影片数组，字段和搜索结果一样：影片 key 在 `contxt`，封面 `imgPath` 带 `s` 后缀。

### 地区：getmyregion

```bash
yfsp 'https://m10.yfsp.tv/api/home/getmyregion?cinema=1&v=1'
```

`info[0]`：`regionCode`（US）、`regionName`（美国）、`ipCountry`。首页 HTML 的 `injectJson["switch-region"]` 里也有同样内容。轮播要用 `regionCode`。

## 登录（只记录流程，没有登录）

- 登录框是 `DNA-3.0.0.9.js` 生成的 iframe，指向 `https://account.yfsp.tv/Auth/Login`，一个服务端渲染的 ASP.NET 表单：`POST /Auth/Login`，字段 `Email`（邮箱/帐号）或 `AreaCode` + `PhoneNumber`、`UserPass`、`RememberStatus`，另有隐藏字段 `requirecode`（初始为 0，推测失败几次后要求验证码）。
- 登录成功后靠 `account.yfsp.tv` 的 cookie 做 SSO，主站再通过 `user/UserAutoLogin`、`user/getusertoken` 拿到 token 对象，之后所有请求都把 `uid`、`token` 等字段合进 query 签名。
- 人机验证不在登录表单里，而在全局：接口返回 `code:5` 时进入 `/challenge`，按首页 `injectJson.config[0].authConfig`（`provider: "CLOUDFLARE"`，Turnstile sitekey `0x4AAAAAACCL7s2rRZySToUJ`）渲染 Turnstile，用户通过后 `POST m10/api/home/ClearWatch`，body 为 `captchaKey={token}&publicKey={sitekey}`。
- 电视端要做登录的话，需要把账号密码表单搬到电视上，依赖 `account.yfsp.tv` 的 cookie 流程；`file://` 下 cookie 行为不确定，DNA 库里也有 `IsFileSystem` 分支专门处理。登录后非会员能否拿到 720 无法验证，MVP 不做登录。

## 不需要的东西

- `ppt.yfsp.tv/play/o`、`getCoBusiness`、`payment/getPaymentInfo`：广告、合作商、会员价格。
- `video/getBarrage`、`video/commentList`、`video/GetRatingList`、`video/RelativeTopicList`：弹幕、评论、评分分布、相关专题。
- `w.anybound.vip/api/Counter/PlusOne`：播放计数。

## 没验证的

- 中国大陆和其他国家 IP 下的表现，以及 m3u8 是否真的绑定 IP。
- 高频请求多久会触发 `code:5`。
- briefsearch 的 `orderby` 各取值的确切含义，`taxis=0` 在长剧集上为什么乱序。
