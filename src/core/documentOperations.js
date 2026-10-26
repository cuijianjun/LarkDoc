import { Fragment } from '@tiptap/pm/model'
import { moveDepthAllowed } from './blocks/container-depth'
import { MENTION_KINDS } from './blocks/mention'
import { REMINDER_REPEATS, REMINDER_AT_PATTERN } from './blocks/reminder'
import { isEmojiGlyph } from './emoji/catalog'

// 未知块占位卡 payload 上限（P1-03）：payload 可能承载替代整个子树的原始块 JSON。
export const UNKNOWN_PAYLOAD_MAX = 1000000

// HTML 是导入适配器；所有 JSON 在写入编辑器前必须通过完整 schema 校验。
/** 校验 URL 是否可安全写入 schema：http(s)/mailto/tel/锚点，图片额外放行 data:image 与本地相对路径。返回 boolean。 */
export function safeUrl(value, image = false) {
  if (typeof value !== 'string' || !value || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return false
  if (image && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value)) return true
  // 图片的相对路径（/、./、../ 开头）是本地资源引用，与 networkPolicy.isLocalUrl 语义一致。
  // 它们不含 javascript:/data: 等危险协议，可直接进 schema（老系统图床 /note/... 即此类）。
  // 注意排除协议相对 URL（//host/... 会被浏览器解析为 http(s)://host/...，属外链而非本地资源）。
  if (image && /^(?:#|\.{1,2}\/|(?:\/(?!\/)))/.test(value)) return true
  if (/^https?:\/\//i.test(value)) {
    try { const url = new URL(value); return !!url.hostname && !url.username && !url.password } catch (_) { return false }
  }
  return !image && (/^(mailto|tel):[^:<>]+$/i.test(value) || /^#[\w\u0080-\uffff-]+$/.test(value))
}

/** 校验颜色值（hex / rgb(a) / hsl(a) / CSS 关键字），防止 style 注入。 */
export function safeColor(value) {
  return typeof value === 'string' && (/^#[\da-f]{3,8}$/i.test(value) || /^(rgb|hsl)a?\([\d.,%\s+-]+\)$/i.test(value) || /^[a-z]+$/i.test(value))
}

/** 校验附件 id：非空、长度 ≤1000、不含控制字符。 */
export function safeAttachmentId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1000 && !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
}

function validateAttrs(type, attrs, definition) {
  if (attrs === undefined) return
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) throw new Error(`无效属性：${type}`)
  Object.keys(attrs).forEach((key) => {
    const value = attrs[key]
    if (!definition.attrs || !Object.prototype.hasOwnProperty.call(definition.attrs, key)) throw new Error(`不支持的属性：${type}.${key}`)
    // 公开 TextStyle HTML parser 用空字符串表示未设置的样式，这是合法的原生 JSON。
    if (type === 'textStyle' && value === '' && definition.attrs[key].default === null && ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'lineHeight'].includes(key)) return
    if (value === null) {
      if (definition.attrs[key].default !== null) throw new Error(`必填属性不能为 null：${type}.${key}`)
      return
    }
    let valid = true
    if (key === 'src' || key === 'originalSrc') valid = value === '' || safeUrl(value, true)
    else if (key === 'attchId' || key === 'originalAttchId') valid = safeAttachmentId(value)
    else if (key === 'href') valid = safeUrl(value)
    else if (key === 'level') valid = Number.isInteger(value) && value >= 1 && value <= 9
    else if (key === 'indent') valid = Number.isInteger(value) && value >= 0 && value <= 8
    else if (key === 'width' || key === 'height') valid = Number.isFinite(value) && value >= (type === 'column' ? 10 : 40) && value <= (type === 'column' ? 90 : 2400)
    // 内嵌网页（P3-07）的 `aspect` / `bridgeVersion` 都是**数字**，而本白名单的兜底分支
    // 只收字符串 —— 落进来必被判非法，症状是带这两个字段的 webEmbed 一进 setContent
    // 就整块抛错；`bridgeVersion` 有默认值 1，等于「存一次盘再打开就炸」。
    // 这里的区间必须与 blocks/web-embed.js 各自的 validate 逐字一致。
    else if (key === 'aspect') valid = Number.isFinite(value) && value > 0 && value <= 20
    else if (key === 'bridgeVersion') valid = Number.isInteger(value) && value >= 1 && value <= 99
    else if (key === 'lineHeight') valid = /^(normal|[1-4](\.\d{1,2})?)$/.test(String(value))
    else if (key === 'backgroundColor' || key === 'borderColor' || key === 'color') valid = safeColor(value)
    // 高亮块图标：P4-03 起是全量表情，与 blocks/callout.js 的 validate 共用同一次查表。
    else if (key === 'emoji') valid = isEmojiGlyph(value)
    else if (key === 'align') valid = ['left', 'center', 'right'].includes(value)
    else if (key === 'textAlign') valid = ['left', 'center', 'right', 'justify'].includes(value)
    else if (key === 'verticalAlign') valid = ['top', 'middle', 'bottom'].includes(value)
    else if (key === 'language') valid = typeof value === 'string' && /^[\w+-]{0,32}$/.test(value)
    else if (key === 'fontSize') valid = typeof value === 'string' && /^(?:[8-9]|[1-9]\d|1[0-9]\d|200)(px|pt)$/.test(value)
    else if (key === 'fontFamily') valid = typeof value === 'string' && value.length <= 100 && !/[;{}<>\\]/.test(value)
    else if (key === 'colwidth') valid = Array.isArray(value) && value.every((width) => Number.isInteger(width) && width > 0 && width <= 2400)
    else if (key === 'colspan' || key === 'rowspan' || key === 'start') valid = Number.isInteger(value) && value > 0 && value <= 10000
    else if (key === 'open' || key === 'checked') valid = typeof value === 'boolean'
    // 提及（P4-01）：`notify` 是**布尔**且默认 true，`kind` 是枚举 —— 兜底分支只收字符串，
    // 落进来必被判非法，症状与 P3-07 的 `aspect` 完全同型：「存一次盘再打开就炸」。
    // 只对 mention 生效，不用 `key === 'notify'` 全局放行，避免别的块借同名 key 钻空子。
    else if (type === 'mention' && key === 'notify') valid = typeof value === 'boolean'
    else if (type === 'mention' && key === 'kind') valid = MENTION_KINDS.indexOf(value) !== -1
    // mentionId 是文档内实例 UUID；`id` 是实体 id（open_id / chat_id / doc token）。
    else if (type === 'mention' && key === 'mentionId') valid = typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
    else if (type === 'mention' && key === 'id') valid = typeof value === 'string' && value.length <= 256 && !value.includes('\u0000')
    // 日期提醒（P4-02a）：`notify` 是布尔、`repeat` 是枚举、`remindAt` 是带时区的 ISO 串。
    // 前两个落进兜底分支必被判非法（兜底只收字符串），`remindAt` 则相反 —— 兜底会
    // 放行任意 10 万字串，这里收紧到 ISO 形状。空串放行：那是 mark 的 schema 默认值。
    else if (type === 'reminder' && key === 'notify') valid = typeof value === 'boolean'
    else if (type === 'reminder' && key === 'repeat') valid = REMINDER_REPEATS.indexOf(value) !== -1
    else if (type === 'reminder' && key === 'remindAt') valid = value === '' || (typeof value === 'string' && REMINDER_AT_PATTERN.test(value))
    else if (key === 'blockId') valid = BLOCK_ID_PATTERN.test(String(value))
    // 标题编号：开关是布尔，起点是 1..999 的整数或不设（null = 继续）。
    else if (key === 'numbering') valid = typeof value === 'boolean'
    else if (key === 'numberingStart') valid = value === null || (Number.isInteger(value) && value >= 1 && value <= HEADING_NUMBER_MAX)
    // 列表项起点（等价 <li value>）：null = 继续前序，数字 = 从该值起算。
    else if (key === 'numberStart') valid = value === null || (Number.isInteger(value) && value >= 1 && value <= HEADING_NUMBER_MAX)
    else if (key === 'target') valid = ['_blank', '_self'].includes(value)
    else if (key === 'rel') valid = typeof value === 'string' && /^[a-z\s-]*$/i.test(value)
    // 未知块占位卡（P1-03）：payload 承载原始块 JSON，可能替代整个子树，上限放宽到 1M 字符。
    else if (type === 'unknownBlock' && key === 'payload') valid = typeof value === 'string' && value.length <= UNKNOWN_PAYLOAD_MAX && !value.includes('\u0000')
    else if (type === 'unknownBlock' && key === 'unknownType') valid = typeof value === 'string' && value.length >= 1 && value.length <= 100 && !value.includes('\u0000')
    else valid = typeof value === 'string' && value.length <= 100000 && !value.includes('\u0000')
    if (!valid) throw new Error(`不安全或无效的属性：${type}.${key}`)
  })
}

/**
 * 标题容器读取兼容（P1-02 第一步「先读兼容」）。
 *
 * 飞书标题块是容器：`heading-children` 把「直到下一同级标题之间的内容」收进
 * 标题内部（02 §2）。容器形态的 JSON 允许 heading 节点携带 `children` 数组；
 * 本包写入侧目前仍是 v1 扁平模型，因此读入口在这里把容器展平为等价扁平
 * JSON：子块按原顺序拼接到标题之后，嵌套标题递归展开。
 *
 * - 纯函数：不修改入参；结果继续过 validateDocument 常规全量校验，安全性不放宽。
 * - 非 heading 节点上的 `children` 原样保留，仍由 validateDocument 拒绝（不放宽白名单）。
 * - heading 的 `children` 非数组视为容器语义不成立，丢弃该字段按普通标题处理。
 */
export function flattenHeadingContainers(json) {
  if (!json || typeof json !== 'object') return json
  const walk = (node) => {
    if (Array.isArray(node)) return node.flatMap(walk)
    if (!node || typeof node !== 'object') return node
    const next = { ...node }
    if (Array.isArray(next.content)) next.content = next.content.flatMap(walk)
    if (next.type !== 'heading') return next
    delete next.children
    if (!Array.isArray(node.children)) return next
    const flat = node.children.flatMap(walk).filter((child) => child && typeof child === 'object')
    return flat.length ? [next, ...flat] : [next]
  }
  const result = walk(json)
  return Array.isArray(result) ? result[0] : result
}

/**
 * 扁平 → 容器聚合（flattenHeadingContainers 的逆；P1-02 第二步切写入 + P1-04 迁移 v1→v2）。
 *
 * 02 §2 口径：标题分节 =「直到下一同级（或更浅）标题之间的内容」收进该标题的
 * children；分节内更深的标题递归聚合自己的分节（嵌套分节永远不会越过父分节
 * 边界——父边界标题层级更浅，必然同时终结子分节）；缩进块保留 attrs.indent
 * 原样作为子块，不额外嵌套。
 *
 * - 纯函数：不修改入参；对已是容器形态的输入幂等（既有 children 原样保留）。
 * - 非 doc 顶层 JSON 直通返回；聚合结果继续由 validateDocument 全量校验。
 */
export function aggregateHeadingContainers(json) {
  if (!json || typeof json !== 'object' || json.type !== 'doc' || !Array.isArray(json.content)) return json
  const headingLevel = (node) => (node && node.type === 'heading' ? Number(node.attrs && node.attrs.level) || 1 : Infinity)
  const build = (blocks) => {
    const result = []
    let index = 0
    while (index < blocks.length) {
      const block = blocks[index]
      if (!block || block.type !== 'heading') { result.push(block); index += 1; continue }
      const level = headingLevel(block)
      // 已聚合输入的既有 children 原样保留在前（幂等）；分节内的后续块递归聚合后追加。
      const children = Array.isArray(block.children) ? block.children.slice() : []
      let end = index + 1
      while (end < blocks.length && headingLevel(blocks[end]) > level) end += 1
      if (end > index + 1) children.push(...build(blocks.slice(index + 1, end)))
      const next = { ...block }
      if (children.length) next.children = children
      else delete next.children
      result.push(next)
      index = end
    }
    return result
  }
  return { ...json, content: build(json.content) }
}

/**
 * 未知块占位还原（P1-03）：unknownBlock → payload 内原始 JSON，导出侧保真出口。
 *
 * - 编辑器 getJSON 里未知块只以占位卡存在；导出 / 落库前经本函数还原为原始块
 *   JSON（key 顺序逐字节保真，stringify/parse 幂等），再次载入时 validateDocument
 *   会重新降级为占位卡——一来一回不丢字节。
 * - payload 损坏（非字符串 / 空 / parse 失败 / 还原结果缺 type）时保留占位卡原样。
 * - 还原结果可能仍含未知 type（正是原始形态），消费方不得再过 validateDocument。
 * - 纯函数：不修改入参；heading.children 容器形态同步递归。
 */
export function restoreUnknownBlocks(json) {
  if (!json || typeof json !== 'object') return json
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk)
    if (!node || typeof node !== 'object') return node
    const next = { ...node }
    if (Array.isArray(next.content)) next.content = next.content.map(walk)
    if (Array.isArray(next.children)) next.children = next.children.map(walk)
    if (next.type !== 'unknownBlock') return next
    const payload = next.attrs && next.attrs.payload
    if (typeof payload !== 'string' || !payload) return next
    try {
      const restored = JSON.parse(payload)
      if (restored && typeof restored === 'object' && typeof restored.type === 'string' && restored.type !== 'unknownBlock') return restored
    } catch (_) { /* payload 损坏 → 保留占位 */ }
    return next
  }
  return walk(json)
}

