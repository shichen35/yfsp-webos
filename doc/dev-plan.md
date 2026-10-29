# 开发计划

按里程碑拆成小任务，每个任务对应一次提交（单行 Conventional Commit），提交后 `app/` 下 `npm run build` 和 `node --test` 都要通过。界面改动由用户在模拟器里手测（`npm run sim`）。

要注意 `npm run sim` 启动的是 webOS 26 模拟器（`ares-launch -s 26`），内核比目标的 Chromium 108 新，日常手测发现不了旧内核的兼容问题。平时只靠 Vite 的 `target: chrome108` 和 `index.css` 的硬约束（不用 `color-mix` 等）来保证，M3 播放打通后有一个检查点（M3-4）专门在 webOS 24 模拟器或真机上跑一遍。

设计依据是 [架构概览](architecture.md)。任务后面标了它依赖的决策（D1–D11）和开发中验证的问题（Q1–Q10），编号对应架构文档第 13 节。标了 D 的任务要等用户拍板后才能动；标了 Q 的任务可以先做，但完成标准里包含对那个问题的验证，结果写回架构文档。

拷贝 olevod 文件时一律把 `olevod` 前缀、服务名、日志路径改成 `yfsp`，文件清单见 [olevod 复用地图](research/olevod-reuse.md) 第五节，下文不再重复列每个文件名。复用地图里标「原样」的文件不一定能单独编译：olevod 的模块之间有 import 链（`store/filters.js` 要 taxonomy 的 `DEFAULT_LETTER`，`Thumb.jsx` 要 `api/olevod.js` 的 `imageUrl`，`App.jsx` 要 `store/session.js` 和 `api/feeds.js`），M0 用占位导出和桩把链条接上，到对应任务再换成真的。

## M0 工程骨架

目标：一个能在模拟器里启动、标签栏可以用方向键切换的空壳，数据全是占位。

### M0-1 仓库基础文件

- 文件：`.gitignore`、`LICENSE`、`THIRD_PARTY_NOTICES.md`（拷 olevod）。
- 完成标准：`git status` 里看不到 `node_modules`、`dist`、`out`；调研资料按 D11 处理（删掉或裁掉 `doc/research/img/home-top.jpg`）。
- 依赖：D11。

### M0-2 前端工程

- 文件：`app/package.json`、`app/vite.config.js`、`app/index.html`、`app/src/main.jsx`、`app/src/App.jsx`（只渲染背景和一行字）、`app/src/styles/index.css`、`app/webos-meta/appinfo.json`、占位图标。
- 要点：`appinfo.json` 的 id 是 `com.yfsp.app`；`index.css` 拷 olevod 后把颜色令牌换成架构文档第 11 节的值，焦点描边改成主色。
- 完成标准：`npm install && npm run build` 通过；`npm run sim` 打开是 `#090b21` 背景的空页面。
- 依赖：D9、D10（title 可先写占位，M5 再定）。

### M0-3 hooks 与 store

- 文件：`app/src/hooks/*`、`app/src/store/` 下除 `session.js`、`vault.js` 以外的全部文件和测试、`app/src/config/taxonomy.js`（占位）。
- 要点：`store/filters.js` import 了 taxonomy 的 `DEFAULT_SORT`、`DEFAULT_LETTER`，所以 taxonomy 在这里先建：七个频道的 id、名称、`cid`，导出形状和 olevod 一致（`CATEGORIES`、`SORTS`、`LETTERS`、`DEFAULT_SORT`、`DEFAULT_LETTER`、`getCategory`），每个分类的 `genres` / `areas` / `years` 先给空数组。`filters.js` 原样拷，M2-3 再换维度。
- 完成标准：`node --test` 全部通过（含 `filters.test.js`）；存储键前缀是 `yfsp:`。

### M0-4 组件

