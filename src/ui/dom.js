/**
 * Vue 模板语义的小工具 —— `src/ui/` 各积木共用（阶段 5）。
 *
 * 原生层要逐个复刻模板里的 `:style` / `v-show` / `:attr` 行为。这几处**必须**共用一份
 * 实现，否则每个积木各写一遍就会分叉：样式键残留（`:style` 写成合并语义）、
 * `null` 输出成字符串 `"null"` 这类事故都是这么来的。
 *
 * 条件节点的增删有**两套**语义，选错就是事故，别混用：
 * - `syncChildren(parent, slots)` —— 自己**独占**的子树用它（整体对齐，不在序列里的
 *   一律摘掉）。
 * - `mountNode(host, node, on)` —— **多个积木共用**一个宿主时必须用它（只增删自己这
 *   一棵，别人的节点一概不碰）。阶段 5 批次 4b 的「版本面板整块没渲染」就是拿
 *   `syncChildren` 挂共用宿主导致的：三个面板互相摘除，只剩最后更新的那个活着。
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
 * `v-if` 的「有序增删」语义 —— 按期望序列整体对齐 `parent` 的子节点。
 *
 * 不能逐个 `appendChild`：条件为假的节点被摘掉后再置真会被排到队尾
 * （工具栏「查找」关掉再开就跑到「文档操作」后面去了）。
 *
 * 而且**已在正确位置的节点一律不动**。这是硬要求，不只是性能：`appendChild`
 * 会把节点重新插入，若它恰好正在鼠标下，浏览器会补发一次 `mouseenter` ——
 * 于是刚被 Esc 关掉的弹层又被自己的 hover 重新打开（批次 2 踩过）。
 *
 * @param {HTMLElement|null} parent
 * @param {Array<{node: HTMLElement, on: boolean}>} slots 期望序列（未过滤）
 */
export function syncChildren(parent, slots) {
  if (!parent) return
  const desired = slots.filter((slot) => slot.on).map((slot) => slot.node)
  const current = [].slice.call(parent.children)
  if (current.length === desired.length && current.every((node, index) => node === desired[index])) return
  desired.forEach((node, index) => {
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null)
  })
  ;[].slice.call(parent.children).forEach((node) => {
    if (desired.indexOf(node) === -1) parent.removeChild(node)
  })
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

/**
 * 文本插值 —— **只在文案真的变了才写**。
 *
 * 无脑 `node.textContent = x` 每次都把子节点全换成新 Text 节点，代价不只是慢：
 * 正在被 `Range` / 选区引用的 Text 一换，测量结果和光标位置就都对不上了。
 *
 * @param {Node|null} node
 * @param {string|number|null|undefined} text `null` / `undefined` 等价于空串（与模板插值一致）
 */
export function setText(node, text) {
  if (!node) return
  const target = text === null || text === undefined ? '' : String(text)
  if (node.textContent !== target) node.textContent = target
}

/**
 * `v-if` 的「只增删自己这一棵」版 —— **共用宿主**的开合一律走它。
 *
 * 与 `syncChildren` 的分工在文件头写了：`syncChildren` 会清掉「不在期望序列里」的
 * 兄弟节点，只适用于自己独占的子树；一个宿主上挂了多个积木（各面板共用 `panelHost`、
 * 各弹窗共用 `dialogHost`）时用它就会互相摘除。
 *
 * 反过来，**独占**宿主但需要**固定顺序**（比如「舞台必须是 `.lark-doc-main` 的首个
 * 子元素」）也别用它 —— 它是 `appendChild`，只能挂在队尾，那时在宿主里留一个
 * `display: contents` 的空壳容器更省事。
 *
 * @param {HTMLElement|null} host
 * @param {HTMLElement} node
 * @param {boolean} on 期望是否在 DOM 里（对应 `v-if` 的条件）
 */
export function mountNode(host, node, on) {
  if (!on) {
    if (node.parentNode) node.parentNode.removeChild(node)
    return
  }
  if (host && node.parentNode !== host) host.appendChild(node)
}