/** 全量校验 Tiptap JSON（节点/属性/深度/规模白名单）并返回规范化 JSON，导入与快照恢复的必经入口。 */
export function validateDocument(json, schema) {
  // 标题容器形态（heading.children）先展平成扁平模型再校验（P1-02 读取兼容）。
  json = flattenHeadingContainers(json)
  if (!json || json.type !== 'doc') throw new Error('请输入有效的 Tiptap 文档 JSON')
  let count = 0
  function visit(item, depth) {
    if (!item || typeof item !== 'object' || depth > 100 || ++count > 100000) throw new Error('文档结构过深或过大')
    const type = schema.nodes[item.type]
    if (!type) {
      // P1-03：未知块就地降级为占位卡，原始 JSON 逐字节存进 payload
      // （JSON.stringify 保 key 顺序，stringify/parse 幂等）。payload 超 1M 时
      // 放弃保真只存占位（载入优先于还原）；unknownType 供副文案展示。
      const payload = JSON.stringify(item)
      return {
        type: 'unknownBlock',
        attrs: {
          payload: payload.length <= UNKNOWN_PAYLOAD_MAX ? payload : '',
          unknownType: String(item.type).split('\u0000').join('').slice(0, 100) || 'unknown',
        },
      }
    }
    const unknown = Object.keys(item).find((key) => !['type', 'attrs', 'content', 'marks', 'text'].includes(key))
    if (unknown) throw new Error(`不支持的节点字段：${unknown}`)
    validateAttrs(item.type, item.attrs, type)
    if (item.type === 'text' && (typeof item.text !== 'string' || !item.text)) throw new Error('文本节点不能为空')
    if (item.type !== 'text' && item.text !== undefined) throw new Error('非文本节点包含 text')
    if (item.content !== undefined && !Array.isArray(item.content)) throw new Error('content 必须为数组')
    if (item.marks !== undefined && !Array.isArray(item.marks)) throw new Error('marks 必须为数组')
    ;(item.marks || []).forEach((mark) => {
      const markType = mark && schema.marks[mark.type]
      if (!markType) throw new Error(`不支持的格式：${mark && mark.type}`)
      if (Object.keys(mark).some((key) => !['type', 'attrs'].includes(key))) throw new Error('不支持的格式字段')
      validateAttrs(mark.type, mark.attrs, markType)
    })
    // content 逐个递归：子级若是未知块会被替换为占位卡，需用替换结果重组数组。
    let next = item
    if (Array.isArray(item.content)) {
      const content = item.content.map((child) => visit(child, depth + 1))
      if (content.some((child, index) => child !== item.content[index])) next = { ...item, content }
    }
    return next
  }
  json = visit(json, 0)
  const node = schema.nodeFromJSON(json)
  node.check()
  node.descendants((child) => {
    if (child.type.name === 'image' && !safeUrl(child.attrs.src, true)) throw new Error('图片地址无效')
  })
  return node.toJSON()
}

