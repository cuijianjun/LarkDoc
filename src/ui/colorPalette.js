/**
 * 颜色面板 —— `editor/ColorPalette.vue` 的原生等价物（阶段 5 批次 5G）。
 *
 * 这是**两态共用一个壳**的浮层，两态的子树完全不同，别试图合并：
 *
 * - **文字色态**（`.lark-doc-color-palette-text`，宽 280）：`字体颜色`节（8 个 A 字按钮）
 *   → `背景颜色`节（两行 × 9 格）→（有最近才出现）`最近`节 → `恢复默认`。
 * - **高亮块态**（宽 232）：标题 `strong` →（有最近才出现）`最近`节 → `推荐`节 → `恢复默认`。
 *
 * 五条要守住的语义（`scripts/verify-browser-color-palette.js` 锁）：
 *
 * 1. **根是 `v-if`**：`colorPaletteOpen` 为空或只读时整棵不在 DOM 里，不是 `display:none`。
 * 2. **`aria-label` 是 `${title}面板`**（「文字颜色面板」/「高亮块文字颜色面板」…），
 *    断言与读屏都按这个拼法读，别只留 `role=menu`。
 * 3. **`is-active` 是「描边」而不是「填充」**：字色态给当前字色 A 字、背景态给当前背景格挂
 *    `is-active`；背景格子还要保留 `is-transparent`（默认/清除格是斜杠底，不是空 div）。
 * 4. **`mousedown` 必须 `preventDefault()`**（原模板的 `@mousedown.prevent`）——
 *    面板是在选区上悬停打开的，按下就丢焦点的话「点了颜色却作用在空选区」。
 * 5. **`mouseenter` / `mouseleave` 只是转发**：开合由 `calloutColorMixin` 的
 *    `cancelPopupHoverClose` / `scheduleColorPaletteClose` 决定（160ms 收敛 + 点击后
 *    不服开的那套逻辑都在 mixin 里）。别在本模块里自己攒定时器，会两处各管一半。
 *
 * 重建策略：面板里最多 8 + 18 + 最近 8 + 推荐 9 个按钮，整块重造一次就是几十个节点的
 * 增删 —— 所以每个区块各自记「结构指纹」（label/value/颜色序列），**只有指纹变了才重建**。
 * 打开态下的 `is-active` 变化只改 class，不动节点。
 */
import { applyStyle, mountNode, setAttr, syncChildren } from './dom'

/** 统一取 handler：缺项静默（与 `panels.js` / `stage.js` / `helpFab.js` 同口径）。 */
function handlerCaller(handlers) {
  return (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }
}

const signatureOfColors = (list) => (list || []).map((item) => (item && item.value !== undefined ? `${item.value}:${item.label}` : String(item))).join('|')
const signatureOfRows = (rows) => (rows || []).map((row) => signatureOfColors(row)).join('/')

/** 造一颗色块按钮（`<button type="button" role="menuitem" aria-label title>`）。 */
function makeSwatch({ ariaLabel, title, className }) {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('role', 'menuitem')
  setAttr(button, 'aria-label', ariaLabel)
  setAttr(button, 'title', title)
  if (className) button.className = className
  return button
}

/** 切换一个 class（`classList.toggle` 是幂等的，不必加判断）。 */
function setClass(node, name, on) {
  if (node.classList.contains(name) !== !!on) node.classList.toggle(name, !!on)
}

/**
 * @param {{host: HTMLElement|null, handlers?: Record<string, Function>}} options
 * @returns {{el: HTMLElement, update: (patch?: object) => void, destroy: () => void}}
 */
