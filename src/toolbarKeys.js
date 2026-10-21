/**
 * 工具栏 key 注册表。
 *
 * 目的：让宿主像 AiEditor 一样用 `toolbarKeys` / `toolbarExcludes` 裁剪工具栏，
 * 同时把映射集中在一处，避免每个宿主自己记住内部 group 名。
 * 分组粒度对应现有工具栏的 12 个按钮区；行内格式额外支持按 mark 裁剪。
 */

export const TOOLBAR_GROUPS = Object.freeze([
  'history', 'headings', 'marks', 'textStyle', 'blockStyle',
  'insert', 'tables', 'ai', 'search', 'outline', 'viewModes', 'shortcuts',
])

export const MARK_KEYS = Object.freeze([
  'bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'highlight',
])

// 常用别名：宿主写 heading / table / undo 也能落到正确的分组。
const ALIASES = Object.freeze({
  heading: 'headings', title: 'headings', paragraph: 'headings',
  table: 'tables', image: 'insert', images: 'insert', insert: 'insert',
  undo: 'history', redo: 'history',
  search: 'search', find: 'search', outline: 'outline', toc: 'outline',
  fullscreen: 'viewModes', read: 'viewModes', reading: 'viewModes', preview: 'viewModes', slides: 'viewModes',
  theme: 'viewModes', help: 'shortcuts', shortcut: 'shortcuts',
  link: 'textStyle', color: 'textStyle', font: 'textStyle', fontSize: 'textStyle',
  align: 'blockStyle', indent: 'blockStyle', lineHeight: 'blockStyle',
  clear: 'blockStyle',
  emoji: 'insert', math: 'insert', formula: 'insert', codeBlock: 'insert',
  taskList: 'insert', bulletList: 'insert', orderedList: 'insert',
  blockquote: 'insert', callout: 'insert', column: 'insert', columns: 'insert', divider: 'insert',
})

export const TOOLBAR_KEYS = Object.freeze([...TOOLBAR_GROUPS, ...MARK_KEYS])

function normalizeKey(key) {
  const value = String(key || '').trim()
  if (!value) return ''
  if (TOOLBAR_KEYS.includes(value)) return value
  return ALIASES[value] || ''
}

/**
 * 把 AiEditor 风格的工具栏配置翻译成编辑器内部结构。
 * @param {{toolbarKeys?: string[], toolbarExcludes?: string[]}} options
 * @returns {{toolbar: Record<string, boolean>, marksAllow: null|string[], unknown: string[]}}
 */
export function resolveToolbarKeys(options = {}) {
  const source = options && typeof options === 'object' ? options : {}
  const toolbar = {}
  TOOLBAR_GROUPS.forEach((group) => { toolbar[group] = true })
  let marksAllow = null
  const unknown = []

  const allowList = Array.isArray(source.toolbarKeys) ? source.toolbarKeys : null
  if (allowList) {
    TOOLBAR_GROUPS.forEach((group) => { toolbar[group] = false })
    const marks = []
    allowList.forEach((raw) => {
      const key = normalizeKey(raw)
      if (!key) { if (String(raw || '').trim()) unknown.push(String(raw)) ; return }
      if (MARK_KEYS.includes(key)) marks.push(key)
      else toolbar[key] = true
    })
    if (marks.length) {
      toolbar.marks = true
      marksAllow = MARK_KEYS.filter((key) => marks.includes(key))
    } else if (toolbar.marks === false) {
      marksAllow = []
    }
  }

  const excludes = Array.isArray(source.toolbarExcludes) ? source.toolbarExcludes : []
  excludes.forEach((raw) => {
    const key = normalizeKey(raw)
    if (!key) { if (String(raw || '').trim()) unknown.push(String(raw)) ; return }
    if (MARK_KEYS.includes(key)) {
      const base = marksAllow || MARK_KEYS.slice()
      marksAllow = base.filter((item) => item !== key)
    } else {
      toolbar[key] = false
    }
  })

  if (toolbar.marks === false) marksAllow = []
  if (Array.isArray(marksAllow) && !marksAllow.length) toolbar.marks = false

  return { toolbar, marksAllow, unknown }
}