/** 清洗粘贴/导入的 HTML：标签、属性、style 全走白名单，返回安全的 HTML 字符串。 */
export function sanitizeHTML(html) {
  if (typeof html !== 'string') throw new Error('HTML 必须为字符串')
  const container = document.createElement('div')
  container.innerHTML = html
  const tags = new Set(['P', 'DIV', 'SPAN', 'MARK', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'CODE', 'PRE', 'SUB', 'SUP', 'BLOCKQUOTE', 'HR', 'UL', 'OL', 'LI', 'A', 'IMG', 'FIGURE', 'FIGCAPTION', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TH', 'TD', 'COLGROUP', 'COL', 'DETAILS', 'SUMMARY', 'LABEL', 'INPUT'])
  const dangerous = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'BASE', 'FRAME', 'FRAMESET'])
  const attributes = new Set(['href', 'src', 'alt', 'title', 'width', 'colspan', 'rowspan', 'colwidth', 'start', 'value', 'open', 'type', 'checked', 'disabled', 'data-type', 'data-level', 'data-width', 'data-align', 'data-original-src', 'data-attch-id', 'data-original-attch-id', 'data-caption', 'data-latex', 'data-name', 'data-emoji', 'data-checked', 'data-colwidth', 'data-color', 'data-language', 'data-indent', 'data-block-id', 'data-numbering', 'data-numbering-start', 'data-continue-from', 'data-token', 'data-mention-kind', 'data-mention-id', 'data-department', 'data-notify', 'class'])
  Array.from(container.querySelectorAll('*')).forEach((element) => {
    if (!container.contains(element)) return
    const tag = element.tagName.toUpperCase()
    if (dangerous.has(tag)) { element.remove(); return }
    if (!tags.has(tag)) {
      // 普通布局容器只拆外壳；原快照中的后代仍逐个清理，危险子树整段删除。
      while (element.firstChild) element.parentNode.insertBefore(element.firstChild, element)
      element.remove()
      return
    }
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase()
      if (name === 'style') {
        const style = element.style
        const allowed = {}
        ;['color', 'background-color', 'text-align', 'vertical-align', 'font-family', 'font-size', 'line-height', 'width', 'padding-left'].forEach((property) => {
          const value = style.getPropertyValue(property)
          if (value && !/[<>;{}\\]|url\s*\(|expression|var\s*\(/i.test(value)) allowed[property] = value
        })
        element.removeAttribute('style')
        Object.keys(allowed).forEach((property) => { element.style.setProperty(property, allowed[property]) })
      } else if (!attributes.has(name)) element.removeAttribute(name)
      else if (name === 'data-color' && (tag !== 'MARK' || !safeColor(attribute.value))) element.removeAttribute(name)
      else if (name === 'colwidth') {
        // Tiptap 输出 colwidth；每个跨列格保留对应的正整数列宽，沿用 JSON 的 2400 上限。
        const widths = attribute.value.split(',').map(Number)
        if (!['TH', 'TD'].includes(tag) || !/^\d+(,\d+)*$/.test(attribute.value) || widths.length !== Number(element.getAttribute('colspan') || 1) || !widths.every(width => Number.isInteger(width) && width > 0 && width <= 2400)) element.removeAttribute(name)
      } else if (name === 'href' && !safeUrl(attribute.value)) element.removeAttribute(name)
      // 列表项起点（等价 <li value>）：只认 li 上的 1..10000 正整数。
      else if (name === 'value' && (tag !== 'LI' || !/^[1-9]\d{0,3}$/.test(attribute.value))) element.removeAttribute(name)
      else if ((name === 'src' || name === 'data-original-src') && !safeUrl(attribute.value, true)) element.removeAttribute(name)
      else if ((name === 'data-attch-id' || name === 'data-original-attch-id') && (!['IMG', 'FIGURE'].includes(tag) || !safeAttachmentId(attribute.value))) element.removeAttribute(name)
      else if (name === 'class' && !/^(language-[\w+-]+|tiptap-mathematics-render)$/.test(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-align' && !['left', 'center', 'right'].includes(attribute.value)) element.removeAttribute(name)
      // 提及（P4-01）：身份属性必须落进 schema 认识的形态 —— 放行一个畸形值，
      // 结果是「粘贴一段带 @ 的富文本 → 整篇 setContent 抛错」，比丢掉 attr 严重得多。
      else if (name === 'data-notify' && !['true', 'false'].includes(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-mention-kind' && MENTION_KINDS.indexOf(attribute.value) === -1) element.removeAttribute(name)
      else if (name === 'data-mention-id' && !/^[\w-]{1,64}$/.test(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-token' && (attribute.value.length > 256 || attribute.value.includes('\u0000'))) element.removeAttribute(name)
    })
    if (element.tagName === 'INPUT') {
      if (element.getAttribute('type') !== 'checkbox') element.remove()
      else element.setAttribute('disabled', '')
    }
    if (element.tagName === 'A') element.setAttribute('rel', 'noopener noreferrer')
  })
  return container.innerHTML
}

/** 检测段落中未完成的 slash 输入；返回 { from, to, query } 或 null（代码内不触发）。 */
export function getSlashMatch(state) {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'paragraph') return null
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
  const match = /(?:^|\s)\/([^/\s]*)$/.exec(before)
  if (!match) return null
  let inCode = false
  $from.parent.nodesBetween($from.parentOffset - match[1].length - 1, $from.parentOffset, (node) => { if (node.marks.some((mark) => mark.type.name === 'code')) inCode = true })
  return inCode ? null : { from: $from.pos - match[1].length - 1, to: $from.pos, query: match[1] }
}

/**
 * 检测文本块里未完成的 `@` 输入；返回 `{ from, to, query }` 或 null。
 *
 * 与 `getSlashMatch` 的三处差异都是 02 §19.3 的行为差异，不是随手放松：
 *   1. **标题 / 列表项里也能 @**（飞书支持），所以只排除代码块，不限定 paragraph；
 *   2. `@` 前必须是词边界（行首或空白）—— 否则 `a@b.com` 一敲就弹面板；
 *   3. `@` 后不吞空白：查询串只到下一个空白/`@` 为止（飞书输入「@张 三」时
 *      面板会关掉，不存在「带空格查询」）。
 *
 * IME 组字期间**不在这里挡**：`document.js` 的 `view.composing` 与
 * `compositionstart/end` 已经在触发链路上双重拦截（见该文件）。
 */
export function getMentionMatch(state) {
  const { $from, empty } = state.selection
  if (!empty) return null
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.name === 'codeBlock') return null
  const before = parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
  const match = /(?:^|\s)@([^@\s]*)$/.exec(before)
  if (!match) return null
  let inCode = false
  const start = $from.parentOffset - match[1].length - 1
  parent.nodesBetween(start, $from.parentOffset, (node) => {
    if (node.marks.some((mark) => mark.type.name === 'code')) inCode = true
  })
  return inCode ? null : { from: $from.pos - match[1].length - 1, to: $from.pos, query: match[1] }
}

/** 全文查找字符串（按字面量转义，跨块不误配）；返回 [{ from, to }] 位置数组。 */
export function findTextMatches(doc, query) {
  if (typeof query !== 'string' || !query) return []
  const matches = []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    // 文本 Mark 不改变位置；叶节点占位防止跨公式/Emoji 错配。
    const value = node.textBetween(0, node.content.size, '', '\ufffc')
    pattern.lastIndex = 0
    let match = pattern.exec(value)
    while (match) {
      matches.push({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length })
      match = pattern.exec(value)
    }
  })
  return matches
}

/** 替换查找命中：默认替换当前/首个匹配，all=true 替换全部；返回替换数量。 */
export function replaceText(editor, query, replacement, all = false) {
  if (!editor.isEditable || typeof replacement !== 'string') return 0
  const matches = findTextMatches(editor.state.doc, query)
  const selection = editor.state.selection
  const current = matches.find((match) => match.from === selection.from && match.to === selection.to)
    || matches[editor.storage?.larkDoc?.activeIndex || 0] || matches[0]
  const selected = all ? matches : current ? [current] : []
  if (!selected.length) return 0
  const tr = editor.state.tr
  selected.slice().reverse().forEach(({ from, to }) => {
    const marks = tr.doc.resolve(from).marks()
    if (replacement) tr.replaceWith(from, to, editor.state.schema.text(replacement, marks))
    else tr.delete(from, to)
  })
  editor.view.dispatch(tr)
  return selected.length
}

/** 把 [from, to) 的完整块整体移动到 target 位置；结构非法时返回 false 不动文档。 */
export function moveBlockRange(editor, from, to, target) {
  const { doc } = editor.state
  if (!editor.isEditable || ![from, to, target].every(Number.isInteger) || from < 0 || from >= to || to > doc.content.size || target < 0 || target > doc.content.size || (target >= from && target <= to)) return false
  // P1-05：容器嵌套深度兜底判定（拖拽 / 上移下移共用入口）。
  if (!moveDepthAllowed(editor, from, to, target)) return false
  const start = doc.resolve(from)
  const end = doc.resolve(to)
  const dest = doc.resolve(target)
  if (!start.sameParent(end) || start.textOffset || end.textOffset || dest.textOffset) return false
  const first = start.index()
  const last = end.index()
  if (start.pos !== start.posAtIndex(first) || end.pos !== end.posAtIndex(last) || dest.pos !== dest.posAtIndex(dest.index())) return false
  const slice = doc.slice(from, to)
  if (slice.openStart || slice.openEnd) return false
  let filler = Fragment.empty
  if (!start.parent.canReplace(first, last)) {
    const empty = start.parent.type.contentMatch.defaultType?.createAndFill()
    if (!empty) return false
    filler = Fragment.from(empty)
    if (!start.parent.canReplace(first, last, filler)) return false
  }
  const tr = editor.state.tr.replaceWith(from, to, filler)
  const insertAt = tr.mapping.map(target, target > to ? -1 : 1)
  const mapped = tr.doc.resolve(insertAt)
  if (!mapped.parent.canReplace(mapped.index(), mapped.index(), slice.content)) return false
  tr.insert(insertAt, slice.content)
  tr.doc.check()
  editor.view.dispatch(tr)
  return true
}

/** 收集页面级标题大纲（排除容器内标题）；返回 [{ pos, level, text }]。 */
export function collectOutline(doc) {
  const result = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const resolved = doc.resolve(pos)
    const hiddenByContainer = Array.from({ length: resolved.depth }, (_, index) => resolved.node(index + 1).type.name)
      .some((type) => ['callout', 'blockquote', 'detailsContent', 'column', 'tableCell', 'tableHeader'].includes(type))
    if (!hiddenByContainer) result.push({ pos, level: node.attrs.level, text: node.textContent })
  })
  return result
}

