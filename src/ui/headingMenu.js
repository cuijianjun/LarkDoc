/**
 * 标题级别下拉（正文 + 一~九级标题）—— 原生 DOM 版。
 *
 * 取代 `LarkDocHeadingMenu.vue`（阶段 5 批次 3 删除，全仓无 import 的孤儿文件）：
 * 气泡条自阶段 5 批次 1、工具栏自阶段 5 批次 2 起都走这里，SFC 那份已无调用方，
 * 留着只会让人误以为还有第二套实现。下面这份 `HEADING_MENU_OPTIONS` 是唯一一份选项表，
 * 所以「152px / 32px / 蓝字」那类分叉不会再出现第二次。
 *
 * 飞书观感（断言已锁，见 `scripts/verify-browser-bubble.js` 与
 * `verify-browser-heading-menu.js`）：宽 155、内边距 5、圆角 9、项高 30、
 * 选中项「浅绿底 + 深绿字 + 右侧勾」。这些全在 CSS 里，本模块只负责结构与类名。
 *
 * 纯受控：开关与定位由调用方决定（气泡条走 `bubbleMenuMixin`），
 * 本模块只渲染、只回调。
 */
const HEADING_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

export const HEADING_MENU_OPTIONS = [
  { level: null, glyph: 'T', label: '正文' },
  ...HEADING_NAMES.map((name, index) => ({ level: index + 1, glyph: `H${index + 1}`, label: `${name}级标题` })),
]

/**
 * @param {object} options
 * @param {string} [options.ariaLabel]
 * @param {(level: number|null) => void} [options.onChoose]
 * @param {() => void} [options.onKeepOpen] 鼠标进入弹层 —— 取消延时关闭
 * @param {() => void} [options.onScheduleClose] 鼠标离开弹层 —— 延时关闭
 * @returns {{ el: HTMLDivElement, update(activeLevel: number|null): void, destroy(): void }}
 */
export function createHeadingMenu(options = {}) {
  const { ariaLabel = '标题级别', onChoose, onKeepOpen, onScheduleClose } = options
  const el = document.createElement('div')
  el.className = 'lark-doc-dropdown lark-doc-heading-menu'
  el.setAttribute('role', 'menu')
  el.setAttribute('aria-label', ariaLabel)
  el.addEventListener('mouseenter', () => { if (onKeepOpen) onKeepOpen() })
  el.addEventListener('mouseleave', () => { if (onScheduleClose) onScheduleClose() })

  const rows = HEADING_MENU_OPTIONS.map((option) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.setAttribute('aria-checked', 'false')
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => { if (onChoose) onChoose(option.level) })

    const glyph = document.createElement('span')
    glyph.className = 'lark-doc-heading-glyph'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = option.glyph
    button.appendChild(glyph)
    // 与 SFC 的 `{{ option.label }}` 同构：标签是**文本节点**，不是 span。
    // 断言里量「文字起点」靠的正是 `childNodes` 里那个 nodeType === 3 的节点。
    button.appendChild(document.createTextNode(option.label))

    const check = document.createElement('span')
    check.className = 'lark-doc-menu-check'
    check.setAttribute('aria-hidden', 'true')
    check.textContent = '✓'

    el.appendChild(button)
    return { button, check, level: option.level }
  })

  /**
   * 只改选中态，不重建 DOM。
   * 选中项才插那个 ✓（对应 SFC 的 `v-if`），否则整节点不出现。
   */
  function update(activeLevel) {
    const target = Number.isInteger(activeLevel) ? activeLevel : null
    rows.forEach((row) => {
      const active = row.level === target
      row.button.classList.toggle('lark-doc-menu-active', active)
      row.button.setAttribute('aria-checked', active ? 'true' : 'false')
      if (active && !row.check.parentNode) row.button.appendChild(row.check)
      else if (!active && row.check.parentNode) row.check.remove()
    })
  }

  update(null)

  return {
    el,
    update,
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}
