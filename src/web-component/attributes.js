/**
 * web-component/attributes — HTML 属性 ↔ 门面选项的声明式映射表。
 *
 * 设计取向（对齐 AiEditor 的「配置即对象，属性即标量」思路，但不照搬）：
 * - 只把**可序列化、变更频繁**的配置暴露为 HTML 属性（content / readonly / theme / toolbars...）；
 *   对象型能力（providers / persistence / uploader / ai）只能通过设置 property 传入——
 *   强行把它们塞进 attribute 会让 dawn 属性变成隐式 JSON 协议，不可维护也不可校验。
 * - 表的每一项描述：解析方式、是否支持热更新（变更后是否需要重建实例）。
 *   新增一个属性**只需要往这张表加一行**，元素类与上层代码都不用改——这是扩展性入口。
 *
 *  @type {Array<{
 *   attr: string,            // HTML 属性名（kebab-case）
 *   key: string,             // 落到 options / props 的路径表达字符串，见 applyEntry
 *   target: 'options'|'prop',// 落到门面 options 还是 Workspace prop（后者走 patchProps 热更）
 *   type: 'string'|'boolean'|'number'|'json'|'list',
 *   live?: boolean,          // true：可在不重建实例的情况下更新
 *   toProp?: boolean,        // true：同时写到渲染层 prop（如 readonly）
 * }>}
 */

/** 布尔属性：存在即 true（HTML 规范语义，`readonly=""` 也是 true）。 */
function asBoolean(raw) {
  if (raw === null) return true
  const value = String(raw).toLowerCase()
  return !(value === 'false' || value === '0' || value === 'off')
}

/** 逗号分隔列表：去掉空项与两侧空白；空串得到空数组。 */
function asList(raw) {
  if (!raw) return []
  return String(raw).split(',').map((item) => item.trim()).filter(Boolean)
}

/** JSON 属性：解析失败时保留原值并打日志，绝不抛到宿主。 */
function asJson(raw, attr) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    if (typeof console !== 'undefined') console.error(`[lark-doc] 属性 ${attr} 不是合法 JSON：`, error)
    return undefined
  }
}

function asNumber(raw) {
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

export const PARSERS = { string: (raw) => raw, boolean: asBoolean, number: asNumber, json: asJson, list: asList }

/**
 * 属性映射表。target=prop 且 live=true 的项会走 patchProps 增量热更，
 * 其余项变更时统一触发实例重建（见 LarkDocElement._scheduleRebuild）。
 */
export const ATTRIBUTE_SCHEMA = Object.freeze([
  { attr: 'title', key: 'title', target: 'prop', type: 'string', live: true, toProp: false },
  // content：options 侧必须落 content（门面构造读 source.content），
  // props 侧落 initialContent（渲染层热更用）——两个名字不同，靠 optionsKey 表达。
  // 非 live：Workspace 只在创建期消费 initialContent，属性变更走重建（换文档语义）。
  { attr: 'content', key: 'initialContent', optionsKey: 'content', target: 'prop', type: 'string' },
  { attr: 'content-format', key: 'contentFormat', target: 'prop', type: 'string', live: true, toProp: true },
  { attr: 'placeholder', key: 'placeholder', target: 'options', type: 'string' },
  { attr: 'theme', key: 'theme', target: 'options', type: 'string', live: true },
  { attr: 'readonly', key: 'readonly', target: 'prop', type: 'boolean', live: true, toProp: true },
  { attr: 'autofocus', key: 'autofocus', target: 'options', type: 'boolean' },
  { attr: 'storage', key: 'storage', target: 'options', type: 'string' },
  { attr: 'mode', key: 'mode', target: 'options', type: 'string' },
  { attr: 'document-id', key: 'documentId', target: 'options', type: 'string' },
  { attr: 'toolbar-keys', key: 'toolbarKeys', target: 'options', type: 'list' },
  { attr: 'toolbar-excludes', key: 'toolbarExcludes', target: 'options', type: 'list' },
  { attr: 'features', key: 'features', target: 'options', type: 'json' },
  { attr: 'limits', key: 'limits', target: 'options', type: 'json' },
  { attr: 'layout', key: 'layout', target: 'options', type: 'json' },
  { attr: 'network', key: 'network', target: 'options', type: 'json' },
  { attr: 'capabilities', key: 'capabilities', target: 'options', type: 'json' },
  { attr: 'user', key: 'user', target: 'options', type: 'json', live: true },
  // 静态资源基址（KaTeX 字体 / mermaid vendor 等），不传时按相对路径解析。
  { attr: 'assets-base', key: 'assetsBase', target: 'options', type: 'string' },
  // 最大宽高等数字型限制示例：走 limits.maxLength
  { attr: 'max-length', key: 'limits.maxLength', target: 'options', type: 'number' },
])

/** observedAttributes 列表（只允许表里出现过的属性触发回调）。 */
export const OBSERVED_ATTRIBUTES = ATTRIBUTE_SCHEMA.map((entry) => entry.attr)

const SCHEMA_BY_ATTR = ATTRIBUTE_SCHEMA.reduce((acc, entry) => {
  acc[entry.attr] = entry
  return acc
}, Object.create(null))

/** 把 `a.b.c` 形式的路径写到目标对象上，中间层按需创建。 */
function setPath(target, path, value) {
  const parts = String(path).split('.')
  let node = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]
    if (!node[key] || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[parts[parts.length - 1]] = value
}

/**
 * 读取元素上的全部属性 → { options, props }。
 * - options：交给 `new LarkDoc(options)`
 * - props：交给渲染层（initialContent / contentFormat / readonly / initialTitle...）
 * 解析失败的项会被跳过并由 asJson 打日志，不影响其余属性。
 */
export function readOptionsFromElement(el) {
  const options = {}
  const props = {}
  ATTRIBUTE_SCHEMA.forEach((entry) => {
    if (!el.hasAttribute(entry.attr)) return
    const parse = PARSERS[entry.type] || PARSERS.string
    const value = parse(el.getAttribute(entry.attr), entry.attr)
    if (value === undefined) return
    if (entry.target === 'prop') {
      props[entry.key] = value
      setPath(options, entry.optionsKey || entry.key, value)
    } else {
      setPath(options, entry.key, value)
    }
  })
  return { options, props }
}

/**
 * 单个属性变化时的增量处理：返回 { live, props, rebuild } 三元组。
 * - live=false → 调用方需要重建实例
 * - props 非空 → 交给 document.patchProps
 */
export function applyAttributeChange(name, rawValue) {
  const entry = SCHEMA_BY_ATTR[name]
  if (!entry) return { live: true, props: null, rebuild: false }
  const parse = PARSERS[entry.type] || PARSERS.string
  const value = rawValue === null ? null : parse(rawValue, entry.attr)
  if (value === undefined) return { live: true, props: null, rebuild: false }
  if (!entry.live) return { live: false, props: null, rebuild: true }
  // 生命期内可更新的项：逐项落到对应目标。
  const props = {}
  if (entry.target === 'prop') props[entry.key] = value
  if (entry.toProp) props[entry.key] = value
  return { live: true, props, rebuild: false, entry, value }
}

export default readOptionsFromElement
