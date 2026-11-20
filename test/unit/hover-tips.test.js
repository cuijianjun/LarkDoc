// @vitest-environment jsdom
/**
 * 功能栏图标提示的判据（`src/ui/hoverTips.js`）。
 *
 * 三条口径直接对应三组用例：纯图标出 / 有可见中文名不出 / 有下一级弹窗不出。
 * 其中「可见中文名」是关键分界 —— ➕ 菜单「基础」格是**有文本但被 `clip-path: inset(50%)` 藏起来**
 * 的纯图标，按 `textContent` 判会把这一整格全判成「有名称」，一条提示都不出。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindHoverTips, hasNextLevelPopup, hasVisibleText, resolveTarget, tipText } from '../../src/ui/hoverTips'
import { createBubbleBar } from '../../src/ui/bubbleBar'
import { createOutlinePanel } from '../../src/ui/outlinePanel'
import { createBlockHandle } from '../../src/ui/blockHandle'
import { createTableTools } from '../../src/ui/tableTools'
import { createCellPlusTools } from '../../src/ui/cellPlusTools'
import { createImageNodeView } from '../../src/core/nodeviews/image'

const RECT = () => ({ left: 100, top: 100, right: 140, bottom: 130, width: 40, height: 30 })

const iconButton = (label) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', label)
  const icon = document.createElement('span')
  icon.setAttribute('aria-hidden', 'true')
  button.appendChild(icon)
  return button
}

const textButton = (label) => {
  const button = document.createElement('button')
  button.type = 'button'
  const text = document.createElement('span')
  text.className = 'lark-doc-command-label'
  text.textContent = label
  button.appendChild(text)
  return button
}

let host = null
afterEach(() => { vi.useRealTimers(); host?.remove(); host = null })

function mount() {
  host = document.createElement('div')
  host.className = 'lark-doc'
  document.body.appendChild(host)
  return host
}

const hover = (node, root) => node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: root }))

/**
 * jsdom 不执行样式表，`.sr-only` 的 `clip-path` / 1px 尺寸读不到 —— 判据会把
 * 视觉隐藏的名字误当成「可见中文名」。按真实规则就地写内联，等价复现浏览器里的结果。
 */
const srOnly = (node) => {
  node.style.position = 'absolute'
  node.style.width = '1px'
  node.style.height = '1px'
  node.style.overflow = 'hidden'
  node.style.clipPath = 'inset(50%)'
  return node
}

describe('提示判据', () => {
  it('纯图标按钮：有 aria-label 就出提示', () => {
    const button = iconButton('加粗')
    expect(resolveTarget(button)).toBe(button)
    expect(tipText(button)).toBe('加粗')
  })

  it('有可见中文名称：不出提示', () => {
    expect(hasVisibleText(textButton('一级标题'))).toBe(true)
    expect(resolveTarget(textButton('一级标题'))).toBeNull()
  })

  it('中文名被 clip-path 藏起来（➕ 菜单「基础」格）：仍出提示', () => {
    const button = iconButton('代码块')
    const label = document.createElement('span')
    label.className = 'lark-doc-command-label'
    label.textContent = '代码块'
    label.style.clipPath = 'inset(50%)'
    button.appendChild(label)
    expect(hasVisibleText(button)).toBe(false)
    expect(resolveTarget(button)).toBe(button)
  })

  it('sr-only 藏起来的名称同样视作不可见', () => {
    const button = iconButton('分割线')
    const label = document.createElement('span')
    label.textContent = '分割线'
    label.style.position = 'absolute'
    label.style.overflow = 'hidden'
    label.style.width = '1px'
    label.style.height = '1px'
    button.appendChild(label)
    expect(resolveTarget(button)).toBe(button)
  })

  it('有下一级弹窗：caret / aria-haspopup / combobox 都不出', () => {
    const caret = iconButton('选择高亮颜色')
    const arrow = document.createElement('span')
    arrow.className = 'lark-doc-bubble-caret lark-doc-caret'
    caret.appendChild(arrow)
    expect(hasNextLevelPopup(caret)).toBe(true)
    expect(resolveTarget(caret)).toBeNull()

    const popup = iconButton('插入内容')
    popup.setAttribute('aria-haspopup', 'menu')
    expect(resolveTarget(popup)).toBeNull()

    const combo = iconButton('字号')
    combo.setAttribute('role', 'combobox')
    expect(resolveTarget(combo)).toBeNull()

    const submenu = textButton('')
    const carrier = document.createElement('span')
    carrier.className = 'lark-doc-command-submenu-arrow'
    submenu.appendChild(carrier)
    expect(hasNextLevelPopup(submenu)).toBe(true)
  })

  it('显式 data-tooltip-none：主动作控件（六点句柄）带名字也不出', () => {
    const button = iconButton('块操作')
    expect(tipText(button)).toBe('块操作')
    button.setAttribute('data-tooltip-none', '')
    expect(resolveTarget(button)).toBeNull()
  })

  it('连名称都没有的纯图形：不出（没有可说的话）', () => {
    const button = document.createElement('button')
    button.appendChild(document.createElement('span'))
    expect(resolveTarget(button)).toBeNull()
  })

  it('data-tooltip-title 优先于 aria-label（沿用 toolbar 的既有约定）', () => {
    const button = iconButton('加粗')
    button.dataset.tooltipTitle = '加粗 (⌘B)'
    expect(tipText(button)).toBe('加粗 (⌘B)')
  })
})

