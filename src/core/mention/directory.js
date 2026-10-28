/**
 * 提及候选源（P4-01）—— requirements/05 §5.7 `mention.search` / `mention.resolve`。
 *
 * 面板要的东西只有一件：**给定关键词，返回若干候选**。谁给的（服务端搜索、
 * 本地通讯录、静态名单）本模块不关心，于是分成两层：
 *
 *   1. `searchMentionDirectory(directory, query, kind)` —— 纯函数，本地名单过滤 + 排序，
 *      无 DOM 无网络，可单测。宿主没接 provider 时就用它。
 *   2. `createMentionProvider(option)` —— 把宿主的 `search` / `resolve` 包成同一形状，
 *      **没给实现就返回 null**（同 `createUnfurlProvider` 的口径），调用方据此回落本地名单。
 *
 * 排序口径（02 §19.3 面板实测行为 + 常识）：前缀命中 > 名字包含 > 部门/关键词包含 >
 * id 命中；同档内保持名单原序（服务端已经排过序，别二次打乱）。
 */

export const MENTION_SEARCH_LIMIT = 20
export const MENTION_RESOLVE_LIMIT = 200
export const DEFAULT_MENTION_TIMEOUT = 6000

// 与 `core/blocks/mention.js` 同口径（本模块刻意不 import 那个模块：它带着整个
// tiptap 节点，这里要能脱离编辑器单测）。属性转义 `\p{Cc}` 避开 no-control-regex。
const CONTROL_RE = /\p{Cc}/gu

function clampText(value, limit) {
  if (value === null || value === undefined) return ''
  return String(value).replace(CONTROL_RE, ' ').trim().slice(0, limit)
}

/**
 * 规范化一条候选。
 *
 * `kind` 不在四类里就落 `user`：面板按 kind 分 tab，未知 kind 会掉进没有 tab 的
 * 黑洞里，宁可归到人员。
 */
export function normalizeMentionEntry(entry, fallbackKind) {
  const source = entry && typeof entry === 'object' ? entry : {}
  const kind = ['user', 'chat', 'page', 'task'].indexOf(source.kind) === -1 ? (fallbackKind || 'user') : source.kind
  return {
    kind,
    id: clampText(source.id || source.openId || source.token, 256),
    name: clampText(source.name || source.title, 64),
    department: clampText(source.department || source.desc, 64),
    keywords: clampText(source.keywords, 200).toLocaleLowerCase(),
    avatar: typeof source.avatar === 'string' ? source.avatar : '',
  }
}

/** 规范化整份名单：逐条收口 + 按 `kind:id` 去重（同一个人别在两个 tab 里各出现一次）。 */
export function normalizeMentionDirectory(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  list.forEach((item) => {
    const entry = normalizeMentionEntry(item)
    if (!entry.name) return
    const key = `${entry.kind}:${entry.id || entry.name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(entry)
  })
  return out
}

function rankOf(entry, needle) {
  const name = entry.name.toLocaleLowerCase()
  if (!needle) return 0
  if (name.indexOf(needle) === 0) return 1
  if (name.indexOf(needle) !== -1) return 2
  if (entry.department.toLocaleLowerCase().indexOf(needle) !== -1) return 3
  if (entry.keywords.indexOf(needle) !== -1) return 4
  if (entry.id.toLocaleLowerCase().indexOf(needle) !== -1) return 5
  return 0
}

/**
 * 本地名单搜索。
 *
 * @param {Array} directory 已规范化或未规范化的名单（内部会再过一遍）。
 * @param {string} query 关键词；空串 = 不过滤（面板刚打开时的「最近」列表）。
 * @param {string} kind tab 过滤；`'all'` / 空 = 全部四类。
 * @param {number} limit 结果上限。
 */
export function searchMentionDirectory(directory, query, kind, limit) {
  const entries = normalizeMentionDirectory(directory)
  const needle = clampText(query, 64).toLocaleLowerCase()
  const wanted = kind && kind !== 'all' ? kind : null
  const scored = []
  entries.forEach((entry, index) => {
    if (wanted && entry.kind !== wanted) return
    const rank = rankOf(entry, needle)
    if (needle && !rank) return
    scored.push({ entry, rank, index })
  })
  scored.sort((left, right) => (left.rank - right.rank) || (left.index - right.index))
  const max = Number.isFinite(limit) && limit > 0 ? limit : MENTION_SEARCH_LIMIT
  return scored.slice(0, max).map((item) => item.entry)
}

/**
 * 造一个可注入的 provider（第 7 个**可选** provider，同 `unfurl` 的定位）。
 *
 * @param {Function|{ search?: Function, resolve?: Function, timeout?: number }} option
 *   裸函数等价于 `{ search: fn }`；`search(query, { documentId, kind })` 可返回
 *   Promise 或数组。没给任何实现时返回 `null` —— 调用方回落本地名单，别当异常。
 * @returns {{ search: Function, resolve: Function|null } | null}
 */
export function createMentionProvider(option) {
  const source = option && typeof option === 'object' ? option : {}
  const search = typeof option === 'function'
    ? option
    : typeof source.search === 'function'
      ? source.search
      : null
  if (!search) return null
  const resolve = typeof source.resolve === 'function' ? source.resolve : null
  const timeout = Number.isFinite(source.timeout) && source.timeout > 0 ? source.timeout : DEFAULT_MENTION_TIMEOUT

  /**
   * 永远 resolve 成数组：面板只认「有没有结果」，不认错误码 —— 搜索失败在飞书里
   * 就是空态（同 unfurl 的「抓不到 = 简卡」口径）。
   */
  function call(fn, args) {
    return new Promise((done) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        done(Array.isArray(value) ? value : [])
      }
      const timer = setTimeout(() => finish([]), timeout)
      let result
      try {
        result = fn.apply(null, args)
      } catch (_) {
        finish([])
        return
      }
      if (result && typeof result.then === 'function') {
        result.then((value) => finish(value && Array.isArray(value.items) ? value.items : value), () => finish([]))
        return
      }
      finish(result)
    })
  }

  return {
    search(query, ctx) {
      return call(search, [clampText(query, 64), ctx || {}]).then((items) => items.map((item) => normalizeMentionEntry(item)))
    },
    resolve: resolve ? (ids, ctx) => call(resolve, [Array.isArray(ids) ? ids.slice(0, MENTION_RESOLVE_LIMIT) : [], ctx || {}]).then((items) => items.map((item) => normalizeMentionEntry(item))) : null,
  }
}
