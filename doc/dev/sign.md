# 签名与请求信封

网关的响应是明文 JSON，没有载荷加密，所以这一层只有签名和信封两件事。代码在 `app/src/source/yfspSign.js` 和 `yfspHttp.js`。

## 签名

算法从站点主包的 `uriSignature()` 整理而来：

```text
canonical(qs) = 按 & 拆开，值做 decodeURIComponent、把 + 换成空格，按原顺序拼回
vv            = md5_hex(pub + "&" + lower(canonical(qs)) + "&" + privateKey)
GET  : url + "&vv=" + vv + "&pub=" + pub
POST : body + "&vv=" + vv + "&pub=" + pub   （URL 上的 query 原样发送，不签）
```

- `pub` 用当前毫秒时间戳，`privateKey` 从站点内置的 8 项表里按 `pub % 8` 取。这是站点自己的兜底模式，网关不校验时效（前后偏一周都能过），所以不用先抓首页，也不依赖电视时钟。
- 一定要先规范化再签：直接对百分号编码的原始 query 签名，所有带中文参数的请求（`region=大陆`、搜索词）都会报「用户签名错误」。
- 参数按发出的顺序签，不排序。
- 浏览器里没有原生 MD5，`yfspSign.js` 自带一份纯 JS 实现。
- `yfspSign.test.js` 里有 10 个从浏览器抓到的真实请求做向量，覆盖时间戳模式、首页 `pConfig` 模式和中文参数。

备用方案是解析首页 HTML 里内联的 `pConfig`（每次请求首页都会换），签名函数不用改，只换 `pub` 和 `privateKey` 的来源。等兜底模式真被收紧再加。

## 请求信封

`apiGet(host, path, params)` / `apiPost(host, path, query, form)`：

- 主机：`HOST.m10`（列表、详情、选集、播放）和 `HOST.rank`（排行、搜索、热搜）。
- 参数用对象按站点的顺序写，`buildQuery()` 拼成 query：值做 URL 编码，逗号保持原样（站点发的就是 `cid=0,1,4`）。信封统一在末尾追加 `v=1` 再签名；`cinema=1` 不由信封追加，各业务函数照站点的参数写，因为搜索和筛选项接口恰好不带。
- 响应外层是 `{ ret: 200, data: { code, msg, info } }`，HTTP 总是 200。`data.code === 0` 才算成功，返回 `data.info`。
- 非 0 抛 `ApiError(msg, code)`：code 1 是业务错误（签名错、视频不存在），code 4 是站点会弹 prevent 对话框的情况，都用服务端的 `msg` 作文案、不重试。code 5 表示网关要求 Cloudflare Turnstile 人机验证，电视上过不了：文案固定为「访问受限，请稍后再试」，并置一个全局标志 `isChallenged()`，之后的后台预取全部停止。
- GET 每次 3 秒超时，最多 3 次，每次重新签名；`ApiError` 不重试。POST 8 秒、不重试。