describe('容器委托', () => {
  it('悬停出提示、移出收起，文案取自 aria-label', () => {
    vi.useFakeTimers()
    const root = mount()
    const button = iconButton('复制选中文字')
    button.getBoundingClientRect = RECT
    root.appendChild(button)
    const tips = bindHoverTips(root)
    try {
      hover(button, root)
      vi.advanceTimersByTime(200)
      const tip = root.querySelector('[role="tooltip"]')
      expect(tip).not.toBeNull()
      expect(tip.textContent).toBe('复制选中文字')

      button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: root }))
      expect(root.querySelector('[role="tooltip"]')).toBeNull()
    } finally { tips.destroy() }
  })

  it('有可见名称的按钮悬停不出提示', () => {
    vi.useFakeTimers()
    const root = mount()
    const button = textButton('有序列表')
    button.getBoundingClientRect = RECT
    root.appendChild(button)
    const tips = bindHoverTips(root)
    try {
      hover(button, root)
      vi.advanceTimersByTime(200)
      expect(root.querySelector('[role="tooltip"]')).toBeNull()
    } finally { tips.destroy() }
  })

  it('后插进容器的按钮不用重绑（气泡条 build() 会清空重建）', () => {
    vi.useFakeTimers()
    const root = mount()
    const tips = bindHoverTips(root)
    try {
      const button = iconButton('高亮')
      button.getBoundingClientRect = RECT
      root.appendChild(button)
      hover(button, root)
      vi.advanceTimersByTime(200)
      expect(root.querySelector('[role="tooltip"]').textContent).toBe('高亮')
    } finally { tips.destroy() }
  })

  it('重复调用拿到同一个句柄，监听不叠加', () => {
    const root = mount()
    const first = bindHoverTips(root)
    const second = bindHoverTips(root)
    try {
      expect(second).toBe(first)
    } finally { first.destroy() }
  })

  it('hide() 立刻收起（功能栏隐藏时调用）', () => {
    vi.useFakeTimers()
    const root = mount()
    const button = iconButton('添加评论')
    button.getBoundingClientRect = RECT
    root.appendChild(button)
    const tips = bindHoverTips(root)
    try {
      hover(button, root)
      vi.advanceTimersByTime(200)
      expect(root.querySelector('[role="tooltip"]')).not.toBeNull()
      tips.hide()
      expect(root.querySelector('[role="tooltip"]')).toBeNull()
    } finally { tips.destroy() }
  })
})