const isolatedHeadingContainers = new Set(['callout', 'blockquote', 'detailsContent', 'column', 'tableCell', 'tableHeader'])

/*
 * —— 标题编号（对齐飞书）——
 *
 * 飞书的「标题编号」不是一个独立的编号系统，而是「把标题块设为有序列表」：
 * 开放平台模型里就是 ParagraphStyle{ headingLevel: 1..9, list: { type: 'number', number } }
 * ——标题和有序列表共用同一套 list 字段。所以这里也只加两个属性：
 *
 *   numbering: false | true        // 是否显示编号（飞书新建标题默认无编号）
 *   numberingStart: null | number  // 「重新开始编号 / 设置编号的值」的起点，null = 继续
 *
 * 「继续标题编号」= numberingStart 清成 null（所以它在已经是继续态时是禁用的）。
 * 编号值本身不落库：由前序同级标题算出来，删除/移动/插入会自动更新（飞书同款行为）。
 */
export const HEADING_NUMBER_MAX = 999

/**
 * 把一串层级计数拼成飞书样式的编号。
 *
 * H1 → `1.`（带尾点）；H2 → `1.1`；H3 → `1.1.1`（多级不带尾点）。
 * 前导 0 会被丢掉：文档直接从 H2 开始时显示 `1.` 而不是 `0.1`。
 */
export function formatHeadingNumber(numbers) {
  if (!Array.isArray(numbers) || !numbers.length) return ''
  let first = 0
  while (first < numbers.length - 1 && !numbers[first]) first += 1
  const parts = numbers.slice(first)
  return `${parts.join('.')}${parts.length === 1 ? '.' : ''}`
}

/**
 * 扫描整篇文档，返回 `Map<pos, { label, level, counters }>`。
 *
 * 只统计「带编号的标题」：正文有序列表由浏览器 list-style 自己排，两者互不干扰。
 * `numberingStart` 生效时把该层计数器压回起点，后续同级兄弟从它继续（飞书语义）。
 */
export function computeHeadingNumbers(doc) {
  const result = new Map()
  if (!doc) return result
  const counters = new Array(10).fill(0)
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading' || !node.attrs || !node.attrs.numbering) return true
    const level = Math.max(1, Math.min(9, Number(node.attrs.level) || 1))
    // 更深层的计数归零：出现 H2 之后，之前的 H3 序列不再影响新的 H3。
    for (let deeper = level + 1; deeper <= 9; deeper += 1) counters[deeper] = 0
    const start = node.attrs.numberingStart
    if (Number.isInteger(start) && start > 0) counters[level] = Math.min(HEADING_NUMBER_MAX, start) - 1
    counters[level] += 1
    const numbers = counters.slice(1, level + 1)
    result.set(pos, { label: formatHeadingNumber(numbers), level, counters: numbers.slice() })
    return true
  })
  return result
}

/** 取某个位置标题的编号（非编号标题返回 null）。 */
export function headingNumberAt(doc, pos) {
  if (!doc || !Number.isInteger(pos)) return null
  const node = doc.nodeAt(pos)
  if (!node || node.type.name !== 'heading' || !node.attrs?.numbering) return null
  return computeHeadingNumbers(doc).get(pos) || null
}

