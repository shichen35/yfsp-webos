# 本地存储

应用的所有用户数据都只存在这台电视上：设置、收藏、观看记录、搜索记录和选集排序。没有账号，也就没有要加密保存的凭据。没有云端同步，换一台电视或清除应用数据，这些就都没了。

存储代码集中在 `app/src/store/` 和 `app/src/hooks/useStore.js`。

## 持久化的数据一览

| localStorage 键 | 文件 | 内容 | 上限 |
| --- | --- | --- | --- |
| `yfsp:settings` | `store/settings.js` | 用户偏好对象 | — |
| `yfsp:favorites` | `store/favorites.js` | 收藏列表，最新收藏在前 | 不设上限 |
| `yfsp:history` | `store/history.js` | 观看记录，带续播进度 | 40 条 |
| `yfsp:searchHistory` | `store/searchHistory.js` | 最近搜索词 | 20 条 |
| `yfsp:epOrder` | `store/episodeOrder.js` | 改成正序的剧集 `{ [影片 id]: true }` | 不需要 |


## createStore 和 useStoreValue

前五项都通过 `createStore(key, defaultValue)` 创建（`app/src/hooks/useStore.js`），返回 `{ get, set, subscribe }`：

- 模块加载时从 localStorage 读一次，之后读写都走内存快照。
- `set` 接受新值或 updater 函数。写入时替换快照引用（不原地修改），再写 localStorage，最后通知订阅者。返回同一个引用就视为没变，不写也不通知，所以 updater 里「无事可做」时要原样 `return prev`。
- 读失败（JSON 损坏、存储不可用）回退到默认值；写失败（超配额、存储被禁用）静默吞掉，本次运行继续用内存里的值。

组件用 `useStoreValue(store, selector)` 订阅，底层是 React 的 `useSyncExternalStore`。快照引用只在写入时变化，`getSnapshot` 在两次写入之间返回同一个值，这是避免无限重渲染的前提。由此有一条硬规则：selector 只能「挑」不能「算」，写 `s => s.items` 可以，写 `s => s.items.filter(...)` 每次都返回新数组，会让 React 陷入死循环。需要派生的值在组件里用 `useMemo` 算。

非组件代码直接调 `store.get()`，比如 `app/src/hooks/useFocus.js` 在滚动时读 `smoothScroll` 设置。

`createMemoryStore(initialValue)` 是同一套接口的纯内存版本，给会话这类走保险箱持久化的状态用。

## 各个 store

**settings**：默认值在 `DEFAULTS` 里，目前有首页两个货架开关（`homeShowFavorites`、`homeShowRecent`）、底栏顺序 `tabOrder`、隐藏的标签 `hiddenTabs`、平滑滚动 `smoothScroll`。老版本存下的快照可能缺新加的键，所以读设置一律走 `getSetting(snapshot, key)`，缺了就用默认值。新增设置只需在 `DEFAULTS` 里加一项。`tabOrder` / `hiddenTabs` 的增删改（上移下移、隐藏、显示、重置）都走 `app/src/config/nav.js` 的 `moveTab` / `hideTab` / `showTab` / `resetTabs`，由它保证 `tabOrder` 始终列全所有中间标签、首页不参与排序。

**favorites**：`toggle(item)` 不存在就插到最前，存在就移除。条目是卡片要用的那几个字段，不是完整详情。

**history**：最近观看，最新在前，超过 40 条从尾部截掉。每条可带 `watch: { lastEpisodeIndex, position, duration, finished }` 和 `updatedAt`。

- 只有播放器写历史（`app/src/player/PlayerPage.jsx`，位置由 `app/src/player/playbackSession.js` 采样）：首帧开始播放时调 `recordHistory` 把剧排到最前并保留已有进度，播放过程中定时调 `recordProgress` 更新进度（位置取自 `timeupdate` 记下的值，不在收尾时现读 `currentTime`，电视上那时可能已经归零）。打开详情页不算看过。
- 续播规则都在 `app/src/store/watchState.js`：离片尾不到 `FINISHED_TAIL_S` 秒就算看完。看完且有下一集，进度记为下一集的 position 0；看完且没有下一集，记 `finished: true` 而不是清掉，这样以后更新了新集还能接着看。
- 首页「继续观看」、历史页、详情页的「继续观看第 N 集」和播放器续播都读这一份数据。

**searchHistory**：`remember(word)` 去空格、去重后放到最前，保留 20 条。

**episodeOrder**：选集列表默认倒序（最新一集在前，就是接口返回的顺序）。只有用户切成正序的剧才记一条，切回倒序就删掉，所以这个表只会包含用户动过的剧，不需要上限。它只影响显示顺序，「下一集」按集号算（`nextEpisode()`），不看显示顺序。

## 不持久化的东西

- 筛选条件（`app/src/store/filters.js`）：每个分类当前的筛选只存在内存 store 里，分类页的标签和筛选面板都通过 `patchFilter` / `resetFilter` 改同一份，默认值 `DEFAULT_FILTER` 也只在这里定义一次。保存下来的筛选在底栏上看不出来，下次启动一进分类就停在上周选的地区、年代，看着像列表坏了或者是空的。所以每次启动都从默认筛选开始，同一次运行里各标签页保持挂载，自然记得各自的选择。
- 页面数据缓存（`app/src/store/pageCache.js`）：接口数据的内存缓存，让来回切标签不用转圈，刷新页面就清空。缓存 key 只在 `app/src/api/feeds.js` 里拼，页面按 feed 加载、翻页和失效，看不到 key。一个请求只有在它仍是该 key 的在途请求时才写缓存，所以清空或刷新之后才返回的旧请求不会写回。

## 容易踩的坑

- 新加一个持久化 store，键名沿用 `yfsp:` 前缀；如果数据会无限增长，要像 history 那样设上限，或者像 epOrder 那样只存例外。
- 改了已有 store 的数据结构，要考虑电视上已经存着的旧格式。settings 靠 `getSetting` 兜底；history 里没有 `updatedAt` 的旧条目就是不显示时间。