describe('接入 · 气泡条', () => {
  const marks = [
    { id: 'bold', label: '加粗', icon: 'mark-bold' },
    { id: 'italic', label: '斜体', icon: 'mark-italic' },
  ]

  const buildBar = () => {
    const host = mount()
    const ui = createBubbleBar(host, { config: { ai: true, blockStyle: true, highlightAllowed: true, comment: true, marks } })
    ui.update({
      left: 40, top: 40, headingValue: '正文', alignValue: 'left',
      alignItems: ['左', '居中', '右', '两端'].map(name => ({ name, glyph: '·', tooltip: '', active: false })),
      canIncrease: false, canDecrease: false, increaseTooltip: '', decreaseTooltip: '',
      marks: marks.map(item => ({ id: item.id, active: false })), highlightActive: false,
    })
    return { ui, el: host.querySelector('.lark-doc-bubble') }
  }

  it('纯图标按钮出提示，带中文名或带下拉的不出', () => {
    const { ui, el } = buildBar()
    try {
      for (const label of ['加粗', '斜体', '高亮', '复制选中文字', '添加评论']) {
        const node = el.querySelector(`[aria-label="${label}"]`)
        expect(node, label).not.toBeNull()
        expect(resolveTarget(node), label).toBe(node)
      }
      for (const label of ['问问AI', '标题级别', '缩进和对齐', '选择高亮颜色']) {
        const node = el.querySelector(`[aria-label="${label}"]`)
        expect(node, label).not.toBeNull()
        expect(resolveTarget(node), label).toBeNull()
      }
    } finally { ui.destroy() }
  })

  it('build() 重建子节点后提示仍生效（委托挂在根上）', () => {
    vi.useFakeTimers()
    const { ui, el } = buildBar()
    try {
      ui.setConfig({ ai: true, blockStyle: true, highlightAllowed: true, comment: true, marks: [marks[0]] })
      const node = el.querySelector('[aria-label="加粗"]')
      node.getBoundingClientRect = RECT
      hover(node, el)
      vi.advanceTimersByTime(200)
      // 提示层挂在最近的 `.lark-doc` 上，不在气泡条自己体内 —— `build()` 清 children 不会带走它。
      expect(host.querySelector('[role="tooltip"]').textContent).toBe('加粗')
    } finally { ui.destroy() }
  })

  it('按实际浮条尺寸避开右边缘，顶部空间不足时翻到选区下方', () => {
    const { ui, el } = buildBar()
    try {
      el.getBoundingClientRect = () => ({ width: 370, height: 76 })
      ui.update({ left: window.innerWidth - 150, above: 42, below: 70 })
      expect(el.style.left).toBe(`${window.innerWidth - 378}px`)
      expect(el.style.top).toBe('78px')
      ui.update({ left: 24, above: 230, below: 258 })
      expect(el.style.left).toBe('24px')
      expect(el.style.top).toBe('146px')
    } finally { ui.destroy() }
  })
})

it('收起目录提示挂在目录滚动区外，目录关闭时清理提示', () => {
  vi.useFakeTimers()
  const root = mount()
  const outline = createOutlinePanel({ host: root })
  try {
    outline.update({ open: true })
    const trigger = outline.el.querySelector('[aria-label="收起目录"]')
    trigger.getBoundingClientRect = RECT
    hover(trigger, root)
    vi.advanceTimersByTime(200)
    const tip = root.querySelector(':scope > [role="tooltip"]')
    expect(tip?.textContent).toBe('收起目录')
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id)
    outline.update({ open: false })
    expect(root.querySelector('[role="tooltip"]')).toBeNull()
  } finally { outline.destroy() }
})