/** 把越界的编号起点压回合法区间（1..999），null/空串表示「继续」（返回 null）。 */
export function clampHeadingNumberStart(value) {
  // 必须先挡 null：Number(null) === 0 会被误判成合法数字并夹成 1。
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(1, Math.min(HEADING_NUMBER_MAX, Math.round(number)))
}

/**
 * 有序列表的编号：飞书按「层级」换样式，不是一路阿拉伯数字。
 *
 *   第 1 层 `1.`  第 2 层 `a.`  第 3 层 `i.`  第 4 层又回到 `1.`
 *
 * 和标题编号（`1.` / `1.1` / `1.1.1` 复合数字）是两套规则：标题编号是「章节号」，
 * 列表编号是「这一层自己的序号」。两者都由装饰层现算，不写进正文文本。
 */
export const ORDERED_LIST_FORMATS = ['decimal', 'lower-alpha', 'lower-roman']
const ALPHA_LABEL = 'abcdefghijklmnopqrstuvwxyz'
const ROMAN_LABEL = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]

/** 1 → a，26 → z，27 → aa（飞书小写字母编号）。 */
export function alphaListLabel(value) {
  let number = Math.max(1, Math.round(Number(value) || 1))
  let label = ''
  while (number > 0) {
    number -= 1
    label = ALPHA_LABEL[number % 26] + label
    number = Math.floor(number / 26)
  }
  return label
}

/** 1 → i，4 → iv，9 → ix（飞书小写罗马编号）。 */
export function romanListLabel(value) {
  let number = Math.max(1, Math.min(3999, Math.round(Number(value) || 1)))
  let label = ''
  ROMAN_LABEL.forEach(([amount, glyph]) => {
    while (number >= amount) { label += glyph; number -= amount }
  })
  return label
}

/** 某一层第 index 项的编号文本（depth 从 1 开始）。 */
export function formatOrderedIndex(value, depth = 1) {
  const index = Math.max(1, Math.min(9999, Math.round(Number(value) || 1)))
  const level = Math.max(1, Math.round(Number(depth) || 1))
  const format = ORDERED_LIST_FORMATS[(level - 1) % ORDERED_LIST_FORMATS.length]
  if (format === 'lower-alpha') return `${alphaListLabel(index)}.`
  if (format === 'lower-roman') return `${romanListLabel(index)}.`
  return `${index}.`
}

/** 这个有序列表在第几层（外层每套一个 orderedList 记一层）。 */
function orderedListDepth(doc, pos) {
  try {
    const $pos = doc.resolve(pos)
    let depth = 1
    for (let level = $pos.depth; level > 0; level -= 1) {
      if ($pos.node(level).type.name === 'orderedList') depth += 1
    }
    return depth
  } catch (_) {
    return 1
  }
}

/**
 * 前一个同层的有序列表（`ol` 的紧邻兄弟节点）。
 *
 * 「继续编号」要跨列表接号（飞书同款：上一个列表排到 3，这个列表从 4 起），
 * 这里只认**紧邻**兄弟 —— 中间隔着段落/别的块就是两个独立列表，不接号。
 */
export function previousSiblingOrderedList(doc, pos) {
  if (!doc || !Number.isInteger(pos)) return null
  try {
    const $pos = doc.resolve(pos)
    const index = $pos.index()
    if (index <= 0) return null
    const prev = $pos.parent.child(index - 1)
    if (!prev || prev.type.name !== 'orderedList') return null
    return { node: prev, pos: pos - prev.nodeSize }
  } catch (_) {
    return null
  }
}

/**
 * 列表序号能不能点「继续编号」。
 *
 * 两种情况可继续：
 * 1. 该 item 自己有显式起点（`numberStart`）→ 清掉即回到接着上一个 item 数；
 * 2. 它是列表首项、且前面紧邻另一个有序列表 → 让这个列表接上前一个列表的序号。
 *
 * 其余情况（孤立的列表、已经处于继续态）禁用 —— 与飞书菜单一致。
 */
export function canContinueListNumber(doc, pos) {
  if (!doc || !Number.isInteger(pos)) return false
  const node = nodeAtSafe(doc, pos)
  if (!node || node.type.name !== 'listItem') return false
  if (Number.isInteger(node.attrs?.numberStart)) return true
  try {
    const $pos = doc.resolve(pos)
    const parent = $pos.parent
    if (!parent || parent.type.name !== 'orderedList') return false
    if (parent.attrs?.continueFrom) return false
    if ($pos.index() !== 0) return false
    return !!previousSiblingOrderedList(doc, $pos.before())
  } catch (_) {
    return false
  }
}

/**
 * 扫描全文档的有序列表，返回 `Map<listItem 的 pos, { label, depth, index, numberStart }>`。
 *
 * 序号按列表自己的 `start` 起算（`<ol start="3">` → 3./4./5.），
 * 嵌套列表各算各的，和外层序号无关 —— 与飞书一致。
 *
 * 单个 item 上的 `numberStart`（等价 HTML `<li value="N">`）会把该 item 的序号
 * 拉回指定值，后面的兄弟项接着它继续 —— 这是「重新开始编号 / 设置编号的值」
 * 落库的方式：只标一个起点，编号值本身仍然每帧现算。
 *
 * 列表上的 `continueFrom`（「继续编号」写下的标记）让这个列表接着**前面紧邻**
 * 有序列表的最后一项继续排；前一个列表增删条目时跟着变，不落死数字。
 */
export function computeOrderedListNumbers(doc) {
  const result = new Map()
  if (!doc) return result
  // 每个列表排到第几号（ol 起始 pos → 最后一项的序号），供后面的「继续编号」接号。
  const totals = new Map()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'orderedList') return true
    const depth = orderedListDepth(doc, pos)
    let start = Number(node.attrs?.start) > 0 ? Number(node.attrs.start) : 1
    if (node.attrs && node.attrs.continueFrom) {
      const prev = previousSiblingOrderedList(doc, pos)
      const prevTotal = prev ? totals.get(prev.pos) : undefined
      if (Number.isFinite(prevTotal)) start = prevTotal + 1
    }
    let index = start
    node.forEach((item, offset) => {
      if (item.type.name !== 'listItem') return
      const explicit = Number(item.attrs?.numberStart)
      if (Number.isFinite(explicit) && explicit > 0) index = Math.round(explicit)
      result.set(pos + 1 + offset, { label: formatOrderedIndex(index, depth), depth, index, numberStart: item.attrs?.numberStart ?? null })
      index += 1
    })
    totals.set(pos, index - 1)
    return true
  })
  return result
}

/** 无序列表的圆点：同样走装饰层（浏览器 ::marker 会正好落在折叠箭头 / 句柄的位置上）。 */
export function computeBulletItems(doc) {
  const result = new Map()
  if (!doc) return result
  doc.descendants((node, pos) => {
    if (node.type.name !== 'bulletList') return true
    let depth = 1
    try {
      const $pos = doc.resolve(pos)
      for (let level = $pos.depth; level > 0; level -= 1) {
        if ($pos.node(level).type.name === 'bulletList') depth += 1
      }
    } catch (_) { depth = 1 }
    node.forEach((item, offset) => {
      if (item.type.name === 'listItem') result.set(pos + 1 + offset, { depth })
    })
    return true
  })
  return result
}

/** 缩进层级对应的像素步长与上限（对齐飞书实测：每级 25px，最深 6 层 = 5 级缩进）。 */
export const INDENT_STEP_PX = 25
export const MAX_BLOCK_INDENT = 5

