/**
 * Vue 模板语义的小工具 —— `src/ui/` 各积木共用（阶段 5）。
 *
 * 原生层要逐个复刻模板里的 `:style` / `v-show` / `:attr` 行为。这几处**必须**共用一份
 * 实现，否则每个积木各写一遍就会分叉：样式键残留（`:style` 写成合并语义）、
 * `null` 输出成字符串 `"null"` 这类事故都是这么来的。
 *
 * 没有 `mount()`：条件节点的增删一律走各积木自己的「按期望序列整体对齐」
 * （`toolbar.js` 的 `syncChildren`），逐个 append 会把摘掉再挂的节点排到队尾。
 */

/**
 * `:style` 的**替换**语义 —— 新对象没提到的键要清掉，不是和旧值合并。
 *
 * 弹层定位（`top` / `left` / `maxHeight`）每次都要整体覆盖，合并语义会把上一轮的
 * `left` 留在原地。旧键记在 `node.__ldStyleKeys` 上，不靠遍历 `style`（会连带清掉
 * 类名给的样式）。
 *
 * @param {HTMLElement|null} node
 * @param {Record<string, string|number|null|undefined>|null} style camelCase 键，与模板一致
 */
export function applyStyle(node, style) {
  if (!node) return
  const prevKeys = node.__ldStyleKeys || []
  const nextKeys = []
  const source = style || {}
  Object.keys(source).forEach((key) => {
    const value = source[key]
    // 空值等价于「本项不设置」，交给下面的清理段处理
    if (value === null || value === undefined || value === '') return
    nextKeys.push(key)
    const text = String(value)
    if (node.style[key] !== text) node.style[key] = text
  })
  prevKeys.forEach((key) => {
    if (nextKeys.indexOf(key) === -1) node.style[key] = ''
  })
  node.__ldStyleKeys = nextKeys
}

/**
 * `v-show` —— 保留节点与状态，只切 `display`。
 *
 * 与 `v-if` 的区别是断言要量的：折叠分组是 `display:none`（节点还在，`getBoundingClientRect`
 * 归零），条件段是**真的不在 DOM 里**（`querySelector` 找不到）。
 *
 * @param {HTMLElement|null} node
 * @param {boolean} visible
 */
export function setVisible(node, visible) {
  if (!node) return
  const next = visible ? '' : 'none'
  if (node.style.display !== next) node.style.display = next
}

/**
 * `:attr` —— `null` / `undefined` 表示**不输出该属性**（不是输出字符串 `"null"`）。
 *
 * 注意布尔属性要传 `''`（如 `readonly` 的写法是 `readonly ? '' : null`），
 * 与 Vue 模板里的口径一致。
 *
 * @param {HTMLElement|null} node
 * @param {string} name
 * @param {string|number|null|undefined} value
 */
export function setAttr(node, name, value) {
  if (!node) return
  if (value === null || value === undefined) {
    if (node.hasAttribute(name)) node.removeAttribute(name)
    return
  }
  const text = String(value)
  if (node.getAttribute(name) !== text) node.setAttribute(name, text)
}