- 文件：`app/src/components/*`（`Thumb.jsx`、`FilterPanel.jsx`、`FilterBar.jsx`、`VideoCard.jsx`、`KeyboardPanel.jsx` 先原样拷，M2 再改）、`app/src/source/index.js`（桩）。
- 要点：`Thumb.jsx` 的 `import { imageUrl } from '../api/olevod.js'` 改成从 `source/index.js` 引，桩里的 `imageUrl` 原样返回 `pic`，M1-5 换成真的。`FilterPanel` / `FilterBar` 要的 `LETTERS`、`DEFAULT_LETTER` 由 M0-3 的占位 taxonomy 提供。
- 完成标准：`npm run build` 通过。Vite 不打包没被引用的模块，所以这一步的 build 其实验证不了组件，真正的检查在 M0-5：页面引用 `CardGrid → VideoCard → Thumb`、`App.jsx` 引用 `FilterPanel` 后 build 仍要通过。

### M0-5 标签栏与页面壳

- 文件：`config/nav.js` 及测试、`App.jsx`（视图栈和返回链，去掉账号帧）、`app/src/api/feeds.js`（桩）、`pages/{FavoritesPage,HistoryPage,SettingsPage}.jsx`，首页、分类、搜索先放占位组件。
- 要点：taxonomy 的 `getCategory` 改成字符串 id；`TABS` 删掉账号。`App.jsx` 删掉 `store/session.js` 的 import 和 `sessionStore` 的用法；它还 import 了 `api/feeds.js` 的 `prefetchAll`，先放一个只导出空 `prefetchAll` 的桩，M1-8 换成真的。
- 完成标准：模拟器里方向键能在标签间切换，收藏、历史、设置页能进出，返回键在标签栏上退出应用；`nav.test.js` 通过。
- 依赖：D3（是否预留「排行」标签，不定就先不加）。

## M1 数据层与 Luna 服务

目标：不经过界面，在 Node 里就能走通「列表、详情、取址、经代理拉到分片」整条链路，逻辑全部进正式代码，`mvp/` 可以删掉。

### M1-1 签名

- 文件：`app/src/source/yfspSign.js`、`yfspSign.test.js`。
- 要点：md5 拷 olevod `sign.js`；测试向量用 `mvp/sign-check.mjs` 里的 10 组浏览器真实请求（含中文参数、两种密钥模式）。
- 完成标准：10 组向量全部一致。

### M1-2 传输层

- 文件：`app/src/api/luna.js`。
- 要点：`SERVICE` 改成 `com.yfsp.app.service`；`transportGet` / `transportPost` 保留 olevod 的分层，`isTV && serviceReady` 时走 Luna `fetch`，失败或其他环境直连（POST 用 `application/x-www-form-urlencoded`，属于简单请求，没有预检）；去掉 `initTvEnv()` 开头的 `if (!isTV) return`，Luna 握手失败后再试一次 `http://127.0.0.1:7654/ping`；`mediaUrl()` 去掉 `isTV` 前置条件，拿到代理端口就改写地址。
- 完成标准：build 通过；浏览器里控制台能看到当前是哪种模式（Luna、直连加 HTTP 代理、直连无代理）。
- 依赖：D2。

### M1-3 请求信封

- 文件：`app/src/source/yfspHttp.js`、`yfspHttp.test.js`。
- 要点：主机常量（`m10`、`rankv21`）、追加 `v=1` 后签名（`cinema` 不由信封追加，业务函数照站点参数写，影视搜索和 `GetSearchCondition` 本来就不带）、解包 `data.info`、`ApiError(msg, code)`、GET 超时重试和每次重签、POST 不重试；code 4 按通用 `ApiError`、用 `msg` 作文案；code 5 置一个全局标志，之后的预取直接停。
- 完成标准：单测覆盖成功、code 1、code 4、code 5、HTTP 错误五种响应（用脱敏后的 JSON 夹具）；签名用例含中文参数。

### M1-4 本地媒体代理

- 文件：`service/com.yfsp.app.service/{service.js,package.json,services.json}`，`app/package.json` 加 `proxy` 脚本（`node ../service/com.yfsp.app.service/service.js`）。
- 要点：骨架拷 olevod，按架构文档第 3 节改出站头和媒体白名单（按解析后的 `hostname` 校验、拒绝 userinfo）；Luna `fetch` 保留，接口白名单换成 `m10.yfsp.tv`、`rankv21.yfsp.tv`；HTTP 增加 `GET /ping` 返回端口，响应带 `Access-Control-Allow-Origin: *`（开发页面在 `localhost:5173`，跨源读它需要）；没有 `webos-service` 模块时只启动代理，固定 7654。
- 完成标准：`npm run proxy` 后，用 curl 经代理拿到 m3u8 和首个分片（首字节 `0x47`），m3u8 地址先用 `mvp/probe.cjs` 取；白名单外的 host 和 `/proxy/pipecdn.vip:x@example.com/` 都返回 403；带 `Range` 的请求返回 206 且有 `Content-Range`；浏览器里 `fetch('http://127.0.0.1:7654/ping')` 能读到端口；用这个代理（不带 Referer、m3u8 不改写）配 hls.js light 在浏览器里实际播一段，`currentTime` 前进。
- 依赖：D2、D8。