/**
 * 缩进层级的唯一钳制入口。
 *
 * 飞书的块缩进到第 6 层（= 缩进 5 级）就不再下沉，任何入口（快捷键、工具栏、
 * 气泡菜单、块菜单、导入的 JSON/HTML）都必须走这里，避免出现「某个入口能一直加」。
 */
export function clampBlockIndent(value, max = MAX_BLOCK_INDENT) {
  const limit = Number.isFinite(Number(max)) ? Math.max(0, Math.min(MAX_BLOCK_INDENT, Number(max))) : MAX_BLOCK_INDENT
  const level = Number(value)
  if (!Number.isFinite(level)) return 0
  return Math.max(0, Math.min(limit, Math.round(level)))
}

/**
 * 越界安全的 doc.nodeAt。
 *
 * 宿主整体替换正文（setContent / 恢复快照）后，上一帧记下的块位置可能已经超出文档尺寸，
 * prosemirror 的 nodeAt 会直接抛 RangeError 并把渲染栈打崩；这里统一返回 null。
 */
export function nodeAtSafe(doc, pos) {
  if (!doc || !Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null
  return doc.nodeAt(pos)
}

/** 收集超出上限的缩进（老数据/外部 JSON），用于挂载与 setContent 后一次性归一。 */
export function collectIndentFixes(doc) {
  const fixes = []
  if (!doc || typeof doc.descendants !== 'function') return fixes
  doc.descendants((node, pos) => {
    const value = node?.attrs?.indent
    if (!Number.isInteger(value)) return
    const next = clampBlockIndent(value)
    if (next !== value) fixes.push({ pos, node, indent: next })
  })
  return fixes
}

function nodeIndent(node, fallback = 0) {
  return Number.isInteger(node?.attrs?.indent) ? node.attrs.indent : fallback
}

/**
 * 一个块的「有效缩进层级」。
 *
 * 段落/标题以自身 indent 为准（0 就是顶层）；容器与原子块（代码块、表格、引用、图片…）
 * 的 indent=0 只表示「没设过」，在计算上级关系时按 0 处理（它们是顶层盒子）。
 */
export function blockEffectiveIndent(node) {
  const own = Number.isInteger(node?.attrs?.indent) ? node.attrs.indent : 0
  return own > 0 ? own : 0
}

/**
 * 一个位置上的块「最多能缩进到第几级」—— 由**前一个兄弟块**决定。
 *
 * 飞书的块缩进不是绝对层级，而是「成为上一个块的子块」：所以
 * - 文档 / 父容器的第一个块没有前兄弟 → 上限 0（缩不动）；
 * - 前块 0 级 → 上限 1；前块 2 级 → 上限 3；
 * - 仍然不超过硬上限 MAX_BLOCK_INDENT（6 层）。
 *
 * 减少缩进**不受此限**：只受 0 下限约束，可以一路减回文档开头。
 */
export function maxIndentAt(doc, pos, max = MAX_BLOCK_INDENT) {
  if (!doc || !Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return 0
  const ceiling = Number.isFinite(Number(max)) ? Math.max(0, Math.min(MAX_BLOCK_INDENT, Number(max))) : MAX_BLOCK_INDENT
  let $pos
  try { $pos = doc.resolve(Math.min(pos, doc.content.size)) } catch (_) { return 0 }
  // 位置落在文本块内部时先退到该块的起点，否则 index() 拿到的是行内偏移。
  if ($pos.depth > 0 && $pos.parent.isTextblock) {
    try { $pos = doc.resolve($pos.before($pos.depth)) } catch (_) { return 0 }
  }
  const index = $pos.index()
  if (index <= 0) return 0
  const previous = $pos.parent.child(index - 1)
  return Math.min(ceiling, blockEffectiveIndent(previous) + 1)
}

/** 按「前一个兄弟块」算出的上限来钳制缩进值（直接设置缩进时用；减少缩进不要走这里）。 */
export function clampBlockIndentAt(doc, pos, value, max = MAX_BLOCK_INDENT) {
  const limit = maxIndentAt(doc, pos, max)
  const level = Number(value)
  if (!Number.isFinite(level)) return 0
  return Math.max(0, Math.min(limit, Math.round(level)))
}

/**
 * 缩进/减少缩进的下一步层级 —— 所有入口（工具栏、气泡、块菜单、⌘] / ⌘[）共用。
 *
 * - 增加：不能超过 maxIndentAt（前一个兄弟块 + 1）；已经到顶或老数据超顶时原地不动，
 *   不会「点一下增加反而跳到 0」；
 * - 减少：只受 0 下限约束，可以一路减回文档开头（真飞书实测：到顶后依然能一路减）。
 */
export function stepBlockIndent(doc, pos, currentIndent, delta, max = MAX_BLOCK_INDENT) {
  const current = Number(currentIndent) || 0
  if (delta < 0) return Math.max(0, current + delta)
  const limit = maxIndentAt(doc, pos, max)
  if (current >= limit) return current
  return Math.min(current + 1, limit)
}

/**
 * 章节扫描时判断一个块自己的层级。
 *
 * 段落/标题的 indent=0 表示「回到顶层」；容器与原子块（代码块、表格、引用、图片…）
 * 的 indent=0 只表示「没设过」，沿用上一层——否则在缩进段落里插入代码块，
 * 代码块会以 0 级把章节截断。显式缩进过（>0）的这些块仍然按自己的层级算。
 */
function sectionIndent(node, inherited) {
  const own = Number.isInteger(node?.attrs?.indent) ? node.attrs.indent : null
  const authoritative = own !== null && (own > 0 || node.type.name === 'paragraph' || node.type.name === 'heading')
  return authoritative ? own : inherited
}

function sectionBlock(node, pos, role) {
  return { from: pos, to: pos + node.nodeSize, node, role }
}

/**
 * Resolve one heading's real section in its immediate parent container.
 * The returned blocks are the only blocks allowed to receive section state;
 * `to` is intentionally the first excluded sibling rather than a giant DOM range.
 */
export function resolveHeadingSection(doc, pos) {
  return resolveHeadingSectionMode(doc, pos)
}

/**
 * 解析一个标题的章节范围，折叠与悬停高亮共用同一套规则。
 *
 * 飞书的章节边界是**缩进子树**而不是标题级别：块模型里每个块只有一个父块，
 * 子块靠缩进挂在父块下面。所以 H2 后面没有缩进的 H3/H4 是它的兄弟块，折叠 H2
 * 不会带走它们；反过来缩进更深的普通段落、代码块、列表都属于 H2 的子树。
 * 目录（collectOutline）仍然按标题级别排，那是另一套语义。
 */
export function resolveHeadingSectionMode(doc, pos) {
  if (pos < 0 || pos > doc.content.size) return null
  const heading = doc.nodeAt(pos)
  // 飞书的章节不属于标题：段落、列表、代码块只要下面挂了子块，折叠与悬停高亮
  // 都按同一套「缩进子树」处理（用户实测：段落 + 缩进代码块也是一个整体）。
  if (!heading || !heading.isBlock) return null
  const resolved = doc.resolve(pos)
  const parent = resolved.parent
  const baseIndent = nodeIndent(heading)
  // 老文档里代码块/表格还没有 indent 属性，沿用前一个兄弟块的层级，
  // 否则子树的连续性会被一个缺属性的块截断。
  let previousIndent = baseIndent
  let hasDescendantHeading = false
  let end = resolved.end()
  const blocks = [sectionBlock(heading, pos, 'heading')]
  for (let index = resolved.index() + 1; index < resolved.parent.childCount; index += 1) {
    const sibling = resolved.parent.child(index)
    const siblingPos = resolved.posAtIndex(index)
    const indent = sectionIndent(sibling, previousIndent)
    // 列表在视觉上天然缩进（序号/圆点画在正文列之外），飞书里标题/段落下面
    // 直接跟一个没有显式缩进的列表时，列表就是它的子块（折叠 + 高亮都算进去）。
    // 显式 indent > 0 的列表按显式值走，不受这里影响。
    const ownIndent = Number.isInteger(sibling.attrs?.indent) ? sibling.attrs.indent : null
    // 只有段落/标题做宿主时，未缩进列表才算隐式子块（列表符号画在正文列之外，
    // 视觉上天然挂在文字块下面）；代码块等容器盒子后面的列表仍是顶层兄弟。
    const implicitList = (heading.type.name === 'paragraph' || heading.type.name === 'heading')
      && LIST_SECTION_TYPES.has(sibling.type.name) && !(ownIndent > 0)
    const effective = implicitList ? Math.max(indent, baseIndent + 1) : indent
    if (effective <= baseIndent) { end = siblingPos; break }
    // 继承基准仍用原始缩进：列表的「隐式 +1」只决定它自己算不算子块，
    // 不能把列表后面同样没缩进的代码块/表格也吸进子树。
    previousIndent = indent
    const isHeading = sibling.type.name === 'heading'
    if (isHeading) hasDescendantHeading = true
    if (sibling.isBlock) blocks.push(sectionBlock(sibling, siblingPos, isHeading ? 'descendant-heading' : 'body'))
  }
  // hasContent 的语义是「标题下面还有块」——只挂子标题也算有内容，
  // 悬停时整段高亮成一块（飞书的遮罩就是一个矩形）。
  const hasContent = blocks.length > 1
  return { from: pos, to: end, headingPos: pos, heading, parent, blocks, hasContent, hasDescendantHeading }
}

/** resolveHeadingSectionMode 的 highlight 模式别名，供旧调用方与高亮逻辑使用。 */
export function resolveHeadingHighlightSection(doc, pos) {
  return resolveHeadingSectionMode(doc, pos)
}

/**
 * 任意块能否折叠：块级节点、有稳定 blockId、且不在表格单元格等隔离容器里。
 *
 * 折叠偏好按 blockId 存，所以没有 id 的块（结构性容器）不参与；
 * 有没有「可折叠内容」由 foldedRange 判断，这里只管资格。
 */
export function isFoldableBlock(doc, pos) {
  if (!doc || !Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return false
  const node = doc.nodeAt(pos)
  if (!node || !node.isBlock || !BLOCK_ID_TYPES.has(node.type.name)) return false
  const resolved = doc.resolve(pos)
  for (let depth = 1; depth <= resolved.depth; depth += 1) {
    if (isolatedHeadingContainers.has(resolved.node(depth).type.name)) return false
  }
  return true
}

/** 判断标题是否属于页面大纲（不在 callout/表格等隔离容器内）。 */
export function isPageHeading(doc, pos) {
  if (!doc || pos < 0 || pos > doc.content.size) return false
  const heading = doc.nodeAt(pos)
  if (!heading || heading.type.name !== 'heading') return false
  const resolved = doc.resolve(pos)
  for (let depth = 1; depth <= resolved.depth; depth += 1) {
    if (isolatedHeadingContainers.has(resolved.node(depth).type.name)) return false
  }
  return true
}

/** 计算某个块的折叠范围 [{ from, to }]；没有缩进子树（无处可折叠）返回 null。
 *
 * 范围语义与飞书一致：**折叠的是「缩进子树」，与块类型/标题级别无关**。
 * - 段落/标题/其它块：同缩进层级的后续兄弟（+ 它们更深缩进的后代）；
 * - 列表项：子树在自己内部，从首个子段落之后到 item 结尾。
 */
export function foldedRange(doc, pos) {
  if (!isFoldableBlock(doc, pos)) return null
  const node = doc.nodeAt(pos)
  // 列表项的子树在自己内部：首个子段落之后的内容（嵌套子列表、代码块…）才是可折叠部分。
  if (node && (node.type.name === 'listItem' || node.type.name === 'taskItem')) {
    if (node.childCount < 2) return null
    const from = pos + 1 + node.child(0).nodeSize
    const to = pos + node.nodeSize - 1
    return to > from ? { from, to } : null
  }
  // item 的「标题行」（首个子段落）不单独折叠：折叠入口归 item 自己。
  // 否则同一段内容会同时挂上 item 的箭头和首段落的箭头（两个 widget 落在同一个
  // 行内位置、互相盖住），点其中一个等于把另一个刚设的状态又切回去。
  const resolved = doc.resolve(pos)
  const parentName = resolved.parent.type.name
  if ((parentName === 'listItem' || parentName === 'taskItem') && resolved.index() === 0) return null
  const section = resolveHeadingSectionMode(doc, pos)
  if (!section) return null
  const from = pos + section.heading.nodeSize
  // 空范围等于「没有子块」：折叠箭头不该出现，调用方也无事可做。
  return section.to > from ? { from, to: section.to } : null
}

/**
 * 解析「块操作目标」范围（需求 13.4.3.1 悬浮范围 + 13.6.10 块类型矩阵的上下层规则）。
 *
 * 命中优先级由内到外，**只返回一个**目标，父子容器不会同时进入高亮：
 * 1. 表格：整表作为一个块，单元格聚焦不抢句柄；
 * 2. 列表：最近的列表容器 → 当前 item 及其完整子树（嵌套列表命中内层 item）；
 * 3. 整块容器：callout / blockquote / details / columns 在 V1 只暴露容器句柄；
 * 4. 其余：包含指针的顶层块（代码块、图片、分割线等原子块即自身）。
 * `container` 标记供高亮层选择「整框」还是「文字范围」。
 */
const BLOCK_TARGET_CONTAINERS = new Set(['callout', 'blockquote', 'details', 'columns'])
const BLOCK_TARGET_LISTS = new Set(['bulletList', 'orderedList', 'taskList'])

export function resolveBlockTargetRange(doc, from, to = from) {
  if (!doc || !Number.isInteger(from)) return null
  const clamp = (value) => Math.max(0, Math.min(doc.content.size, value))
  const $from = doc.resolve(clamp(from))
  const $to = doc.resolve(clamp(to))
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    if ($from.node(depth).type.name !== 'table') continue
    return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1, container: 'table' }
  }
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const name = $from.node(depth).type.name
    if (BLOCK_TARGET_LISTS.has(name)) {
      const index = Math.min($from.index(depth), $from.node(depth).childCount - 1)
      if (index < 0) break
      return { from: $from.posAtIndex(index, depth), to: $from.posAtIndex(index + 1, depth), parentDepth: depth, container: null }
    }
    if (BLOCK_TARGET_CONTAINERS.has(name)) {
      return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1, container: name }
    }
  }
  const lastIndex = $from.node(0).childCount - 1
  const startIndex = Math.min($from.index(0), lastIndex)
  if (startIndex < 0) return null
  const endIndex = Math.max(startIndex + 1, Math.min($to.index(0) + Number($to.pos > $to.posAtIndex($to.index(0), 0)), lastIndex + 1))
  return { from: $from.posAtIndex(startIndex, 0), to: $from.posAtIndex(endIndex, 0), parentDepth: 0, container: null }
}