export function createColorPalette({ host, handlers } = {}) {
  const call = handlerCaller(handlers || {})
  const state = {
    open: false,
    isText: false,
    title: '颜色',
    style: null,
    letters: [],
    activeText: '',
    rows: [],
    activeBackground: '',
    recentText: [],
    recent: [],
    options: [],
  }

  // —— 文字色态的「字体颜色」节 ——
  const lettersSection = document.createElement('div')
  lettersSection.className = 'lark-doc-color-palette-text-section'
  const lettersTitle = document.createElement('small')
  lettersTitle.textContent = '字体颜色'
  const lettersWrap = document.createElement('div')
  lettersWrap.className = 'lark-doc-color-letters'
  lettersSection.appendChild(lettersTitle)
  lettersSection.appendChild(lettersWrap)

  // —— 文字色态的「背景颜色」节（两行格子直接挂在这一节下，与 SFC 的 v-for 一致）——
  const backgroundSection = document.createElement('div')
  backgroundSection.className = 'lark-doc-color-palette-text-section'
  const backgroundTitle = document.createElement('small')
  backgroundTitle.textContent = '背景颜色'
  backgroundSection.appendChild(backgroundTitle)

  // —— 高亮块态的标题与「推荐」节 ——
  const titleNode = document.createElement('strong')
  const optionsSection = document.createElement('div')
  optionsSection.className = 'lark-doc-color-palette-section'
  const optionsTitle = document.createElement('small')
  optionsTitle.textContent = '推荐'
  optionsSection.appendChild(optionsTitle)

  // —— 两态共用：`最近`节（class 与点击目标按态变，见文件头第 5 条旁边的说明）——
  const recentSection = document.createElement('div')
  const recentTitle = document.createElement('small')
  recentTitle.textContent = '最近'
  recentSection.appendChild(recentTitle)

  // —— 两态共用：`恢复默认`（SFC 里是两颗各挂一个方法的按钮，DOM 输出完全一致，
  //    这里并成一颗、按当前态分流 —— 只是省一个节点，不是改了行为）——
  const resetButton = document.createElement('button')
  resetButton.type = 'button'
  resetButton.setAttribute('role', 'menuitem')
  resetButton.className = 'lark-doc-color-palette-reset'
  resetButton.setAttribute('aria-label', '恢复默认颜色')
  resetButton.textContent = '恢复默认'
  resetButton.addEventListener('click', () => {
    if (state.isText) call('onResetText')
    else call('onResetPalette')
  })

  const el = document.createElement('div')
  el.className = 'lark-doc-color-palette'
  el.setAttribute('role', 'menu')
  // ④ `@mousedown.prevent` —— 按下不抢焦点，选区才不会在点色块前丢掉
  el.addEventListener('mousedown', (event) => event.preventDefault())
  el.addEventListener('mouseenter', () => call('onEnter'))
  el.addEventListener('mouseleave', () => call('onLeave'))

  // —— 各区块的结构指纹：变了才重建 ——
  let lettersSig = ''
  let rowsSig = ''
  let recentSig = ''
  let optionsSig = ''
  let letterNodes = []
  let gridNodes = []
  let recentNodes = []
  let optionNodes = []

  function buildLetters() {
    const next = signatureOfColors(state.letters)
    if (next === lettersSig) return
    lettersSig = next
    letterNodes = state.letters.map((color) => {
      const button = makeSwatch({ ariaLabel: `字体颜色 ${color.label}`, title: color.label })
      button.textContent = 'A'
      button.addEventListener('click', () => call('onApply', color.value, 'textColor'))
      return button
    })
    syncChildren(lettersWrap, letterNodes.map((node) => ({ node, on: true })))
  }

  function buildRows() {
    const next = signatureOfRows(state.rows)
    if (next === rowsSig) return
    rowsSig = next
    gridNodes = state.rows.map((row) => {
      const grid = document.createElement('div')
      grid.className = 'lark-doc-color-grid'
      const cells = row.map((color) => {
        const button = makeSwatch({ ariaLabel: `背景颜色 ${color.label}`, title: color.label })
        button.addEventListener('click', () => call('onApply', color.value, 'textBackground'))
        return { node: button, color }
      })
      grid.__ldCells = cells
      syncChildren(grid, cells.map((cell) => ({ node: cell.node, on: true })))
      return grid
    })
    syncChildren(backgroundSection, [{ node: backgroundTitle, on: true }, ...gridNodes.map((node) => ({ node, on: true }))])
  }

  function buildOptions() {
    const next = signatureOfColors(state.options)
    if (next === optionsSig) return
    optionsSig = next
    optionNodes = state.options.map((color) => {
      const button = makeSwatch({ ariaLabel: color.label, title: color.label })
      button.addEventListener('click', () => call('onApply', color.value))
      return { node: button, color }
    })
    syncChildren(optionsSection, [{ node: optionsTitle, on: true }, ...optionNodes.map((item) => ({ node: item.node, on: true }))])
  }

  function buildRecent() {
    const list = state.isText ? state.recentText : state.recent
    const next = `${state.isText ? 't' : 'g'}=${list.join('|')}`
    if (next === recentSig) return
    recentSig = next
    recentNodes = list.map((color) => {
      const button = makeSwatch({ ariaLabel: `最近颜色 ${color}`, title: color })
      // 最近的每一项都是具体色值（没有「默认」格），所以底色直接在建节点时写死
      button.style.backgroundColor = color
      // 字色态的「最近」是**背景色**最近（SFC 里传的是 `'textBackground'`）；
      // 高亮块态走 `applyColorPalette(color)`，目标 = 当前 `colorPaletteOpen`。
      button.addEventListener('click', () => (state.isText ? call('onApply', color, 'textBackground') : call('onApply', color)))
      return { node: button, color }
    })
    syncChildren(recentSection, [{ node: recentTitle, on: true }, ...recentNodes.map((item) => ({ node: item.node, on: true }))])
  }

  function paint() {
    // ⑤ 根：class / aria-label / 定位
    setClass(el, 'lark-doc-color-palette-text', state.isText)
    setAttr(el, 'aria-label', `${state.title}面板`)
    applyStyle(el, state.style)

    if (state.isText) {
      letterNodes.forEach((node, index) => {
        const color = state.letters[index]
        if (!color) return
        node.style.color = color.value
        setClass(node, 'is-active', !!state.activeText && String(state.activeText).toLowerCase() === String(color.value).toLowerCase())
      })
      // 背景格子：`is-transparent`（value 为空 = 默认/清除格）+ `is-active`。
      // 默认格「选中」的判据是 `!activeTextBackground` —— 没背景时默认格就是当前项。
      gridNodes.forEach((grid) => {
        (grid.__ldCells || []).forEach((cell) => {
          const value = cell.color.value
          setClass(cell.node, 'is-transparent', !value)
          const active = value
            ? !!state.activeBackground && String(state.activeBackground).toLowerCase() === String(value).toLowerCase()
            : !state.activeBackground
          setClass(cell.node, 'is-active', active)
          // 无值格不给 `backgroundColor`（SFC 的 `:style="color.value ? {...} : {}"`）；
          // 斜杠底由 `.is-transparent::after` 画。
          cell.node.style.backgroundColor = value || ''
        })
      })
      setClass(recentSection, 'lark-doc-color-palette-section', true)
      setClass(recentSection, 'lark-doc-color-palette-text-recent', true)
    } else {
      titleNode.textContent = state.title
      optionNodes.forEach((item) => {
        const value = item.color.value
        setClass(item.node, 'is-transparent', !value)
        item.node.style.backgroundColor = value || ''
      })
      setClass(recentSection, 'lark-doc-color-palette-section', true)
      setClass(recentSection, 'lark-doc-color-palette-text-recent', false)
    }

    // 子树顺序：两态各一套（`v-if` / `v-else` 的两支）。
    // `最近`节只在有内容时才进 DOM —— 两个分支的 `v-if` 都挂在「最近列表非空」上。
    const hasRecent = (state.isText ? state.recentText : state.recent).length > 0
    const children = state.isText
      ? [
        { node: lettersSection, on: true },
        { node: backgroundSection, on: true },
        { node: recentSection, on: hasRecent },
        { node: resetButton, on: true },
      ]
      : [
        { node: titleNode, on: true },
        { node: recentSection, on: hasRecent },
        { node: optionsSection, on: true },
        { node: resetButton, on: true },
      ]
    syncChildren(el, children)
  }

  function render() {
    // ① `v-if`：关掉时整棵真出 DOM（不是 `display:none`）
    if (!state.open) {
      mountNode(host, el, false)
      return
    }
    buildLetters()
    buildRows()
    buildOptions()
    buildRecent()
    paint()
    // 宿主目前是色板独占的，但共用宿主是阶段 5 的高频事故点 —— 一律走 `mountNode`
    mountNode(host, el, true)
  }

  render()

  return {
    el,
    update(patch) {
      if (!patch) return
      Object.keys(patch).forEach((key) => {
        if (key in state) state[key] = patch[key]
      })
      render()
    },
    destroy() {
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