### M1-5 适配器：详情与取址

- 文件：`app/src/source/{index.js,yfsp.js}`、`yfsp.test.js`（归一化测试，夹具取自调研时的响应，去掉 IP 和令牌）。
- 内容：`detail`（`video/detail` 加 `languagesplaylist?taxis=1`）、`resolveStream`、`imageUrl`、`toSummary`。
- 要点：选集只取 `info[0]`（Q10）；Summary 带 `uhd`（`vipResource` 为 `4K` 或 `2K`）。
- 完成标准：《美人余》（`uHcU4Clu390`）和《海贼王》（`Jov3Yy1Hm6G`，1182 项，SP01–SP04 排在 1180 之后）的剧集 `index` 连续、数组新的在前；剧集 key 配 `a=0` 能取到第 1 集和最后一集的地址；VIP 集抛出的 `ApiError` 文案正确。
- 依赖：D4；验证 Q8、Q10。

### M1-6 适配器：列表、首页、搜索、排行

- 文件：`app/src/source/yfsp.js`、`yfsp.test.js`。
- 内容：`categoryList`、`homeShelves`、`homeBanners`（先取 `getmyregion`，过滤 `external`）、`searchHotKeywords`、`searchList`、`rankList`。
- 完成标准：各函数用夹具测试归一化；实际请求一次 `orderby=0` 和 `orderby=1`，按返回条目的日期确认含义；试一次拼音首字母搜索（如 `qyn`）看 `briefsearch` 能不能命中。
- 验证：Q1、Q7。

### M1-7 冒烟脚本，删除 mvp

- 文件：`app/scripts/smoke.mjs`（新增）、删除 `mvp/`。
- 内容：在 Node 里直接 import 适配器：取电影列表第一部，取详情、取址，经本地代理拉 m3u8 和首个分片，检查首字节是 `0x47`。
- 完成标准：`npm run proxy` 开着时 `node scripts/smoke.mjs` 全部通过。
- 依赖：D11。

### M1-8 缓存与预取

- 文件：`app/src/api/feeds.js`。
- 要点：替换 M0-5 的桩；import 改成 `source/index.js`，删掉 olevod 对 `store/session.js` 的 import 和按会话刷新的那段；`POPULAR` 换成 `homeShelves()`；`loadDetail` 缓存不变；预取保持顺序执行，遇到 code 5 标志立即停止。
- 完成标准：build 和测试通过。

## M2 首页、分类、搜索

### M2-1 卡片与封面

- 文件：`components/Thumb.jsx`、`components/VideoCard.jsx`。
- 要点：`Thumb` 去掉 olevod 的缩略图后缀、`picThumb` 判定和拉伸检测，按卡片尺寸调 `imageUrl(pic, w, h)`，保留加载失败的占位；`VideoCard` 的 4K 角标从匹配 `remarks` 改成读 `uhd`，不再传 `picThumb`；「新」角标等 Q9，查不到来源就不做。
- 完成标准：模拟器里卡片封面清晰、加载失败时显示占位块，`vipResource` 为 4K 的片有 4K 角标。
- 验证：Q9。

### M2-2 首页

- 文件：`pages/HomePage.jsx`。
- 内容：轮播、继续观看、我的收藏、五个频道货架；按 D3 决定是否加「热播榜」货架。
- 完成标准：模拟器里首页数据完整，轮播里没有广告帧，返回标签栏再按确认能刷新。
- 依赖：D3。

### M2-3 分类筛选数据