/*
 * —— 稳定块标识（blockId） ——
 *
 * 与飞书文档模型对齐：每个块带一个稳定 id，折叠、评论锚点、协同、@引用都按 id
 * 引用块，而不是按「层级 + 文本 + 同名序号」这种会随编辑漂移的派生键。派生键在
 * 删除靠前的同名标题时会整体前移，折叠状态就会串到另一个同名标题上；id 不会。
 *
 * 覆盖范围：用户能当作「一个块」操作的单位（段落/标题/列表容器/列表项/引用/
 * 高亮块/分栏/折叠块/代码块/图片/分割线/表格/块级公式）。
 * 不覆盖纯结构性容器（tableRow、tableCell、column、detailsContent 等）：它们是
 * 父块的内部骨架，父块已经携带 id，重复编号只会让 JSON 体积翻倍。
 *
 * 列表项是唯一的「既是骨架又能当块」的特例：飞书把 fold-block-id 直接挂在
 * item 上（折叠状态属于 item，不属于外层列表），所以 item 必须有独立 id。
 */
/**
 * 折叠箭头允许挂载的块类型（= 能被用户当成「一段可折文本」的块）。
 *
 * 箭头是行内 widget，只能插在「内容以行内开头」的块里：段落/标题在 pos+1，
 * 列表项要钻进首个子段落（pos+2）。代码块、图片等原子块没有可折叠子树，
 * 不在集合里（foldedRange 也会返回 null，双保险）。
 */