describe('接入 · 六点句柄与块菜单', () => {
  const buildHandle = (menuPatch = {}) => {
    const host = mount()
    const ui = createBlockHandle({ host, handlers: {} })
    ui.updateChrome({ visible: true, style: null, buttonKind: 'main', glyph: 'T', icon: 'block-text' })
    ui.updateMenu({
      menuOpen: true,
      blockStyle: true,
      features: { ai: true, blockStyle: true, tables: true },
      typeActions: [
        { id: 'paragraph', label: '正文', icon: 'block-text', active: true },
        { id: 'heading1', label: '一级标题', icon: 'block-heading1', active: false },
      ],
      canDuplicate: true,
      alignNames: {},
      ...menuPatch,
    })
    return { ui, host }
  }

  it('句柄本体：六点句柄与空段落 ＋ 都不出提示（悬停直接开菜单）', () => {
    const { ui } = buildHandle()
    try {
      ui.mainEl.querySelectorAll('.sr-only').forEach(srOnly)
      // 用户口径：六点句柄只承载「块操作 + 拖动」，悬停不出提示（飞书同样没有）。
      // 名字仍留 `aria-label` 给读屏，视觉提示靠 `data-tooltip-none` 关掉，也不留原生 `title`。
      expect(ui.mainEl.getAttribute('aria-label')).toBe('块操作')
      expect(ui.mainEl.getAttribute('title')).toBeNull()
      expect(ui.mainEl.hasAttribute('data-tooltip-none')).toBe(true)
      expect(resolveTarget(ui.mainEl)).toBeNull()

      // 空段落 ＋ 走 `aria-haspopup` 跳过，同样不带原生 title
      ui.updateChrome({ visible: true, style: null, buttonKind: 'empty', glyph: 'T', icon: 'block-text' })
      const plus = ui.el.querySelector('.lark-doc-empty-block-insert')
      expect(plus, '空段落插入按钮').not.toBeNull()
      expect(plus.getAttribute('title')).toBeNull()
      expect(resolveTarget(plus)).toBeNull()
    } finally { ui.destroy() }
  })

  it('块菜单：类型网格纯图标出，问问AI / 子菜单触发 / 带中文名的操作不出', () => {
    const { ui } = buildHandle()
    try {
      const menu = ui.menuEl
      menu.querySelectorAll('.sr-only').forEach(srOnly)
      const type = menu.querySelector('[aria-label="正文"]')
      expect(type, '类型网格项').not.toBeNull()
      expect(resolveTarget(type), '类型网格只有 sr-only 名字').toBe(type)

      for (const label of ['问问AI', '创建副本']) {
        const node = menu.querySelector(`[aria-label="${label}"]`)
        expect(node, label).not.toBeNull()
        expect(resolveTarget(node), label).toBeNull()
      }
      // 对齐与颜色是二级菜单触发器 → 不出
      for (const trigger of [ui.alignTrigger, ui.colorTrigger]) {
        expect(resolveTarget(trigger), trigger.getAttribute('aria-label')).toBeNull()
      }
    } finally { ui.destroy() }
  })

  it('菜单收起时提示一并收掉', () => {
    vi.useFakeTimers()
    const { ui, host } = buildHandle()
    try {
      const menu = ui.menuEl
      menu.querySelectorAll('.sr-only').forEach(srOnly)
      const node = menu.querySelector('[aria-label="正文"]')
      node.getBoundingClientRect = RECT
      hover(node, menu)
      vi.advanceTimersByTime(200)
      expect(host.querySelector('[role="tooltip"]')).not.toBeNull()

      ui.updateMenu({ menuOpen: false })
      vi.advanceTimersByTime(200)
      expect(host.querySelector('[role="tooltip"]')).toBeNull()
    } finally { ui.destroy() }
  })
})

describe('接入 · 表格功能条', () => {
  const buildTableTools = () => {
    const host = mount()
    const ui = createTableTools({ host, handlers: {} })
    ui.update({
      open: true, cellKind: 'text', aiVisible: true, commentVisible: true, shareVisible: true,
      canComment: true, anchor: { left: 20, top: 20, width: 120, height: 30 }, active: {},
    })
    return { ui }
  }

  it('纯图标按钮出提示，带中文名与带下拉的不出', () => {
    const { ui } = buildTableTools()
    try {
      for (const label of ['加粗', '斜体', '下划线', '删除线', '行内代码', '插入链接', '添加评论', '分享']) {
        const node = ui.el.querySelector(`[aria-label="${label}"]`)
        expect(node, label).not.toBeNull()
        expect(resolveTarget(node), label).toBe(node)
      }
      for (const label of ['问问AI', '转换为', '对齐与缩进', '字体色 / 背景色', '更多']) {
        const node = ui.el.querySelector(`[aria-label="${label}"]`)
        expect(node, label).not.toBeNull()
        expect(resolveTarget(node), label).toBeNull()
      }
    } finally { ui.destroy() }
  })

  it('浮窗收起时提示一并收掉', () => {
    vi.useFakeTimers()
    const { ui } = buildTableTools()
    try {
      const node = ui.el.querySelector('[aria-label="加粗"]')
      node.getBoundingClientRect = RECT
      hover(node, ui.el)
      vi.advanceTimersByTime(200)
      expect(host.querySelector('[role="tooltip"]')).not.toBeNull()

      ui.update({ open: false })
      vi.advanceTimersByTime(200)
      expect(host.querySelector('[role="tooltip"]')).toBeNull()
    } finally { ui.destroy() }
  })
})