- 文件：`config/taxonomy.js`、`store/filters.js` 及测试。
- 要点：从 `AllVideoType` 和 `GetSearchCondition` 抓一次数据冻结进 taxonomy（抓取用一次性脚本，不进仓库），每个分类带 `panelFilters` 和排序项；`DEFAULT_FILTER` 换成新维度，去掉 `letter`。`LETTERS`、`DEFAULT_LETTER` 这两个导出先留着，`FilterPanel` / `FilterBar` 还在引用，M2-4 改完组件再删，保证每次提交都能 build。
- 完成标准：`filters.test.js` 通过，build 通过。
- 依赖：D6。

### M2-4 筛选面板与分类页

- 文件：`components/FilterPanel.jsx`、`components/FilterBar.jsx`、`pages/CategoryPage.jsx`。
- 要点：FilterPanel 去掉写死的首字母组，改成遍历 `cfg.panelFilters`；FilterBar 去掉 `DEFAULT_LETTER` 和「首字母 X」摘要，按 `cfg.panelFilters` 拼摘要；然后从 taxonomy 删掉 `LETTERS`、`DEFAULT_LETTER`；CategoryPage 的加载结束条件加上 `maxpage`。
- 完成标准：每个频道的筛选维度和网页一致（体育没有类型行，短剧有横竖屏）；列表滚到第 30 页后不再请求。
- 依赖：D6；排序文案依赖 Q1 的结论。

### M2-5 搜索

- 文件：`pages/SearchPage.jsx`、`components/KeyboardPanel.jsx`（占位「输入片名或拼音首字母」和底部提示写死了拼音首字母，按 D5 / Q7 的结论改文案）。
- 内容：热门搜索、最近搜索、结果网格；按 D5 决定联想的做法。
- 完成标准：模拟器里能输入关键词、选热词搜索，结果只有影视。
- 依赖：D5；验证 Q7 后的结论决定键盘默认模式。

### M2-6 排行页（可选）

- 文件：`pages/RankPage.jsx`（新增）、`config/nav.js`。
- 内容：左侧四个榜，右侧带名次的海报网格，周、月、年切换。
- 完成标准：模拟器里四个榜和三个时段都能切换，进详情再返回焦点留在原处。
- 依赖：D3，只有选了独立标签页才做。

## M3 详情与播放

### M3-1 详情页

- 文件：`pages/DetailPage.jsx`、`components/SynopsisDialog.jsx`（如需）。
- 要点：去掉 `title/rating/region` 到摘要的手写映射，改用 `toSummary`；加热度和语言标签；VIP 集显示锁标，确认时提示；去掉登录对话框和 `userInfo()` 判断；收藏按钮接 `favorites`。
- 完成标准：《海贼王》1182 项分段正常（最后一组含 SP01–SP04）、默认定位到上次看的那一组；电影不显示选集；VIP 集按确认只出提示。
- 依赖：D1、D4；文案依赖 Q8。

### M3-2 播放器取源

- 文件：`player/PlayerPage.jsx`。
- 要点：同步读 `ep.url` 改成 `await resolveStream(id, ep)` 再 `createPlayback`；`ApiError` 映射到错误文案（含 code 5 的访问受限）；`recordHistory` 改用 `toSummary`；画质卡片显示 `label`；去掉登录分支。
- 完成标准：模拟器（或浏览器）里经代理播放、续播提示、最后 30 秒「即将播放」和自动下一集都正常。
- 依赖：D1、D7；Q3 不通时在浏览器里验证播放，并在架构文档里注明。

### M3-3 令牌过期恢复

- 文件：`player/PlayerPage.jsx`、`player/playbackSession.js` 及测试。
- 要点：olevod 的 `playbackSession` 把致命错误压成 `network` / `decode` / `source`，不带状态码，先让错误回调带出 hls.js 的 `response.code`；`fragLoadError` 且状态码 403 时回调页面重新取址，`loadSource` 新地址并 seek 回当前位置；连续两次 403 才报错。
- 完成标准：单测模拟 403 走到重新取址；手测可以把代理临时改成对分片回 403 来触发。
- 验证：Q5（暂停 30 分钟以上再继续，记录是否触发）。

### M3-4 旧内核检查点