export const TEXT_FOLD_TYPES = new Set(['paragraph', 'heading', 'listItem', 'taskItem'])

/** 章节解析里「视觉上天然缩进」的列表容器：未显式缩进时算前一个文本块的子块。 */
const LIST_SECTION_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

export const BLOCK_ID_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'callout', 'columns', 'details', 'detailsSummary',
  // 列表项在飞书里是独立块（fold-block-id 就挂在 item 上），子块藏在 item 内部，
  // 所以要给 item 自己的 blockId，折叠状态才存在它身上。
  'listItem', 'taskItem',
  'bulletList', 'orderedList', 'taskList', 'codeBlock', 'image', 'horizontalRule', 'blockMath', 'table',
  // 文件 / 视频块（P2-04）是原子块，但它自己就是「用户能当作一个块操作」的单位，
  // 折叠与锚点都要能指向它，所以进 id 集合。
  'fileBlock',
  // 小组件块（P4-04）：原子块，但折叠与锚点都要能指向它 —— 不进集合就没有 blockId，
  // 导出再导回时实例键与块 id 会一起漂。
  'isv',
  // 电子表格块（P5-02）：同上。悬停手柄把 `blockId` 转交给宿主开块菜单，
  // 不给 id 就永远只能传 `null`；折叠/评论锚点也缺一个落点。
  'sheet',
  // 投票块（P5-03）：同上。header 标签行把 `blockId` 转交给宿主，`onVote` 也带着它，
  // 不给 id 就永远只能传 `null`；结果条要按块对账时同样缺一个落点。
  'poll',
])
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

let blockIdSequence = 0

/** 生成一个短块 id（base36 时间片 + 自增序号 + 随机尾，长度 ≤ 32，无需外部依赖）。 */
export function createBlockId(taken) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    blockIdSequence = (blockIdSequence + 1) % 46656
    const candidate = `b${Math.random().toString(36).slice(2, 9)}${blockIdSequence.toString(36)}`
    if (!taken || !taken.has(candidate)) return candidate
  }
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 找出所有需要补 id 或重新编号的块：[{ pos, id }]。
 *
 * 重复 id（回车分段复制 attrs、复制粘贴、拖拽复制）不是简单「保留先出现的」：
 * 传入 `previous = { doc, mapping }` 时，会以「旧位置经 mapping 映射后的位置」为准，
 * 谁离它更近谁保留原 id —— 这样粘贴在文档**前面**的副本也不会抢走原块的 id，
 * 折叠状态始终留在原来那个块上。
 */
export function collectBlockIdFixes(doc, previous) {
  const fixes = []
  if (!doc) return fixes
  const taken = new Set()
  const owner = new Map()
  const oldPositions = new Map()
  if (previous && previous.doc) {
    previous.doc.descendants((node, pos) => {
      if (!BLOCK_ID_TYPES.has(node.type.name)) return true
      const id = node.attrs && node.attrs.blockId
      if (typeof id === 'string' && id && !oldPositions.has(id)) oldPositions.set(id, pos)
      return true
    })
  }
  const expectedPosition = (id) => {
    const pos = oldPositions.get(id)
    if (pos === undefined) return null
    if (!previous || !previous.mapping) return pos
    // assoc=1：块「起始位置」在它之前插入内容后要跟着右移，映射结果才是原块的新位置。
    try { return previous.mapping.map(pos, 1) } catch (_) { return pos }
  }
  const reissue = () => { const fresh = createBlockId(taken); taken.add(fresh); return fresh }
  doc.descendants((node, pos) => {
    if (!BLOCK_ID_TYPES.has(node.type.name)) return true
    const id = node.attrs && node.attrs.blockId
    if (typeof id !== 'string' || !BLOCK_ID_PATTERN.test(id)) { fixes.push({ pos, id: reissue() }); return true }
    if (!owner.has(id)) { taken.add(id); owner.set(id, pos); return true }
    const keeper = owner.get(id)
    const expected = expectedPosition(id)
    if (expected !== null && Math.abs(pos - expected) < Math.abs(keeper - expected)) {
      fixes.push({ pos: keeper, id: reissue() })
      owner.set(id, pos)
    } else fixes.push({ pos, id: reissue() })
    return true
  })
  return fixes
}

/** 可折叠块的 blockId → pos 索引；折叠集合存 id，装饰层靠它换算位置。 */
export function foldableIdPositions(doc) {
  const index = new Map()
  if (!doc) return index
  doc.descendants((node, pos) => {
    if (!isFoldableBlock(doc, pos)) return
    const id = node.attrs && node.attrs.blockId
    if (typeof id === 'string' && id) index.set(id, pos)
  })
  return index
}

/** 旧名字保留：折叠早先从标题开始，现在索引所有可折叠块。 */
export const headingIdPositions = foldableIdPositions

/** 取某个位置上的块 id（非块级节点或未编号返回 null）。 */
export function blockIdAt(doc, pos) {
  if (!doc || !Number.isInteger(pos)) return null
  const node = doc.nodeAt(pos)
  if (!node || !BLOCK_ID_TYPES.has(node.type.name)) return null
  const id = node.attrs && node.attrs.blockId
  return typeof id === 'string' && id ? id : null
}

/**
 * 页面级标题的**旧版**折叠偏好键：`层级 + 文本 + 同名序号`。
 * @deprecated 仅用于把 localStorage 里的历史偏好迁移到 blockId（见 foldLarkDocByKeys）。
 * 新代码请用 headingIdPositions / blockIdAt。
 */
export function mapHeadingFoldKeys(doc) {
  const keys = new Map()
  if (!doc) return keys
  const seen = new Map()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading' || !isPageHeading(doc, pos)) return
    const base = `${node.attrs.level}\u0001${node.textContent}`
    const ordinal = seen.get(base) || 0
    seen.set(base, ordinal + 1)
    keys.set(pos, `${base}\u0001${ordinal}`)
  })
  return keys
}

/** 单个标题的折叠偏好键；非页面级标题返回 null。 */
export function headingFoldKey(doc, pos) {
  return mapHeadingFoldKeys(doc).get(pos) || null
}

// 复制、剪切和拖动标题时沿用正文折叠的完整章节范围；视觉高亮仍使用
// resolveHeadingHighlightSection 的独立块边界，避免两个交互共享错误的 DOM 区段。
export function headingActionRange(doc, pos) {
  if (!doc || pos < 0 || pos > doc.content.size || !isPageHeading(doc, pos)) return null
  const section = resolveHeadingSectionMode(doc, pos)
  if (!section || section.to <= pos + section.heading.nodeSize) return null
  return { from: pos, to: section.to, parentDepth: doc.resolve(pos).depth }
}
