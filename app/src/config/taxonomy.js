/*
 * Category taxonomy — the single configuration-driven extension point for
 * navigation. Adding a category here makes it appear in the tab bar (nav.js),
 * get a route, and gain a category page automatically; no other file changes.
 *
 * Option data is captured from the live API (m10 /api/list/AllVideoType for
 * each channel's genres, /v3/list/GetSearchCondition for the other dimensions
 * and which channel shows which) and frozen here as static config so the first
 * paint never waits on a network round trip. GUI labels are Chinese — the
 * app's interface language is Chinese.
 *
 * Every option value is what list/Search takes for that dimension. '0' means
 * "All" for genre/area/lang/year; status and form use the gateway's own -1.
 * The 画质 dimension (vipResource) is left out on purpose: logged out only 576P
 * plays, so filtering by 4K would promise a picture we can't show (D6).
 */

const REGIONS = ['大陆', '香港', '台湾', '日本', '韩国', '欧美', '英国', '泰国', '其它']
const LANGUAGES = ['国语', '粤语', '英语', '韩语', '日语', '西班牙语', '法语', '德语', '意大利语', '泰国语', '其它']
const YEARS = ['今年', '去年', '更早', '90年代', '80年代', '怀旧']

// Turn a genre id/name list into filter options with an "All" entry up front.
// The value is the genre's full cid path, which list/Search takes as `cid`.
function genreOptions(cid, pairs) {
  return [{ value: '0', label: '全部' }, ...pairs.map(([id, label]) => ({ value: `${cid},${id}`, label }))]
}
function stringOptions(values) {
  return [{ value: '0', label: '全部' }, ...values.map((v) => ({ value: v, label: v }))]
}

// The 额外筛选 panel's dimensions. `key` is the filter field (store/filters.js).
const AREA = { key: 'area', title: '地区', options: stringOptions(REGIONS) }
const LANG = { key: 'lang', title: '语言', options: stringOptions(LANGUAGES) }
const YEAR = { key: 'year', title: '年份', options: stringOptions(YEARS) }
const STATUS = {
  key: 'status',
  title: '状态',
  options: [{ value: '-1', label: '全部' }, { value: '0', label: '全集' }, { value: '1', label: '连载中' }],
}
const FORM = {
  key: 'form',
  title: '形式',
  options: [{ value: '-1', label: '全部' }, { value: '0', label: '横屏' }, { value: '1', label: '竖屏' }],
}

// list/Search `orderby` (desc=1 always): 0 added, 1 updated, 2 popularity, 3 rating.
export const SORTS = [
  { value: '1', label: '最近更新' },
  { value: '0', label: '最新上线' },
  { value: '2', label: '最热' },
  { value: '3', label: '评分' },
]
export const DEFAULT_SORT = '1'

// Kept only until FilterPanel / FilterBar stop referencing them (M2-4); the
// site has no initial-letter filter.
export const LETTERS = [{ value: '0', label: '全部' }]
export const DEFAULT_LETTER = '0'