不对应提交。在 webOS 24 模拟器（`ares-launch -s 24`，没装就先装）或真机上跑一遍：标签切换、分类筛选、详情选集、经代理播放、返回键。目的是在 M4 之前就发现 Chromium 108 上的样式和语法问题，以及真机 webview 直连接口的表现，而不是拖到 M5-4。

- 完成标准：上述流程在旧内核上正常，发现的问题记进架构文档第 13 节。
- 验证：Q4（能上真机时）。

## M4 收藏、历史、设置

### M4-1 收藏与历史

- 文件：`pages/FavoritesPage.jsx`、`pages/HistoryPage.jsx`、`store/history.js`。
- 要点：条目统一是 `Summary`（加 `watch`、`updatedAt`），确认从详情和播放器写进来的字段一致。
- 完成标准：收藏、取消收藏、历史续播、管理删除、清空都正常。

### M4-2 设置

- 文件：`pages/SettingsPage.jsx`、`components/TabOrderDialog.jsx`。
- 要点：标签顺序对话框能放下新的标签数量（多了体育、纪录片，可能还有排行）；首页显示项里加上 D3 定下的货架开关；去掉账号相关项。
- 完成标准：调整标签顺序和显隐后重启仍然生效，默认标签不用滚动就能看全。
- 依赖：D3。

## M5 打包与发布

### M5-1 打包脚本与图标

- 文件：`build.sh`、`app/webos-meta/{appinfo.json,icon.png,largeIcon.png}`。
- 要点：`build.sh` 换掉三处服务路径和默认仓库名；图标是 80×80 和 130×130 的真 PNG，自己画，不用站点 logo。
- 完成标准：`bash build.sh` 产出 `out/com.yfsp.app_<ver>_all.ipk`，`ares-package` 不报错。
- 依赖：D10。

### M5-2 开发文档

- 文件：`doc/development.md`、`doc/install.md`、`doc/dev/{focus-engine,storage,player,packaging}.md`（从 olevod 改写）、`doc/dev/data-channel.md`、`doc/dev/sign.md`（新写）。
- 要点：写清楚开发时要先 `npm run proxy`；把 Q1–Q10 的验证结论并入对应文档，`architecture.md` 第 13 节同步更新。
- 完成标准：文档里的命令照着能跑通。

### M5-3 README 与截图

- 文件：`README.md`、`doc/screenshots/*`。
- 内容：功能说明、遥控器操作表、已知限制（576P、无账号、无弹幕和倍速等）、截图。
- 完成标准：截图里没有站点广告和他人隐私信息。

### M5-4 真机验证

不对应提交。打包后在真机上装一次，确认 Luna 接口转发（以及关掉服务时退直连的表现）、代理握手、播放和返回键退出都正常，结论写回架构文档。M3-4 已经在旧内核上跑过一遍，这里是发布前的确认。

- 验证：Q4。

### M5-5 发版流程（需要时再做）

- 文件：`.github/workflows/release.yml`（拷 olevod）。
- 完成标准：推 `v*` tag 后 Release 里有 `.ipk`。

## 依赖一览

| 编号 | 被哪些任务依赖 |
| --- | --- |
| D1 账号与画质 | M3-1、M3-2 |
| D2 接口通道 | M1-2、M1-4 |
| D3 排行榜 | M0-5、M2-2、M2-6、M4-2 |
| D4 剧集顺序 | M1-5、M3-1 |
| D5 搜索输入 | M2-5 |
| D6 筛选面板 | M2-3、M2-4 |
| D7 清晰度 | M3-2 |
| D8 代理白名单 | M1-4 |
| D9 配色 | M0-2 |
| D10 应用名和图标 | M0-2、M5-1 |
| D11 调研资料入库 | M0-1、M1-7 |
| Q1 排序值 | M1-6、M2-4 |
| Q3 模拟器访问宿主机代理 | M1-2、M3-2 |
| Q4 真机直连、Node 16、Chromium 108 | M3-4、M5-4 |
| Q5 令牌有效期 | M3-3 |
| Q6 code 5 触发条件 | M1-3、M1-8（只做防御，不专门测） |
| Q7 搜索拼音首字母 | M1-6、M2-5 |
| Q8 VIP 集返回 | M1-5、M3-1 |
| Q9 「新」角标来源 | M2-1 |
| Q10 `lsk` 与多语言 | M1-5 |