describe('接入 · ➕ 按钮', () => {
  it('空段落 ➕ 与单元格 ➕ 都不出提示（aria-haspopup + 无原生 title）', () => {
    // 空段落：句柄切成 ＋，点开插入命令菜单。
    const host = mount()
    const handle = createBlockHandle({ host, handlers: {} })
    try {
      handle.updateChrome({ visible: true, buttonKind: 'empty' })
      const empty = host.querySelector('.lark-doc-empty-block-insert')
      expect(empty, '空段落 ➕').not.toBeNull()
      expect(empty.getAttribute('aria-haspopup'), '空段落 ➕ 标下一级弹窗').toBe('menu')
      expect(empty.getAttribute('title'), '空段落 ➕ 无原生 title').toBeNull()
      expect(resolveTarget(empty), '空段落 ➕ 不出提示').toBeNull()
    } finally { handle.destroy() }

    // 单元格：左侧 ＋，点开 plus 命令菜单。
    const cellHost = mount()
    const plus = createCellPlusTools({ host: cellHost, handlers: {} })
    try {
      plus.update({ visible: true, left: 0, top: 0 })
      const btn = cellHost.querySelector('.lark-doc-cell-plus-btn')
      expect(btn, '单元格 ➕').not.toBeNull()
      expect(btn.getAttribute('aria-haspopup'), '单元格 ➕ 标下一级弹窗').toBe('menu')
      expect(btn.getAttribute('title'), '单元格 ➕ 无原生 title').toBeNull()
      expect(resolveTarget(btn), '单元格 ➕ 不出提示').toBeNull()
    } finally { plus.destroy() }
  })
})

describe('接入 · 图片功能栏', () => {
  // 只关心工具条 tips，用最小 editor/extension 桩让 NodeView 进入可编辑态即可。
  const buildImageToolbar = (extra = {}) => {
    const host = mount()
    const node = { type: { name: 'image' }, attrs: { src: 'https://cdn.example.com/a.png', align: 'center', caption: '' } }
    const editor = { isEditable: true, isDestroyed: false, on() {}, off() {} }
    const extension = { options: { getOptions: () => ({ aiEnabled: true, onAction: () => {}, ...extra }) } }
    const view = createImageNodeView({ editor, node, view: null, getPos: () => 0, extension })
    view.mountToolbar()
    return { view, host, bar: view.dom.querySelector('.lark-doc-image-toolbar') }
  }

  it('纯图标出提示，「问问AI」有可见中文名不出', () => {
    const { view, bar } = buildImageToolbar()
    try {
      expect(bar, '图片工具条').not.toBeNull()
      for (const label of ['裁剪', '编辑图片说明', '左对齐', '居中对齐', '右对齐', '分享图片', '复制图片链接']) {
        const node = bar.querySelector(`[aria-label="${label}"]`)
        expect(node, label).not.toBeNull()
        expect(resolveTarget(node), label).toBe(node)
      }
      expect(bar.querySelector('[aria-label="添加评论"]')).toBeNull()
      const ask = bar.querySelector('[aria-label="问问AI"]')
      expect(ask, '问问AI').not.toBeNull()
      expect(resolveTarget(ask), '问问AI 有中文名不出').toBeNull()
    } finally { view.destroy() }
  })

  it('工具条卸载后提示一并收掉（不残留浮层）', () => {
    vi.useFakeTimers()
    const { view, host, bar } = buildImageToolbar()
    try {
      host.appendChild(view.dom)
      const node = bar.querySelector('[aria-label="裁剪"]')
      node.getBoundingClientRect = RECT
      hover(node, bar)
      vi.advanceTimersByTime(200)
      expect(host.querySelector('[role="tooltip"]').textContent).toBe('裁剪')

      view.unmountToolbar()
      expect(host.querySelector('[role="tooltip"]')).toBeNull()
    } finally { view.destroy() }
  })
})