// Display order follows the site's channel menu. `cid` is the channel path
// list/Search takes when no genre is picked. Panels follow GetSearchCondition's
// per-channel order minus 画质; 体育 isn't in it and gets the common three.
export const CATEGORIES = [
  {
    id: 'movie',
    name: '电影',
    cid: '0,1,3',
    genres: genreOptions('0,1,3', [
      [19, '喜剧'], [20, '爱情'], [21, '动作'], [22, '犯罪'], [23, '科幻'], [24, '奇幻'],
      [25, '冒险'], [26, '灾难'], [123, '恐怖'], [27, '惊悚'], [28, '剧情'], [29, '战争'],
      [30, '歌舞'], [31, '经典'], [32, '悬疑'], [113, '动画'], [124, '同性'], [125, '网络电影'],
    ]),
    panelFilters: [AREA, LANG, YEAR],
  },
  {
    id: 'drama',
    name: '电视剧',
    cid: '0,1,4',
    genres: genreOptions('0,1,4', [
      [129, '偶像'], [146, '爱情'], [127, '言情'], [126, '古装'], [141, '历史'], [142, '玄幻'],
      [136, '谍战'], [143, '历险'], [132, '都市'], [144, '科幻'], [135, '军旅'], [133, '喜剧'],
      [128, '武侠'], [145, '江湖'], [138, '罪案'], [131, '青春'], [130, '家庭'], [134, '战争'],
      [137, '悬疑'], [139, '穿越'], [140, '宫廷'], [147, '神话'], [148, '商战'], [149, '警匪'],
      [150, '动作'], [151, '惊悚'], [152, '剧情'], [153, '同性'], [154, '奇幻'],
    ]),
    panelFilters: [AREA, LANG, YEAR, STATUS],
  },
  {
    id: 'variety',
    name: '综艺',
    cid: '0,1,5',
    genres: genreOptions('0,1,5', [
      [39, '真人秀'], [38, '选秀'], [94, '网综'], [43, '脱口秀'], [40, '搞笑'], [91, '竞技'],
      [33, '情感'], [34, '访谈'], [44, '演唱会'], [92, '晚会'], [45, '其它'],
    ]),
    panelFilters: [AREA, LANG, YEAR, STATUS],
  },
  {
    id: 'anime',
    name: '动漫',
    cid: '0,1,6',
    genres: genreOptions('0,1,6', [
      [46, '热血'], [47, '格斗'], [48, '机战'], [49, '少女'], [51, '竞技'], [52, '科幻'],
      [53, '魔幻'], [54, '爆笑'], [55, '推理'], [121, '冒险'], [120, '恋爱'], [119, '校园'],
      [118, '治愈'], [117, '泡面'], [116, '穿越'], [56, '灵异'], [122, '耽美'], [57, '剧场版'],
      [58, '其它'],
    ]),
    panelFilters: [AREA, LANG, YEAR, STATUS],
  },
  {
    id: 'short',
    name: '短剧',
    cid: '0,1,8',
    genres: genreOptions('0,1,8', [
      [68, '偶像'], [69, '爱情'], [72, '言情'], [70, '古装'], [71, '历史'], [73, '玄幻'],
      [74, '谍战'], [158, '都市'], [159, '历险'], [160, '科幻'], [161, '军旅'], [162, '喜剧'],
      [163, '武侠'], [164, '江湖'], [165, '罪案'], [166, '青春'], [167, '家庭'], [168, '战争'],
      [169, '悬疑'], [170, '穿越'], [171, '宫廷'], [172, '神话'], [175, '商战'], [176, '警匪'],
      [177, '动作'], [178, '惊悚'], [179, '剧情'], [180, '同性'], [181, '奇幻'], [182, '女性'],
      [183, '系统'], [185, '逆袭'], [184, '无敌'], [186, '乡村'], [187, '古风'], [188, '赘婿'],
      [189, '萌宝'], [190, '种田'], [191, '犯罪'], [192, '年代'], [193, '志怪'], [194, '战神'],
      [195, '婚姻'], [196, '现言'], [197, '宫斗'], [198, '友情'], [199, '职场'], [200, '民国'],
      [201, '法律'], [202, '抗战'], [203, '时空'], [204, '反转'], [205, '仙侠'], [206, '末世'],
      [207, '体育'], [208, '刑侦'], [209, '成长'], [210, '游戏'], [212, '脑洞'], [215, '冒险'],
      [216, '恐怖'], [219, '古代'], [238, '医疗'], [239, '推理'], [240, '灾难'], [242, '搞笑'],
      [243, '玄学'], [244, '轻喜剧'], [245, '家族'], [232, '超凡'], [233, '日常'], [234, '伦理'],
      [235, '重生'], [236, '经营'], [237, '温情'], [241, '横屏'], [211, '竖屏'],
    ]),
    panelFilters: [AREA, LANG, YEAR, STATUS, FORM],
  },
  {
    id: 'sport',
    name: '体育',
    cid: '0,1,95',
    genres: genreOptions('0,1,95', [
      [99, '奥运'], [98, '综合'], [97, '篮球'], [96, '足球'],
    ]),
    panelFilters: [AREA, LANG, YEAR],
  },
  {
    id: 'documentary',
    name: '纪录片',
    cid: '0,1,7',
    genres: genreOptions('0,1,7', [
      [50, '文化'], [59, '探索'], [60, '军事'], [61, '解密'], [62, '科技'], [63, '历史'],
      [64, '人物'], [66, '自然'], [67, '其它'],
    ]),
    panelFilters: [AREA, LANG, YEAR, STATUS],
  },
]

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || null
}
