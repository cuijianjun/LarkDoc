/* 独立自测：不引用 scripts/verify-browser-table-tools.js 的任何断言或辅助函数。
   真实鼠标操作 + 前提校验（前提不成立记 INVALID，不算 PASS）+ 截图取证。

   v11「飞书统一浮窗」契约：全页唯一 `.lark-doc-table-tools`，无 data-mode /
   is-text-mode / is-table-mode；同一条 bar 按选区上下文真摘除/插入按钮。
   v12c 后三态项数为：文字态 A 10 个 data-cmd / 整行整列态 B 13 个 /
   多格拖选态 E 11 个，三态共用同一个浮窗 DOM 根节点。`table-ops` 按钮彻底删除，
   表格结构能力走边界 ＋ / remove / merge-cell 真实入口；图标与下拉箭头统一到顶部
   功能栏 iconNode() 那一套，下拉 hover/focus 打开 + 150ms 延迟关；「更多」裁到 2 项。
   本文件除同步浮窗断言外，另补功能可用性断言（真实命令效果 + S14 图标/下拉组）。
   v12 三条反馈（ask-ai 移除 / 复制选区链接入口收敛 / remove 按 selectedRect 删除）
   由独立段 S15 用真实鼠标 + 可观测证据单独验证。
   v12 第 4 条反馈「选中两个单元格或者多个，功能栏浮窗的按钮不对」由 S16 验证：
   真实鼠标按下 → 拖过单元格边界 → 抬起，产生非整行/整列 CellSelection（第三种
   上下文 multi，组件 state.cellKind === 'multi'），v12c 后浮窗 11 个 data-cmd
   （EXPECTED_CMDS_E：merge-cell/cell-bg 开头无 table-header、无 link、末尾收在
   more），bar 子节点 14 个 = 11 button + 3 span（1 条 .is-full），并验证
   merge/split 真生效、浮窗锚点几何、line→multi 切换后旧列残留标记清理。
   v12c 两条反馈由 S13a / S15b / S18 验证：确认「复制选区链接」「评论」无真实功能后
   把两颗按钮从三态整体下线（S13a 反向断言、S15b 改为「零入口」、S18 三态复查），
   并把浮窗按钮点击盒从 24×30 放大到 30×30 与顶部功能栏对齐（图标仍同 16×16）。
   v12d 反馈由 S19 验证：按飞书真源两张截图给边界 ＋ 加同款悬浮提示 —— 列 ＋ →「插入列」、
   行 ＋ →「插入行」（深底白字 + 朝下箭头，hover ＋ 150ms 后出现、离开即收；
   原生 title 同步移除，防浏览器原生 tooltip 双重弹出）。

   跑法（需先启动静态服务并构建产物）：
     python3 -m http.server 8123 --bind 127.0.0.1
     NODE_PATH=<playwright-core 所在 node_modules> \
       node scripts/selftest-table-interaction.cjs \
       http://127.0.0.1:8123/examples/element-demo.html?v=v11
   输出目录可用 SELFTEST_OUT 覆盖；截图与 selftest-result.json 落在那里。
   退出码：有 FAIL / INVALID 时 1，全 PASS 时 0。 */
const { chromium } = require('playwright-core')
const fs = require('fs')
const os = require('os')
const path = require('path')

const URL = process.argv[2] || 'http://127.0.0.1:8123/examples/element-demo.html?v=selftest'
const OUT = process.env.SELFTEST_OUT || path.join(os.tmpdir(), 'lark-doc-selftest')
fs.mkdirSync(OUT, { recursive: true })
const rows = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// v12c 契约常量：飞书单行工具条三态 data-cmd 固定顺序（文字态 10 / 选择条态 13 /
// 拖选多格 multi 态 11；share-link / comment 两颗无实现按钮已从三态全部摘除）、
// 两态共有基础项 / A 独有 / B 独有、5 个 mark 按钮、4 个 caret 菜单按钮、3 颗表格
// 专属按钮、「更多」保留 2 项与被删 4 项、turninto 11 项（+1 分隔线＝飞书 12 项）、align 8 项。
const EXPECTED_CMDS_A = [
  'turninto', 'align', 'bold', 'strike', 'italic', 'underline',
  'link', 'code', 'highlight', 'more',
]
const EXPECTED_CMDS_B = [
  'table-header', 'merge-cell', 'cell-bg', 'turninto', 'align',
  'bold', 'strike', 'italic', 'underline', 'code', 'highlight', 'more', 'remove',
]
// v12 第 4 条 / v12c：拖选两个及以上单元格（multi 态）11 项 —— merge-cell/cell-bg
// 开头（无 table-header），无 link，末尾收在 more（不是 remove、也不是已下线的 comment）。
const EXPECTED_CMDS_E = [
  'merge-cell', 'cell-bg', 'turninto', 'align', 'bold', 'strike',
  'italic', 'underline', 'code', 'highlight', 'more',
]
// multi 态 bar 子节点 14 个 = 11 button + 3 span（1 条 .is-full 全高分隔线）。
const EXPECTED_BAR_TAGS_E = [
  'button', 'button', 'span', 'button', 'button', 'span', 'button', 'button',
  'button', 'button', 'button', 'button', 'span', 'button',
]
const BASE_CMDS = [
  'turninto', 'align', 'bold', 'strike', 'italic', 'underline',
  'code', 'highlight', 'more',
]
const A_ONLY_CMDS = ['link']
const B_ONLY_CMDS = ['table-header', 'merge-cell', 'cell-bg', 'remove']
const MARK_CMDS = ['bold', 'strike', 'italic', 'underline', 'code']
const CARET_CMDS = ['turninto', 'align', 'highlight', 'more']
const TABLE_ONLY_CMDS = ['table-header', 'merge-cell', 'cell-bg']
const MORE_ITEMS = ['translate', 'larkSearch']
const MORE_REMOVED = ['searchWeb', 'saveBlockTemplate', 'newChildDocWithContent', 'create-lingo']
const TURN_INTO_ITEMS = [
  'paragraph', 'heading1', 'heading2', 'heading3', 'orderedList', 'bulletList',
  'taskList', 'codeBlock', 'blockquote', 'callout', 'synced',
]
const ALIGN_ITEMS = [
  'align:left', 'align:center', 'align:right', 'valign:top', 'valign:middle',
  'valign:bottom', 'indent:1', 'indent:-1',
]

// 用户截图式 3 列窄表格：wrapper 比 table 宽，正是上一轮假阳性的触发场景。
// resetDoc 用同一份 HTML，保证几何（geo / cellMid / geo.out）在每次重置后仍然有效。
const DOC = '<p>uploadImage / ai / providers 这类对象能力走 providers</p><table><tbody>' +
  '<tr><th><p>列一</p></th><th><p>列二</p></th><th><p>列三</p></th></tr>' +
  '<tr><td><p>甲一</p></td><td><p>甲二</p></td><td><p>甲三</p></td></tr>' +
  '<tr><td><p>乙一</p></td><td><p>乙二</p></td><td><p>乙三</p></td></tr>' +
  '</tbody></table><p>表后正文，用来点击外部</p>'

function chromiumExe() {
  const cache = path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
  const dir = fs.readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort().pop()
  for (const c of [
    path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  ]) if (fs.existsSync(c)) return c
  return undefined
}

function rec(id, name, precondition, ok, detail) {
  const status = !precondition ? 'INVALID' : ok ? 'PASS' : 'FAIL'
  rows.push({ id, status, name, detail })
  console.log(`${status.padEnd(7)} [${id}] ${name} — ${detail}`)
}

/**
 * v11 统一浮窗 DOM 快照（自包含，序列化进 page.evaluate 执行）。
 * 未挂载时也给出全页计数，才能验「全页唯一浮窗」这条最高优先级契约。
 * v11 新增：同一根节点身份标记、按钮 SVG 图标 / caret / 字符 glyph 残留、
 * table-ops 与 action:* 残留、菜单项明细（图标 / pressed / disabled / 分隔线）。
 */
const toolbarSnap = (page) => page.evaluate(() => {
  const nodes = document.querySelectorAll('.lark-doc-table-tools')
  const legacy = document.querySelectorAll('.lark-doc-table-float')
  const out = {
    count: nodes.length, legacy: legacy.length,
    bubbles: document.querySelectorAll('.lark-doc-bubble').length,
    allMenuNodes: document.querySelectorAll('.lark-doc-table-tools-menu[data-menu]').length,
    node: null,
  }
  if (!nodes.length) return out
  const el = nodes[0]
  const rootChildren = [...el.children]
  const bar = el.querySelector('.lark-doc-table-tools-bar')
  const barChildren = bar ? [...bar.children] : []
  const menus = [...el.querySelectorAll('.lark-doc-table-tools-menu[data-menu]')]
  const menu = menus[0] || null
  const buttons = barChildren.filter((n) => n.tagName === 'BUTTON' && n.classList.contains('lark-doc-table-tools-btn'))
  const seps = barChildren.filter((n) => n.classList.contains('lark-doc-table-tools-sep'))
  out.node = {
    tag: el.tagName.toLowerCase(),
    classes: [...el.classList],
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    hasModeAttr: el.hasAttribute('data-mode'),
    mode: el.dataset.mode || null,
    // 状态 A 给根节点打身份标记，切到 B 仍在 → 证明两态复用同一个 DOM 根节点。
    rootMarker: el.getAttribute('data-selftest-root'),
    hasBar: !!bar,
    barCount: rootChildren.filter((n) => n.classList.contains('lark-doc-table-tools-bar')).length,
    rootChildTags: rootChildren.map((n) => n.tagName.toLowerCase()),
    menuCount: menus.length,
    menuName: menu ? menu.dataset.menu : null,
    menuRole: menu ? menu.getAttribute('role') : null,
    menuAttached: !!menu && menu.parentNode === el,
    menuItems: menu ? [...menu.querySelectorAll('button.lark-doc-table-tools-menu-item')].map((b) => b.dataset.value || null) : [],
    menuItemDetails: menu ? [...menu.querySelectorAll('button.lark-doc-table-tools-menu-item')].map((b) => ({
      value: b.dataset.value || null,
      pressed: b.getAttribute('aria-pressed'),
      disabled: b.disabled,
      menuIconOk: (() => {
        const i = b.querySelector('span.lark-doc-table-tools-menu-icon.lark-doc-icon')
        return !!i && i.querySelectorAll('svg').length === 1
      })(),
    })) : [],
    menuDividers: menu ? menu.querySelectorAll('.lark-doc-table-tools-menu-divider').length : 0,
    colorItems: menu ? [...menu.querySelectorAll('button.lark-doc-table-tools-color')].map((b) => b.dataset.value || null) : [],
    // v11：table-ops 被彻底删除，任何 action:* / data-menu=table-ops / data-cmd=table-ops 都不该在。
    tableOpsButtons: el.querySelectorAll('.lark-doc-table-tools-btn[data-cmd="table-ops"]').length,
    tableOpsMenus: el.querySelectorAll('.lark-doc-table-tools-menu[data-menu="table-ops"]').length,
    actionValues: [...el.querySelectorAll('[data-value^="action:"]')].map((n) => n.getAttribute('data-value')),
    glyphNodes: el.querySelectorAll('.lark-doc-table-tools-glyph').length,
    legacyCaretNodes: el.querySelectorAll('.lark-doc-table-tools-caret').length,
    iconNodes: el.querySelectorAll('span.lark-doc-table-tools-icon.lark-doc-icon > svg').length,
    caretNodes: el.querySelectorAll('span.lark-doc-caret.lark-doc-icon > svg').length,
    buttons: buttons.map((b) => {
      const icon = b.querySelector('span.lark-doc-table-tools-icon.lark-doc-icon')
      const caret = b.querySelector('span.lark-doc-caret.lark-doc-icon')
      return {
        cmd: b.dataset.cmd || null,
        title: b.getAttribute('title'),
        ariaLabel: b.getAttribute('aria-label'),
        pressed: b.getAttribute('aria-pressed'),
        hasPressed: b.hasAttribute('aria-pressed'),
        isActive: b.classList.contains('is-active'),
        haspopup: b.getAttribute('aria-haspopup'),
        expanded: b.getAttribute('aria-expanded'),
        isMenuOpen: b.classList.contains('is-menu-open'),
        hasCaret: b.classList.contains('has-caret'),
        // v11：按钮图标 = iconNode() 的 span.lark-doc-icon > svg（16×16）；caret 是 12px SVG。
        iconOk: !!icon && icon.style.width === '16px' && icon.style.height === '16px'
          && icon.querySelectorAll('svg').length === 1
          && !b.querySelector('.lark-doc-table-tools-glyph'),
        caretOk: !!caret && caret.style.width === '12px' && caret.style.height === '12px'
          && caret.querySelectorAll('svg').length === 1
          && !b.querySelector('.lark-doc-table-tools-caret'),
        hasCaretSpan: !!caret,
      }
    }),
    cmds: buttons.map((b) => b.dataset.cmd || null),
    separators: seps.length,
    fullSeparators: seps.filter((s) => s.classList.contains('is-full')).length,
  }
  return out
})

/** 真实鼠标：点回表格复位 dismiss 闸门 → 拖拽选中表格内非空文字 → 统一浮窗应出现。 */
const openTextSel = async (page, cellMid) => {
  await page.mouse.click(cellMid.x, cellMid.y)
  await wait(250)
  const tr = await page.evaluate(() => {
    const p = document.querySelector('.ProseMirror table td p')
    if (!p) return null
    // 上过色/加过 mark 之后 firstChild 会是 <span>，对元素 setEnd(2) 会抛
    // IndexSizeError（它只有 1 个子节点）。统一取最深文本节点，保证选区可复现。
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode()
    if (!node || !node.length) return null
    const rg = document.createRange()
    rg.setStart(node, 0)
    rg.setEnd(node, Math.min(2, node.length))
    const r = rg.getBoundingClientRect()
    return { x1: r.left + 1, x2: r.right - 1, y: r.top + r.height / 2 }
  })
  if (tr) {
    await page.mouse.move(tr.x1, tr.y)
    await page.mouse.down()
    await page.mouse.move(tr.x2, tr.y, { steps: 10 })
    await page.mouse.up()
    await wait(550)
  }
  const selText = await page.evaluate(() => String(window.getSelection()?.toString() || ''))
  return { tr, selText }
}

/** 真实鼠标：点进表格 → 点列选择条（整列 CellSelection）→ 同一个统一浮窗。 */
const openCellSel = async (page, cellMid) => {
  await page.mouse.click(cellMid.x, cellMid.y)
  await wait(400)
  const pt = await page.evaluate(() => {
    const n = document.querySelector('.lark-doc-table-selector.is-column')
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (pt) { await page.mouse.click(pt.x, pt.y); await wait(500) }
  return pt
}

const resetDoc = async (page) => {
  await page.evaluate((html) => {
    const h = window.__larkDoc || document.querySelector('lark-doc')
    h.setContent(html)
  }, DOC)
  // 与原始首屏一致：等字体/layout 稳定后再量几何，否则 geo/cellMid 会偏。
  await wait(700)
}

// 工具条按钮 / 菜单项点击走 DOM click（与 verify-browser-table-tools.js 一致）：不产生
// pointerdown，故不会误触发「点外部收起」，但会真实派发 click → 命令 → 编辑器事务。
const clickCmd = (page, cmd) => page.evaluate((c) => {
  const btn = document.querySelector(`.lark-doc-table-tools-btn[data-cmd="${c}"]`)
  if (btn) btn.click()
  return !!btn
}, cmd)

const clickMenuItem = (page, menu, value) => page.evaluate(({ m, v }) => {
  const item = document.querySelector(`.lark-doc-table-tools-menu[data-menu="${m}"] button.lark-doc-table-tools-menu-item[data-value="${v}"]`)
  if (item) item.click()
  return !!item
}, { m: menu, v: value })

/** v11 下拉：真鼠标 hover 用得到按钮 / 菜单中心点（DOM 快照里没有几何）。 */
const btnCenter = (page, cmd) => page.evaluate((c) => {
  const b = document.querySelector(`.lark-doc-table-tools-btn[data-cmd="${c}"]`)
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, cmd)
const menuCenter = (page) => page.evaluate(() => {
  const m = document.querySelector('.lark-doc-table-tools-menu[data-menu]')
  if (!m) return null
  const r = m.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
/** 清掉上一次残留的 hover：把鼠标挪到页面角落，等一帧再取按钮几何。 */
const parkMouse = async (page) => { await page.mouse.move(8, 8); await wait(180) }

const boldState = (page) => page.evaluate(() => {
  const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="bold"]')
  const ed = (window.__larkDoc || document.querySelector('lark-doc')).getEditor()
  return {
    hasBtn: !!btn,
    pressed: btn ? btn.getAttribute('aria-pressed') : null,
    isActive: btn ? btn.classList.contains('is-active') : false,
    editorActive: ed.isActive('bold'),
    strong: document.querySelectorAll('.ProseMirror table strong').length,
  }
})

const headingState = (page) => page.evaluate(() => {
  const ed = (window.__larkDoc || document.querySelector('lark-doc')).getEditor()
  let blockTag = null
  try {
    const dom = ed.view.domAtPos(ed.state.selection.from).node
    const el = dom?.nodeType === 1 ? dom : dom?.parentElement
    blockTag = el?.closest?.('h1,h2,h3,h4,h5,h6,p')?.tagName || null
  } catch { blockTag = null }
  return {
    editorActive: ed.isActive('heading'),
    h1Count: document.querySelectorAll('.ProseMirror h1').length,
    blockTag,
  }
})

const alignState = (page) => page.evaluate(() => {
  const p = document.querySelector('.ProseMirror table td p')
  const ed = (window.__larkDoc || document.querySelector('lark-doc')).getEditor()
  let nodeAlign = null
  try { nodeAlign = ed.state.selection.$from.parent?.attrs?.textAlign ?? null } catch { nodeAlign = null }
  return {
    computed: p ? getComputedStyle(p).textAlign : null,
    inline: p ? p.style.textAlign : null,
    nodeAlign,
  }
})

const state = (page) => page.evaluate(() => {
  const shown = (n) => {
    if (!n) return false
    const c = getComputedStyle(n)
    return c.display !== 'none' && c.visibility !== 'hidden' && parseFloat(c.opacity) > 0.01
  }
  const vis = (n) => {
    if (!shown(n)) return false
    const r = n.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const tools = [...document.querySelectorAll('.lark-doc-table-tools')].filter(vis)
  const bubbles = [...document.querySelectorAll('.lark-doc-bubble')].filter(vis)
  const floats = [...document.querySelectorAll('.lark-doc-table-float')].filter(vis)
  const selectors = [...document.querySelectorAll('.lark-doc-table-selector')].filter(vis)
  const handles = [...document.querySelectorAll('.column-resize-handle')]
  const capsules = handles.filter((n) => {
    const a = getComputedStyle(n, '::after')
    return a.content !== 'none' && parseFloat(a.opacity) > 0.05 && a.backgroundColor !== 'rgba(0, 0, 0, 0)'
  }).length
  // 边界工具容器是零尺寸定位壳（宽高靠绝对定位子元素），不能用 rect 宽高判显隐
  const wrap = document.querySelector('.lark-doc-table-boundary-tools')
  const wrapShown = shown(wrap)
  const line = wrapShown ? wrap.querySelector('.lark-doc-table-boundary-line') : null
  const plus = wrapShown ? wrap.querySelector('button') : null
  const tr = document.querySelector('.ProseMirror table')?.getBoundingClientRect()
  const lr = line?.getBoundingClientRect()
  const selRects = selectors.map((n) => {
    const r = n.getBoundingClientRect()
    return { cls: String(n.className), l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) }
  })
  return {
    // v11：mode 恒为 null / hasModeAttr 恒为 false，专供「必须不存在」的断言取证。
    tools: tools.length, mode: tools[0]?.dataset?.mode || null,
    hasModeAttr: tools[0]?.hasAttribute('data-mode') || false,
    bubbles: bubbles.length, floats: floats.length,
    selectors: selectors.length, selRects,
    handles: handles.length, capsules,
    resizeCursor: !!document.querySelector('.ProseMirror.resize-cursor'),
    boundaryOpen: wrapShown, plus: !!plus,
    lineClass: line?.className || null,
    lineW: lr ? +lr.width.toFixed(1) : null,
    lineH: lr ? +lr.height.toFixed(1) : null,
    lineRight: lr ? +lr.right.toFixed(1) : null,
    tableW: tr ? +tr.width.toFixed(1) : null,
    tableH: tr ? +tr.height.toFixed(1) : null,
    tableRight: tr ? +tr.right.toFixed(1) : null,
    tableLeft: tr ? +tr.left.toFixed(1) : null,
    tableTop: tr ? +tr.top.toFixed(1) : null,
    tableBottom: tr ? +tr.bottom.toFixed(1) : null,
    plusBg: plus ? getComputedStyle(plus).backgroundColor : null,
    plusShadow: plus ? getComputedStyle(plus, '::before').boxShadow : null,
    plusBeforeBg: plus ? getComputedStyle(plus, '::before').backgroundColor : null,
  }
})

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExe() })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 160)) })

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!(window.__larkDoc || document.querySelector('lark-doc'))?.getEditor?.(), null, { timeout: 20000 })

  await resetDoc(page)

  const geo = await page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table').getBoundingClientRect()
    const td = document.querySelector('.ProseMirror table td').getBoundingClientRect()
    const w = document.querySelector('.tableWrapper')?.getBoundingClientRect()
    const out = [...document.querySelectorAll('.ProseMirror > p')].pop().getBoundingClientRect()
    return {
      table: { l: t.left, t: t.top, r: t.right, b: t.bottom, w: t.width, h: t.height },
      td: { l: td.left, t: td.top, r: td.right, b: td.bottom },
      wrapW: w ? +w.width.toFixed(1) : null,
      out: { x: out.left + 40, y: out.top + out.height / 2 },
    }
  })
  console.log(`几何: table=${geo.table.w}x${geo.table.h} wrapper=${geo.wrapW} (wrapper 必须 > table，否则本自测场景无效)\n`)

  const clip = {
    x: Math.max(0, geo.table.l - 100), y: Math.max(0, geo.table.t - 100),
    width: Math.min(760, geo.table.w + 300), height: Math.min(440, geo.table.h + 200),
  }

  // ── S1 纯 hover 单元格中部（不点击）
  const cellMid = { x: geo.td.l + 28, y: geo.td.t + 16 }
  await page.mouse.move(cellMid.x, cellMid.y)
  await wait(550)
  let s = await state(page)
  rec('S1a', '反馈②：悬浮表格（未点击）不出现行列高亮条', geo.wrapW > geo.table.w + 20, s.selectors === 0, `selectors=${s.selectors} tools=${s.tools} bubbles=${s.bubbles}`)
  rec('S1b', '反馈①：悬浮单元格中部无蓝色胶囊', true, s.capsules === 0, `handles=${s.handles} capsules=${s.capsules}`)
  rec('S1c', '未点击时无任何功能浮窗', true, s.tools === 0 && s.bubbles === 0 && s.floats === 0, `tools=${s.tools} bubbles=${s.bubbles} floats=${s.floats}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-1-hover-cell.png'), clip })

  // ── S2 hover 列边界：手柄必须真的渲染，否则判定作废
  await page.mouse.move(geo.td.r - 2, geo.td.t + 18)
  await wait(600)
  s = await state(page)
  const edgeValid = s.handles > 0
  rec('S2a', '反馈①：靠近列边界（resize 手柄已渲染）时仍无蓝色胶囊', edgeValid, s.capsules === 0, `handles=${s.handles} resizeCursor=${s.resizeCursor} capsules=${s.capsules}`)
  rec('S2b', '反馈⑦：悬浮两格交界处＝高亮线＋＋号', edgeValid, s.boundaryOpen && s.plus && /is-column-line/.test(s.lineClass || ''), `open=${s.boundaryOpen} plus=${s.plus} line=${s.lineClass}`)
  rec('S2c', '第二轮②：列边界竖线高度不超过表格高', edgeValid && s.lineH !== null, s.lineH <= s.tableH + 1, `line.h=${s.lineH} table.h=${s.tableH}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-2-column-edge.png'), clip })

  // ── S3 hover ＋：校验鼠标确实压在按钮上
  const plusPt = await page.evaluate(() => {
    const b = document.querySelector('.lark-doc-table-boundary-tools button')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (plusPt) { await page.mouse.move(plusPt.x, plusPt.y); await wait(450) }
  const hoverPlus = plusPt ? await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    return !!(el && el.closest('.lark-doc-table-boundary-tools button'))
  }, plusPt) : false
  s = await state(page)
  rec('S3a', '反馈⑥：hover ＋ 时 32px 按钮自身透明（无外圈浅绿圆）', !!plusPt && hoverPlus, /rgba\(0, 0, 0, 0\)|transparent/.test(s.plusBg || ''), `plusBg=${s.plusBg} hover命中=${hoverPlus}`)
  rec('S3b', '反馈⑥：＋按钮 ::before 无 box-shadow 光晕', !!plusPt && hoverPlus, s.plusShadow === 'none', `shadow=${s.plusShadow} beforeBg=${s.plusBeforeBg}`)
  if (plusPt) {
    await page.screenshot({ path: path.join(OUT, 'selftest-3-plus.png'), clip: { x: plusPt.x - 110, y: plusPt.y - 95, width: 300, height: 220 } })
  }
  fs.writeFileSync(path.join(OUT, 'selftest-plus-center.json'), JSON.stringify({ plusPt, plusBg: s.plusBg, shadow: s.plusShadow }))

  // ── S4 hover 行边界：横线宽度不超过表格宽（上一轮真 bug）
  await page.mouse.move(geo.td.l + 30, geo.td.b - 2)
  await wait(550)
  s = await state(page)
  rec('S4a', '第二轮②：行边界横线宽度/右端不超过表格', s.boundaryOpen && s.lineW !== null,
    s.lineW <= s.tableW + 1 && s.lineRight <= s.tableRight + 1,
    `line.w=${s.lineW} table.w=${s.tableW} line.right=${s.lineRight} table.right=${s.tableRight} wrapper.w=${geo.wrapW}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-4-row-edge.png'), clip })

  // ── S5 点击表格 → 高亮条出现，且选择条几何不越界
  await page.mouse.click(cellMid.x, cellMid.y)
  await wait(500)
  s = await state(page)
  rec('S5a', '反馈②：点击表格后行列高亮条出现', true, s.selectors > 0, `selectors=${s.selectors}`)
  const colOverflow = s.selRects.filter((r) => /is-column/.test(r.cls) && (r.l < s.tableLeft - 1 || r.r > s.tableRight + 1))
  const rowOverflow = s.selRects.filter((r) => /is-row/.test(r.cls) && (r.t < s.tableTop - 1 || r.b > s.tableBottom + 1))
  rec('S5b', '第二轮②：所有列/行选择条未超出表格边界', s.selectors > 0, colOverflow.length === 0 && rowOverflow.length === 0,
    `列越界=${colOverflow.length} 行越界=${rowOverflow.length} 共${s.selectors}条；样本=${JSON.stringify(s.selRects.slice(0, 2))}`)

  // ── S6 点列选择条 → v11 统一浮窗（状态 B：全页唯一、无 data-mode、13 个 data-cmd）
  const selPt = await page.evaluate(() => {
    const n = document.querySelector('.lark-doc-table-selector.is-column')
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (selPt) { await page.mouse.click(selPt.x, selPt.y); await wait(550) }
  // 给唯一浮窗根节点打身份标记：后续状态 A / 切回状态 B 都必须是同一个 DOM 节点。
  const rootMarked = await page.evaluate(() => {
    const el = document.querySelector('.lark-doc-table-tools')
    if (!el) return false
    el.setAttribute('data-selftest-root', 'A1')
    return true
  })
  s = await state(page)
  const snapSelBar = await toolbarSnap(page)
  rec('S6a', 'v12c：点列选择条 → 全页仅 1 个统一浮窗、无 data-mode、13 个 data-cmd 齐全（状态 B）', !!selPt && rootMarked,
    snapSelBar.count === 1 && snapSelBar.legacy === 0 && !!snapSelBar.node
      && !snapSelBar.node.hasModeAttr && snapSelBar.node.mode === null
      && !snapSelBar.node.classes.includes('is-text-mode') && !snapSelBar.node.classes.includes('is-table-mode')
      && snapSelBar.node.rootMarker === 'A1'
      && JSON.stringify(snapSelBar.node.cmds) === JSON.stringify(EXPECTED_CMDS_B)
      && s.bubbles === 0 && s.floats === 0,
    `tools=${snapSelBar.count} legacy=${snapSelBar.legacy} hasModeAttr=${s.hasModeAttr} rootMarker=${snapSelBar.node?.rootMarker} cmdCount=${snapSelBar.node?.cmds.length}/13 cmdOrderOk=${JSON.stringify(snapSelBar.node?.cmds) === JSON.stringify(EXPECTED_CMDS_B)} bubbles=${s.bubbles} floats=${s.floats}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-6-table-toolbar.png'), clip })

  // ── S7 点表格外任意位置 → 浮窗消失
  await page.mouse.click(geo.out.x, geo.out.y)
  await wait(450)
  s = await state(page)
  rec('S7a', '反馈③：点击其他地方浮窗消失', true, s.tools === 0 && s.bubbles === 0, `tools=${s.tools} bubbles=${s.bubbles}`)

  // ── S8 真实鼠标拖拽选中表格内文字 → v11 统一浮窗（状态 A，仍是同一个根节点）
  await page.mouse.click(cellMid.x, cellMid.y)
  await wait(250)
  const textRange = await page.evaluate(() => {
    const p = document.querySelector('.ProseMirror table td p')
    const node = p?.firstChild
    if (!node || !node.textContent) return null
    const rg = document.createRange()
    rg.setStart(node, 0)
    rg.setEnd(node, Math.min(2, node.textContent.length))
    const r = rg.getBoundingClientRect()
    return { x1: r.left + 1, x2: r.right - 1, y: r.top + r.height / 2 }
  })
  if (textRange) {
    await page.mouse.move(textRange.x1, textRange.y)
    await page.mouse.down()
    await page.mouse.move(textRange.x2, textRange.y, { steps: 10 })
    await page.mouse.up()
    await wait(600)
  }
  s = await state(page)
  const selText = await page.evaluate(() => String(window.getSelection()?.toString() || ''))
  const snapText = await toolbarSnap(page)
  rec('S8a', 'v12c：真实拖拽选文字 → 全页仅 1 个统一浮窗、无 data-mode、10 个 data-cmd 齐全（状态 A / 同一根节点）', !!textRange && selText.length > 0,
    snapText.count === 1 && snapText.legacy === 0 && !!snapText.node
      && !snapText.node.hasModeAttr && snapText.node.mode === null
      && !snapText.node.classes.includes('is-text-mode') && !snapText.node.classes.includes('is-table-mode')
      && snapText.node.rootMarker === 'A1'
      && JSON.stringify(snapText.node.cmds) === JSON.stringify(EXPECTED_CMDS_A)
      && s.bubbles === 0 && s.floats === 0,
    `选中="${selText}" tools=${snapText.count} legacy=${snapText.legacy} hasModeAttr=${s.hasModeAttr} rootMarker=${snapText.node?.rootMarker} cmdCount=${snapText.node?.cmds.length}/10 cmdOrderOk=${JSON.stringify(snapText.node?.cmds) === JSON.stringify(EXPECTED_CMDS_A)} bubbles=${s.bubbles} floats=${s.floats}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-8-text-toolbar.png'), clip })
  await page.mouse.click(geo.out.x, geo.out.y)
  await wait(400)
  s = await state(page)
  rec('S8b', '反馈④：点其他地方文字弹窗消失', true, s.tools === 0 && s.bubbles === 0, `tools=${s.tools} bubbles=${s.bubbles}`)

  // ── S9 压力：v11 统一浮窗未关时直接点选择条，不得出现两个；两态按上下文真摘除/插入
  await page.mouse.click(cellMid.x, cellMid.y)
  await wait(200)
  if (textRange) {
    await page.mouse.move(textRange.x1, textRange.y)
    await page.mouse.down()
    await page.mouse.move(textRange.x2, textRange.y, { steps: 10 })
    await page.mouse.up()
    await wait(450)
  }
  const before = await state(page)
  const snapBefore = await toolbarSnap(page)
  if (selPt) { await page.mouse.click(selPt.x, selPt.y); await wait(500) }
  s = await state(page)
  const snapAfter = await toolbarSnap(page)
  const twoStateSwitchOk = !!snapBefore.node && !!snapAfter.node
    && snapBefore.node.rootMarker === 'A1' && snapAfter.node.rootMarker === 'A1'
    && JSON.stringify(snapBefore.node.cmds) === JSON.stringify(EXPECTED_CMDS_A)
    && JSON.stringify(snapAfter.node.cmds) === JSON.stringify(EXPECTED_CMDS_B)
  rec('S9a', 'v12c：统一浮窗打开时点选择条 → 仍仅 1 个浮窗、无 data-mode、同一根节点（A 10 → B 13 真摘除/插入）',
    before.tools === 1 && !!selPt && !!snapBefore.node,
    snapAfter.count === 1 && snapAfter.legacy === 0 && s.bubbles === 0 && s.floats === 0
      && !!snapAfter.node && !snapAfter.node.hasModeAttr && snapAfter.node.mode === null
      && twoStateSwitchOk,
    `切换前 tools=${snapBefore.count}/cmd=${snapBefore.node?.cmds.length}/root=${snapBefore.node?.rootMarker} → 切换后 tools=${snapAfter.count}/cmd=${snapAfter.node?.cmds.length}/root=${snapAfter.node?.rootMarker} hasModeAttr=${s.hasModeAttr} 两态按清单切换=${twoStateSwitchOk} bubbles=${s.bubbles} floats=${s.floats}`)

  // ══════════ S12 v11 统一浮窗：功能可用性断言（真实鼠标 + 真实命令效果）══════════
  // S12a 两态共用同一根节点 + 基础项一致 + 差异项严格按 A/B 清单（不再要求两态集合一致）。
  const crossBothOne = snapText.count === 1 && snapText.legacy === 0 && snapSelBar.count === 1 && snapSelBar.legacy === 0
  const crossNoMode = !!snapText.node && !!snapSelBar.node
    && !snapText.node.hasModeAttr && snapText.node.mode === null
    && !snapSelBar.node.hasModeAttr && snapSelBar.node.mode === null
    && !snapText.node.classes.includes('is-text-mode') && !snapText.node.classes.includes('is-table-mode')
    && !snapSelBar.node.classes.includes('is-text-mode') && !snapSelBar.node.classes.includes('is-table-mode')
  const crossSameRoot = !!snapText.node && !!snapSelBar.node
    && snapText.node.rootMarker === 'A1' && snapSelBar.node.rootMarker === 'A1'
  const crossBaseOk = !!snapText.node && !!snapSelBar.node
    && BASE_CMDS.every((cmd) => snapText.node.cmds.includes(cmd) && snapSelBar.node.cmds.includes(cmd))
  const crossDiffOk = !!snapText.node && !!snapSelBar.node
    && JSON.stringify(snapText.node.cmds) === JSON.stringify(EXPECTED_CMDS_A)
    && JSON.stringify(snapSelBar.node.cmds) === JSON.stringify(EXPECTED_CMDS_B)
    && A_ONLY_CMDS.every((cmd) => snapText.node.cmds.includes(cmd) && !snapSelBar.node.cmds.includes(cmd))
    && B_ONLY_CMDS.every((cmd) => !snapText.node.cmds.includes(cmd) && snapSelBar.node.cmds.includes(cmd))
  const markPressedOk = !!snapText.node && MARK_CMDS.every((cmd) => snapText.node.buttons.some((b) => b.cmd === cmd && b.hasPressed))
  rec('S12a', 'v11：两态共用同一浮窗根节点 + 基础项一致 + 差异项严格按 A/B 清单（不再要求两态集合一致）',
    !!snapText.node && !!snapSelBar.node && snapText.count === 1 && snapSelBar.count === 1,
    crossBothOne && crossNoMode && crossSameRoot && crossBaseOk && crossDiffOk && markPressedOk
      && !snapText.node.cmds.includes('table-ops') && !snapSelBar.node.cmds.includes('table-ops'),
    `文字态 tools=${snapText.count} root=${snapText.node?.rootMarker} cmds=${snapText.node?.cmds.length} | 选择条态 tools=${snapSelBar.count} root=${snapSelBar.node?.rootMarker} cmds=${snapSelBar.node?.cmds.length} | 同根=${crossSameRoot} 基础项=${crossBaseOk} 差异项=${crossDiffOk} 无mode=${crossNoMode} markPressed=${markPressedOk} A=[${(snapText.node?.cmds || []).join(',')}] B=[${(snapSelBar.node?.cmds || []).join(',')}]`)

  // S12b hover 打开 turninto → 菜单真挂载（role=menu / attached / 最多 1 个 / 12 项 / 图标 SVG / paragraph 回填）。
  await resetDoc(page)
  const tB = await openTextSel(page, cellMid)
  await parkMouse(page)
  const turnPt = await btnCenter(page, 'turninto')
  const preB = await toolbarSnap(page)
  if (turnPt) await page.mouse.move(turnPt.x, turnPt.y)
  await wait(220)
  const menuB = await toolbarSnap(page)
  const turnVals = menuB.node ? menuB.node.menuItems : []
  rec('S12b', 'v11：hover 打开 turninto → 挂 data-menu=turninto[role=menu]、最多 1 个、aria-expanded=true、11 项(+1 分隔线＝飞书 12 项)全 SVG 图标',
    !!tB.tr && !!turnPt && preB.count === 1 && !!preB.node && preB.node.menuCount === 0,
    menuB.count === 1 && menuB.allMenuNodes === 1 && !!menuB.node
      && menuB.node.menuCount === 1 && menuB.node.menuName === 'turninto'
      && menuB.node.menuRole === 'menu' && menuB.node.menuAttached
      && menuB.node.buttons.some((b) => b.cmd === 'turninto' && b.expanded === 'true' && b.isMenuOpen)
      && JSON.stringify(turnVals) === JSON.stringify(TURN_INTO_ITEMS)
      && menuB.node.menuDividers === 1
      && menuB.node.menuItemDetails.every((i) => i.menuIconOk)
      && menuB.node.menuItemDetails.some((i) => i.value === 'paragraph' && i.pressed === 'true')
      && menuB.node.menuItemDetails.some((i) => i.value === 'heading1' && i.pressed === 'false'),
    `hover点=${turnPt ? `${Math.round(turnPt.x)},${Math.round(turnPt.y)}` : '无'} 选中="${tB.selText}" 前 menu=${preB.node?.menuCount} → 后 menu=${menuB.node?.menuName} 全页menu=${menuB.allMenuNodes} role=${menuB.node?.menuRole} attached=${menuB.node?.menuAttached} expanded=${menuB.node?.buttons.find((b) => b.cmd === 'turninto')?.expanded} 项数=${turnVals.length}+${menuB.node?.menuDividers}div 图标全SVG=${menuB.node?.menuItemDetails.every((i) => i.menuIconOk)} pressed=[${menuB.node?.menuItemDetails.map((i) => `${i.value}:${i.pressed}`).join(',')}]`)
  await page.screenshot({ path: path.join(OUT, 'selftest-12-hover-turninto-menu.png'), clip })

  // S12c hover 已展开时点触发按钮不关闭 → 切到 align 旧菜单节点真摘除、最多 1 个菜单、8 项。
  const hoverClickBtn = await clickCmd(page, 'turninto')
  await wait(140)
  const afterHoverClick = await toolbarSnap(page)
  const marked = await page.evaluate(() => {
    const m = document.querySelector('.lark-doc-table-tools-menu[data-menu="turninto"]')
    if (!m) return false
    m.setAttribute('data-selftest-prev-menu', '1')
    return true
  })
  const alignPt = await btnCenter(page, 'align')
  if (alignPt) await page.mouse.move(alignPt.x, alignPt.y)
  await wait(220)
  const menuC = await toolbarSnap(page)
  const prevGone = await page.evaluate(() => !document.querySelector('.lark-doc-table-tools-menu[data-selftest-prev-menu="1"]'))
  const alignOk = !!menuC.node && JSON.stringify(menuC.node.menuItems) === JSON.stringify(ALIGN_ITEMS)
    && menuC.node.menuDividers === 2
    && menuC.node.menuItems.filter((v) => /^valign:/.test(v || '')).length === 3
    && menuC.node.menuItemDetails.every((i) => i.menuIconOk)
  rec('S12c', 'v11：hover 打开时再点触发按钮不关闭；切到 align → 旧 turninto 菜单真摘除、最多 1 个菜单、8 项',
    hoverClickBtn && marked && !!menuB.node && menuB.node.menuName === 'turninto' && !!alignPt,
    afterHoverClick.node?.menuCount === 1 && afterHoverClick.node.menuName === 'turninto'
      && menuC.count === 1 && menuC.allMenuNodes === 1 && !!menuC.node
      && menuC.node.menuCount === 1 && menuC.node.menuName === 'align'
      && menuC.node.menuRole === 'menu' && prevGone && alignOk
      && menuC.node.hasBar && menuC.node.barCount === 1
      && JSON.stringify(menuC.node.cmds) === JSON.stringify(EXPECTED_CMDS_A),
    `hover点触发不关=${afterHoverClick.node?.menuName}/${afterHoverClick.node?.menuCount} 旧菜单标记=${marked} → 切后 menu=${menuC.node?.menuName} 旧节点已摘除=${prevGone} 全页menu=${menuC.allMenuNodes} align项数=${menuC.node?.menuItems.length} div=${menuC.node?.menuDividers} bar=${menuC.node?.barCount} cmds=${menuC.node?.cmds.length}`)

  // S12d 点 bold → aria-pressed=true / .is-active / 编辑器 isActive('bold') 为真。
  await resetDoc(page)
  const tD = await openTextSel(page, cellMid)
  const preD = await toolbarSnap(page)
  const boldBefore = await boldState(page)
  const dBtn = await clickCmd(page, 'bold')
  await wait(340)
  const boldAfter = await boldState(page)
  rec('S12d', 'v11：点 bold → aria-pressed=true / .is-active / 编辑器 isActive("bold") 为真（toggleMark 真生效）',
    !!tD.tr && tD.selText.length > 0 && preD.count === 1 && !!preD.node && boldBefore.hasBtn && boldBefore.editorActive === false,
    dBtn && boldAfter.pressed === 'true' && boldAfter.isActive && (boldAfter.editorActive === true || boldAfter.strong > 0),
    `选中="${tD.selText}" 前 pressed=${boldBefore.pressed} editorActive=${boldBefore.editorActive} → 后 pressed=${boldAfter.pressed} isActive=${boldAfter.isActive} editorActive=${boldAfter.editorActive} strong=${boldAfter.strong}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-12-bold-active.png'), clip })

  // S12e CellSelection 下点末尾 remove → 真的删一整列（v11 结构能力真实入口，替代 table-ops→action:addRowAfter）。
  await resetDoc(page)
  const ePt = await openCellSel(page, cellMid)
  const preE = await toolbarSnap(page)
  const colsBefore = await page.evaluate(() => document.querySelectorAll('.ProseMirror table tr')[0].children.length)
  const eBtn = await clickCmd(page, 'remove')
  await wait(420)
  const colsAfter = await page.evaluate(() => {
    const tr = document.querySelectorAll('.ProseMirror table tr')[0]
    return tr ? tr.children.length : 0
  })
  rec('S12e', 'v11：CellSelection 下点末尾 remove → 真的删一整列（结构能力真实入口，替代 v10 table-ops→action:addRowAfter）',
    !!ePt && preE.count === 1 && !!preE.node && preE.node.cmds.includes('remove') && eBtn && colsBefore >= 2,
    colsAfter === colsBefore - 1,
    `选择条命中=${!!ePt} 含remove=${preE.node?.cmds.includes('remove')} 列数=${colsBefore} → ${colsAfter} (期望 ${colsBefore - 1})`)
  await page.screenshot({ path: path.join(OUT, 'selftest-12-remove-column.png'), clip })

  // S12f 点 turninto 里 heading1 → 选区所在块变 h1 / editor.isActive('heading') 为真。
  await resetDoc(page)
  const tF = await openTextSel(page, cellMid)
  const preF = await toolbarSnap(page)
  const headBefore = await headingState(page)
  const fBtn = await clickCmd(page, 'turninto')
  await wait(200)
  const turnF = await toolbarSnap(page)
  const fItem = await clickMenuItem(page, 'turninto', 'heading1')
  await wait(420)
  const headAfter = await headingState(page)
  const headingChanged = (headBefore.editorActive === false && headAfter.editorActive === true)
    || (headBefore.blockTag !== 'H1' && headAfter.blockTag === 'H1')
    || headAfter.h1Count > headBefore.h1Count
  rec('S12f', 'v11：点 turninto→heading1 → 选区所在块变 h1 / editor.isActive("heading") 为真',
    !!tF.tr && tF.selText.length > 0 && preF.count === 1 && !!preF.node
      && fBtn && !!turnF.node && turnF.node.menuName === 'turninto'
      && turnF.node.menuItems.includes('heading1') && fItem
      && headBefore.editorActive === false && headBefore.h1Count === 0,
    headingChanged,
    `菜单=${turnF.node?.menuName} 含heading1=${turnF.node?.menuItems.includes('heading1')} 前 headingActive=${headBefore.editorActive} blockTag=${headBefore.blockTag} h1=${headBefore.h1Count} → 后 headingActive=${headAfter.editorActive} blockTag=${headAfter.blockTag} h1=${headAfter.h1Count} 变化=${headingChanged}`)

  // S12g 点 align 里 align:center → 段落 text-align 真的变化（computed / 编辑器属性 = center）。
  await resetDoc(page)
  const tG = await openTextSel(page, cellMid)
  const preG = await toolbarSnap(page)
  const alignBefore = await alignState(page)
  const gBtn = await clickCmd(page, 'align')
  await wait(200)
  const alignMenu = await toolbarSnap(page)
  const gItem = await clickMenuItem(page, 'align', 'align:center')
  await wait(420)
  const alignAfter = await alignState(page)
  const alignIsCenter = alignAfter.computed === 'center' || alignAfter.nodeAlign === 'center' || alignAfter.inline === 'center'
  const alignChanged = alignBefore.computed !== alignAfter.computed || alignBefore.nodeAlign !== alignAfter.nodeAlign || alignBefore.inline !== alignAfter.inline
  rec('S12g', 'v11：点 align→align:center → 段落 text-align 真的变化（computed / 编辑器属性 = center）',
    !!tG.tr && tG.selText.length > 0 && preG.count === 1 && !!preG.node
      && gBtn && !!alignMenu.node && alignMenu.node.menuName === 'align'
      && alignMenu.node.menuItems.includes('align:center') && gItem
      && alignBefore.computed !== 'center' && alignBefore.nodeAlign !== 'center',
    alignIsCenter && alignChanged,
    `菜单=${alignMenu.node?.menuName} 含align:center=${alignMenu.node?.menuItems.includes('align:center')} 前 computed=${alignBefore.computed} inline=${alignBefore.inline} nodeAlign=${alignBefore.nodeAlign} → 后 computed=${alignAfter.computed} inline=${alignAfter.inline} nodeAlign=${alignAfter.nodeAlign} 生效=${alignIsCenter} 变化=${alignChanged}`)

  // S12h 点外部 → 统一浮窗与菜单都收起（真实鼠标点表格外正文，触发离散 dismiss + closeMenus）。
  await resetDoc(page)
  const tH = await openTextSel(page, cellMid)
  const hBtn = await clickCmd(page, 'turninto')
  await wait(200)
  const beforeOutside = await toolbarSnap(page)
  await page.mouse.click(geo.out.x, geo.out.y)
  await wait(450)
  const afterOutside = await toolbarSnap(page)
  s = await state(page)
  rec('S12h', 'v11：点外部 → 统一浮窗与菜单都收起（tools=0 / 全页 menu=0 / bubbles=0）',
    !!tH.tr && hBtn && beforeOutside.count === 1 && !!beforeOutside.node
      && beforeOutside.node.menuCount === 1 && beforeOutside.allMenuNodes === 1,
    afterOutside.count === 0 && afterOutside.allMenuNodes === 0 && s.tools === 0 && s.bubbles === 0,
    `前 tools=${beforeOutside.count} menu=${beforeOutside.node?.menuName}(全页${beforeOutside.allMenuNodes}) → 后 tools=${afterOutside.count} 全页menu=${afterOutside.allMenuNodes} bubbles=${s.bubbles}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-12-outside-closed.png'), clip })

  // ═════════ S13：v11「飞书功能栏 功能都需要实现」全量命令守卫 ═════════
  // 这一组不复用上面任何断言：逐个真实点击外部能力 / 置灰态 / 清除项，先看前提，
  // 再看是否产生可观测效果（DOM 事件、正文 HTML 变化、菜单可用性）。目的是堵住
  // 「脚本全绿但按钮点了没反应」这类假阳性。
  const menuItemState = (pg, menu, value) => pg.evaluate(({ m, v }) => {
    const b = document.querySelector(`.lark-doc-table-tools-menu[data-menu="${m}"] button[data-value="${v}"]`)
    return b ? { exists: true, disabled: !!b.disabled, pressed: b.getAttribute('aria-pressed') } : { exists: false }
  }, { m: menu, v: value })
  const clickColor = (pg, menu, value) => pg.evaluate(({ m, v }) => {
    const b = document.querySelector(`.lark-doc-table-tools-menu[data-menu="${m}"] button.lark-doc-table-tools-color[data-value="${v}"]`)
    if (b) b.click(); return !!b
  }, { m: menu, v: value })
  const docHtml = (pg) => pg.evaluate(() => document.querySelector('.ProseMirror')?.innerHTML || '')
  const armEvents = (pg) => pg.evaluate(() => {
    window.__selftestEvents = []
    if (window.__selftestBound) return
    window.__selftestBound = true
    for (const name of ['lark-doc-toolbar-action', 'comment-request']) {
      document.addEventListener(name, (e) => window.__selftestEvents.push({ name, detail: e.detail }))
    }
  })
  const readEvents = (pg) => pg.evaluate(() => window.__selftestEvents || [])

  // S13a（v12c 反向断言）：旧版验的是「点 comment 抛事件 + 落本地 mark」，但用户确认
  // 「复制选区链接」「评论」两颗按钮没有真实功能（前者只写 #pos 假链接、后者无评论面板 /
  // 输入框 / 线程 UI），已整体下线。这里改为验证：浮窗与全页既无 data-cmd 也无同名可点
  // 控件，命令分发不再产生任何可观测效果（无事件、无 mark、文档不变）。
  await resetDoc(page)
  await armEvents(page)
  const aSel = await openTextSel(page, cellMid)
  const aHtml0 = await docHtml(page)
  const aDown = await page.evaluate(() => {
    const root = document.querySelector('.lark-doc-table-tools')
    if (!root) return { root: false, byCmd: [-1, -1], byLabel: [-1, -1], cmds: [] }
    const byCmd = ['share-link', 'comment'].map((c) => document.querySelectorAll(`[data-cmd="${c}"]`).length)
    const ctrls = [...root.querySelectorAll('button, [role="menuitem"], a[href]')]
    const byLabel = ['复制选区链接', '评论'].map((label) => ctrls.filter((n) =>
      (n.textContent || '').trim() === label
      || (n.getAttribute('title') || '').trim() === label
      || (n.getAttribute('aria-label') || '').trim() === label).length)
    return { root: true, byCmd, byLabel, cmds: [...root.querySelectorAll('button[data-cmd]')].map((n) => n.dataset.cmd) }
  })
  const aBtn = await clickCmd(page, 'comment')
  await wait(420)
  const aHtml1 = await docHtml(page)
  const aEvents = await readEvents(page)
  rec('S13a', 'v12c：comment / share-link 两颗无实现按钮已下线 —— 全页无 data-cmd、浮窗无同名控件、无 comment-request 事件、文档无变化',
    !!aSel.tr && aSel.selText.length > 0 && aDown.root && !/lark-doc-comment/.test(aHtml0),
    aDown.byCmd.every((n) => n === 0) && aDown.byLabel.every((n) => n === 0)
      && !aDown.cmds.includes('comment') && !aDown.cmds.includes('share-link') && !aBtn
      && !/lark-doc-comment/.test(aHtml1) && aHtml0 === aHtml1
      && !aEvents.some((e) => e.name === 'comment-request'),
    `选中=${aSel.selText} byCmd=[${aDown.byCmd.join(',')}] byLabel=[${aDown.byLabel.join(',')}] clickable=${aBtn} 事件=[${aEvents.map((e) => e.name).join(',')}] html变化=${aHtml0 !== aHtml1}`)

  // S13b「更多」裁剪：只留 2 项（translate/larkSearch），被删的 copyAnchorLink 与
  // 暂不具备的 4 项都不在菜单，也不在浮窗任何位置（data-value 残留）。
  await resetDoc(page)
  const bSel = await openTextSel(page, cellMid)
  const bMenu = await clickCmd(page, 'more')
  await wait(180)
  const bSnap = await toolbarSnap(page)
  const bVals = bSnap.node ? bSnap.node.menuItems : []
  const bBanned = [...MORE_REMOVED, 'copyAnchorLink']
  const removedLeft = await page.evaluate((vals) => vals.filter((v) =>
    !!document.querySelector(`.lark-doc-table-tools [data-value="${v}"]`)), bBanned)
  rec('S13b', 'v11：more 菜单裁到 2 项（translate/larkSearch），copyAnchorLink 与被删 4 项均不在菜单也不在浮窗',
    !!bSel.tr && bMenu && !!bSnap.node && bSnap.node.menuName === 'more' && bSnap.count === 1,
    JSON.stringify(bVals) === JSON.stringify(MORE_ITEMS)
      && !bVals.includes('copyAnchorLink')
      && bBanned.every((v) => !bVals.includes(v)) && removedLeft.length === 0
      && bSnap.node.menuItemDetails.every((i) => i.menuIconOk)
      && bSnap.node.tableOpsButtons === 0 && bSnap.node.tableOpsMenus === 0 && bSnap.node.actionValues.length === 0,
    `菜单项=[${bVals.join(',')}] 含copyAnchorLink=${bVals.includes('copyAnchorLink')} 被删/copyAnchorLink残留=[${removedLeft.join(',')}] 图标全SVG=${bSnap.node?.menuItemDetails.every((i) => i.menuIconOk)} tableOpsBtn=${bSnap.node?.tableOpsButtons} action:*=${bSnap.node?.actionValues.length}`)

  // S13c 上下文适用性：文字选区态表格专属 3 颗 + remove 真摘除、align 缩进置灰；
  // 整列选区（CellSelection）态 merge-cell 菜单解禁且 mergeCells 真的改表结构。
  await resetDoc(page)
  const cSel = await openTextSel(page, cellMid)
  const cSnapA = await toolbarSnap(page)
  const cAlignMenu = await clickCmd(page, 'align')
  await wait(160)
  const cIndent = await menuItemState(page, 'align', 'indent:1')
  const cCellOnlyAbsent = !!cSnapA.node
    && TABLE_ONLY_CMDS.every((cmd) => !cSnapA.node.cmds.includes(cmd))
    && !cSnapA.node.cmds.includes('remove')
  await resetDoc(page)
  const cCol = await openCellSel(page, cellMid)
  const cColMenu = await clickCmd(page, 'merge-cell')
  await wait(160)
  const cCellMerge = await menuItemState(page, 'merge-cell', 'mergeCells')
  const cSplit = await menuItemState(page, 'merge-cell', 'splitCell')
  const cHtml0 = await docHtml(page)
  const cClicked = await clickMenuItem(page, 'merge-cell', 'mergeCells')
  await wait(420)
  const cHtml1 = await docHtml(page)
  // 合并之后必须有可拆分单元格：拆分项自动解禁，且点击真的把结构拆回去（置灰 ≠ 删功能）。
  await clickCmd(page, 'merge-cell')
  await wait(160)
  const cSplitAfter = await menuItemState(page, 'merge-cell', 'splitCell')
  const cHtml2 = await docHtml(page)
  const cSplitClicked = cSplitAfter.disabled === false
    ? await clickMenuItem(page, 'merge-cell', 'splitCell') : false
  await wait(420)
  const cHtml3 = await docHtml(page)
  rec('S13c', 'v11：不适用项置灰（文字态表格按钮/缩进、无合并单元格的拆分），适用时解禁且结构命令真生效',
    !!cSel.tr && !!cSnapA.node && cAlignMenu && !!cIndent.exists
      && !!cCol && cColMenu && !!cCellMerge.exists && !!cSplit.exists && cHtml0 !== '',
    cCellOnlyAbsent && cIndent.disabled === true
      && cCellMerge.disabled === false && cSplit.disabled === true && cClicked && cHtml0 !== cHtml1
      && cSplitAfter.disabled === false && cSplitClicked && cHtml2 !== cHtml3,
    `文字态表格专属不在bar=${cCellOnlyAbsent} indent.disabled=${cIndent.disabled} | 整列 merge.disabled=${cCellMerge.disabled} split.disabled=${cSplit.disabled} 合并生效=${cHtml0 !== cHtml1} | 合并后 split.disabled=${cSplitAfter.disabled} 拆分生效=${cHtml2 !== cHtml3}`)

  // S13d「清除颜色与高亮」：无色时置灰；上色后解禁且点击真的清掉。
  await resetDoc(page)
  const dSel = await openTextSel(page, cellMid)
  const dMenu0 = await clickCmd(page, 'highlight')
  await wait(160)
  const dClear0 = await menuItemState(page, 'highlight', 'highlight:clear')
  const dColor = await clickColor(page, 'highlight', 'color:#f54a45')
  await wait(300)
  const dColored = await docHtml(page)
  await openTextSel(page, cellMid)
  const dMenu1 = await clickCmd(page, 'highlight')
  await wait(160)
  const dClear1 = await menuItemState(page, 'highlight', 'highlight:clear')
  const dClicked = await clickMenuItem(page, 'highlight', 'highlight:clear')
  await wait(380)
  const dClean = await docHtml(page)
  rec('S13d', 'v11：清除字体色/高亮 —— 无可清内容时置灰，上色后解禁并真的清除',
    !!dSel.tr && dMenu0 && dColor && dMenu1 && /f54a45|rgb\(245/.test(dColored),
    dClear0.disabled === true && dClear1.disabled === false && dClicked
      && !/f54a45|rgb\(245/.test(dClean),
    `前 disabled=${dClear0.disabled} 上色=${/f54a45|rgb\(245/.test(dColored)} 后 disabled=${dClear1.disabled} 点击=${dClicked} 已清除=${!/f54a45|rgb\(245/.test(dClean)}`)

  // S13e「清除单元格背景」：同上。⚠️ v11 的 cell-bg 是状态 B 专属按钮（文字选区态真摘除），
  // 必须在整列 CellSelection 下打开色板；setCellAttribute 本身也只认 CellSelection。
  await resetDoc(page)
  const eSel = await openCellSel(page, cellMid)
  const eMenu0 = await clickCmd(page, 'cell-bg')
  await wait(160)
  const eClear0 = await menuItemState(page, 'cell-bg', 'cellbg:')
  const eColor = await clickColor(page, 'cell-bg', 'cellbg:#00b887')
  await wait(300)
  const eBgSet = await docHtml(page)
  await openCellSel(page, cellMid)
  const eMenu1 = await clickCmd(page, 'cell-bg')
  await wait(160)
  const eClear1 = await menuItemState(page, 'cell-bg', 'cellbg:')
  const eClicked = await clickMenuItem(page, 'cell-bg', 'cellbg:')
  await wait(380)
  const eBgGone = await docHtml(page)
  rec('S13e', 'v11：清除单元格背景 —— 无背景时置灰，上色后解禁并真的清除（CellSelection 专属入口）',
    !!eSel && eMenu0 && eColor && eMenu1 && /background-color/.test(eBgSet),
    eClear0.disabled === true && eClear1.disabled === false && eClicked
      && !/background-color/.test(eBgGone),
    `前 disabled=${eClear0.disabled} 上色=${/background-color/.test(eBgSet)} 后 disabled=${eClear1.disabled} 点击=${eClicked} 已清除=${!/background-color/.test(eBgGone)}`)

  // S13f「转换为」当前块类型打勾：paragraph→heading1 后 pressed 跟着换。
  await resetDoc(page)
  const fSel = await openTextSel(page, cellMid)
  const fMenu0 = await clickCmd(page, 'turninto')
  await wait(160)
  const fP0 = await menuItemState(page, 'turninto', 'paragraph')
  const fH0 = await menuItemState(page, 'turninto', 'heading1')
  const fToH1 = await clickMenuItem(page, 'turninto', 'heading1')
  await wait(380)
  const fMenu1 = await clickCmd(page, 'turninto')
  await wait(160)
  const fP1 = await menuItemState(page, 'turninto', 'paragraph')
  const fH1 = await menuItemState(page, 'turninto', 'heading1')
  rec('S13f', 'v11：转换为下拉按当前块类型回填 aria-pressed（paragraph → heading1 同步切换）',
    !!fSel.tr && fMenu0 && fToH1 && fMenu1 && fP0.exists && fH0.exists && fP1.exists && fH1.exists,
    fP0.pressed === 'true' && fH0.pressed === 'false' && fP1.pressed === 'false' && fH1.pressed === 'true',
    `paragraph ${fP0.pressed}→${fP1.pressed} heading1 ${fH0.pressed}→${fH1.pressed}`)

  // S13g 飞书「转换为」新增两项（高亮块 / 同步块）必须真落块，不能只有事件。
  await resetDoc(page)
  const gSel = await openTextSel(page, cellMid)
  const gHtml0 = await docHtml(page)
  const gMenu = await clickCmd(page, 'turninto')
  await wait(160)
  const gCallout = await clickMenuItem(page, 'turninto', 'callout')
  await wait(380)
  const gHtml1 = await docHtml(page)
  await resetDoc(page)
  const gSel2 = await openTextSel(page, cellMid)
  const gHtml2 = await docHtml(page)
  const gMenu2 = await clickCmd(page, 'turninto')
  await wait(160)
  const gSynced = await clickMenuItem(page, 'turninto', 'synced')
  await wait(380)
  const gHtml3 = await docHtml(page)
  rec('S13g', 'v11：转换为→高亮块 / 同步块 两项都真实落块（非只有图标的空按钮）',
    !!gSel.tr && !!gSel2.tr && gMenu && gMenu2 && gCallout && gSynced && gHtml0 && gHtml2,
    gHtml0 !== gHtml1 && /data-type="callout"/.test(gHtml1)
      && gHtml2 !== gHtml3 && /card-embed|cardEmbed|data-type="callout"/.test(gHtml3),
    `高亮块 变化=${gHtml0 !== gHtml1} callout=${/data-type="callout"/.test(gHtml1)} | 同步块 变化=${gHtml2 !== gHtml3} card=${/card-embed|cardEmbed/.test(gHtml3)}`)

  // ═════════ S14：v11 新增契约（图标 / caret / 菜单 / table-ops / 下拉交互 / 真功能）═════════
  // S14a 所有按钮都有 SVG 图标（iconNode 16×16），两态均无字符 .lark-doc-table-tools-glyph。
  const s14IconsOk = (n) => !!n && n.buttons.length > 0
    && n.buttons.every((b) => b.iconOk)
    && n.glyphNodes === 0 && n.iconNodes === n.buttons.length
  rec('S14a', 'v11：所有按钮都有 SVG 图标（span.lark-doc-icon>svg，16×16），两态均无字符 glyph 节点',
    !!snapText.node && !!snapSelBar.node
      && snapText.node.buttons.length === EXPECTED_CMDS_A.length
      && snapSelBar.node.buttons.length === EXPECTED_CMDS_B.length,
    s14IconsOk(snapText.node) && s14IconsOk(snapSelBar.node),
    `A图标=${snapText.node?.iconNodes}/${snapText.node?.buttons.length} iconOk=${snapText.node?.buttons.filter((b) => b.iconOk).length} glyph=${snapText.node?.glyphNodes} | B图标=${snapSelBar.node?.iconNodes}/${snapSelBar.node?.buttons.length} iconOk=${snapSelBar.node?.buttons.filter((b) => b.iconOk).length} glyph=${snapSelBar.node?.glyphNodes}`)

  // S14b caret 数量 = 4、12px SVG、无字符 caret 残留、表格专属 3 颗纯图标无 caret。
  const s14CaretOk = (n) => !!n && n.caretNodes === 4 && n.legacyCaretNodes === 0
    && CARET_CMDS.every((cmd) => n.buttons.some((b) => b.cmd === cmd && b.hasCaret && b.caretOk && b.hasCaretSpan))
    && n.buttons.filter((b) => b.hasCaret).length === 4
  rec('S14b', 'v11：caret 数量 = 4（span.lark-doc-caret.lark-doc-icon>svg，12px），无字符 caret 节点，表格专属 3 颗无 caret',
    !!snapText.node && !!snapSelBar.node,
    s14CaretOk(snapText.node) && s14CaretOk(snapSelBar.node)
      && TABLE_ONLY_CMDS.every((cmd) => snapSelBar.node.buttons.some((b) => b.cmd === cmd && !b.hasCaret && !b.hasCaretSpan)),
    `A caret=${snapText.node?.caretNodes} legacyCaret=${snapText.node?.legacyCaretNodes} | B caret=${snapSelBar.node?.caretNodes} legacyCaret=${snapSelBar.node?.legacyCaretNodes} 表格专属caret=[${TABLE_ONLY_CMDS.map((c) => `${c}:${snapSelBar.node?.buttons.find((b) => b.cmd === c)?.hasCaret}`).join(',')}]`)

  // S14c 菜单项图标 + turninto/align/more 菜单结构保持（复用 S12/S13 的菜单快照）。
  rec('S14c', 'v11：菜单项图标统一 .lark-doc-table-tools-menu-icon SVG；turninto 12 项 / align 8 项 / more 2 项结构保持',
    !!menuB.node && !!menuC.node && !!bSnap.node
      && menuB.node.menuName === 'turninto' && menuC.node.menuName === 'align' && bSnap.node.menuName === 'more',
    [menuB.node, menuC.node, bSnap.node].every((n) => n.menuItemDetails.length > 0 && n.menuItemDetails.every((i) => i.menuIconOk))
      && JSON.stringify(menuB.node.menuItems) === JSON.stringify(TURN_INTO_ITEMS) && menuB.node.menuDividers === 1
      && JSON.stringify(menuC.node.menuItems) === JSON.stringify(ALIGN_ITEMS) && menuC.node.menuDividers === 2
      && JSON.stringify(bSnap.node.menuItems) === JSON.stringify(MORE_ITEMS),
    `turninto=${menuB.node?.menuItems.length}+${menuB.node?.menuDividers}div align=${menuC.node?.menuItems.length}+${menuC.node?.menuDividers}div more=${bSnap.node?.menuItems.length} 三项菜单图标全SVG=${[menuB.node, menuC.node, bSnap.node].every((n) => n?.menuItemDetails.every((i) => i.menuIconOk))}`)

  // S14d 浮窗里不存在「表格操作」按钮：两态快照 + 当前态 + 全页查询都不允许出现 table-ops / action:*。
  await resetDoc(page)
  const d14Sel = await openTextSel(page, cellMid)
  const d14Snap = await toolbarSnap(page)
  const d14Global = await page.evaluate(() => ({
    btn: document.querySelectorAll('[data-cmd="table-ops"]').length,
    menu: document.querySelectorAll('[data-menu="table-ops"]').length,
    action: [...document.querySelectorAll('.lark-doc-table-tools [data-value^="action:"]')].map((n) => n.getAttribute('data-value')),
  }))
  rec('S14d', 'v11：浮窗里不存在「表格操作」按钮（data-cmd=table-ops=0 / data-menu=table-ops=0 / 无 action:* 菜单项）',
    !!d14Sel.tr && d14Snap.count === 1 && !!d14Snap.node && !!snapText.node && !!snapSelBar.node,
    [snapText.node, snapSelBar.node, d14Snap.node].every((n) => !!n
      && n.tableOpsButtons === 0 && n.tableOpsMenus === 0 && n.actionValues.length === 0)
      && d14Global.btn === 0 && d14Global.menu === 0 && d14Global.action.length === 0,
    `A/B/当前态 均 tableOps=0；全页 data-cmd=table-ops=${d14Global.btn} data-menu=table-ops=${d14Global.menu} action:*=[${d14Global.action.join(',')}]`)

  // S14e hover 打开 → 移开鼠标 180ms 自动关闭（mouseleave 排 150ms 关闭定时器）。
  await resetDoc(page)
  const e14Sel = await openTextSel(page, cellMid)
  await parkMouse(page)
  const e14TurnPt = await btnCenter(page, 'turninto')
  if (e14TurnPt) await page.mouse.move(e14TurnPt.x, e14TurnPt.y)
  await wait(200)
  const e14Open = await toolbarSnap(page)
  await page.mouse.move(8, 8)
  await wait(180)
  const e14Closed = await toolbarSnap(page)
  rec('S14e', 'v11：hover 打开下拉 → 移开鼠标 180ms 后自动关闭（mouseleave 排 150ms 关闭定时器）',
    !!e14Sel.tr && !!e14TurnPt && e14Open.count === 1 && !!e14Open.node
      && e14Open.node.menuCount === 1 && e14Open.node.menuName === 'turninto',
    e14Closed.count === 1 && !!e14Closed.node && e14Closed.node.menuCount === 0
      && e14Closed.node.menuName === null && e14Closed.node.rootChildTags.length === 1
      && e14Closed.allMenuNodes === 0,
    `hover后 menu=${e14Open.node?.menuName}/${e14Open.node?.menuCount} → 移开180ms menu=${e14Closed.node?.menuCount} 全页menu=${e14Closed.allMenuNodes} 根子节点=[${e14Closed.node?.rootChildTags.join(',')}]`)

  // S14f 进入菜单取消关闭（等 180ms 仍在）；离开菜单再排关闭（180ms 真摘除）。
  await resetDoc(page)
  const f14Sel = await openTextSel(page, cellMid)
  await parkMouse(page)
  const f14TurnPt = await btnCenter(page, 'turninto')
  if (f14TurnPt) await page.mouse.move(f14TurnPt.x, f14TurnPt.y)
  await wait(200)
  const f14Open = await toolbarSnap(page)
  const f14MenuPt = await menuCenter(page)
  if (f14MenuPt) await page.mouse.move(f14MenuPt.x, f14MenuPt.y)
  await wait(180)
  const f14InMenu = await toolbarSnap(page)
  await page.mouse.move(8, 8)
  await wait(180)
  const f14LeaveMenu = await toolbarSnap(page)
  rec('S14f', 'v11：进入菜单取消 150ms 关闭（等 180ms 仍在）；离开菜单再排关闭（180ms 真摘除）',
    !!f14Sel.tr && !!f14TurnPt && !!f14MenuPt && f14Open.node?.menuCount === 1,
    f14InMenu.count === 1 && f14InMenu.node?.menuCount === 1 && f14InMenu.node.menuName === 'turninto'
      && f14LeaveMenu.count === 1 && f14LeaveMenu.node?.menuCount === 0 && f14LeaveMenu.allMenuNodes === 0,
    `进入菜单180ms menu=${f14InMenu.node?.menuName}/${f14InMenu.node?.menuCount} → 离开菜单180ms menu=${f14LeaveMenu.node?.menuCount} 全页menu=${f14LeaveMenu.allMenuNodes}`)

  // S14g Escape → 菜单真摘除 + 浮窗按显隐契约收起。
  await resetDoc(page)
  const g14Sel = await openTextSel(page, cellMid)
  await parkMouse(page)
  const g14Btn = await clickCmd(page, 'highlight')
  await wait(180)
  const g14BeforeEsc = await toolbarSnap(page)
  await page.keyboard.press('Escape')
  await wait(300)
  const g14AfterEsc = await toolbarSnap(page)
  const g14MenuLeft = await page.evaluate(() => document.querySelectorAll('.lark-doc-table-tools-menu[data-menu]').length)
  rec('S14g', 'v11：Escape → 菜单真摘除（全页 menu=0），浮窗按显隐契约一起收起',
    !!g14Sel.tr && g14Btn && g14BeforeEsc.node?.menuCount === 1 && g14BeforeEsc.node.menuName === 'highlight',
    g14MenuLeft === 0 && (g14AfterEsc.node?.menuCount ?? 0) === 0 && g14AfterEsc.count === 0,
    `Escape前 menu=${g14BeforeEsc.node?.menuName} → 后 全页menu=${g14MenuLeft} tools=${g14AfterEsc.count}`)

  // S14h DOM click 打开（非 hover）→ 再点触发按钮关闭；focus 触发按钮也能打开下拉。
  await resetDoc(page)
  const h14Sel = await openTextSel(page, cellMid)
  await parkMouse(page)
  const h14Open1 = await clickCmd(page, 'more')
  await wait(160)
  const h14Snap1 = await toolbarSnap(page)
  const h14Close = await clickCmd(page, 'more')
  await wait(160)
  const h14Snap2 = await toolbarSnap(page)
  const h14Focus = await page.evaluate(() => {
    const b = document.querySelector('.lark-doc-table-tools-btn[data-cmd="turninto"]')
    if (!b) return false
    b.focus()
    return true
  })
  await wait(180)
  const h14Snap3 = await toolbarSnap(page)
  rec('S14h', 'v11：DOM click 打开（非 hover）→ 再点触发按钮关闭；focus 触发按钮也能打开下拉',
    !!h14Sel.tr && h14Open1 && h14Close && h14Focus && h14Snap1.node?.menuCount === 1,
    h14Snap1.node.menuName === 'more'
      && h14Snap2.count === 1 && h14Snap2.node?.menuCount === 0 && h14Snap2.allMenuNodes === 0
      && h14Snap3.node?.menuCount === 1 && h14Snap3.node.menuName === 'turninto'
      && h14Snap3.allMenuNodes === 1,
    `click1 menu=${h14Snap1.node?.menuName} → click2 menu=${h14Snap2.node?.menuCount} → focus menu=${h14Snap3.node?.menuName} 全页menu=${h14Snap3.allMenuNodes}`)

  // S14i more→translate → 抛 lark-doc-toolbar-action 事件并打开包内 AI 面板（真功能入口）。
  await resetDoc(page)
  await armEvents(page)
  const i14Sel = await openTextSel(page, cellMid)
  const i14AiBefore = await page.evaluate(() => !!document.querySelector('.lark-doc-ai-panel'))
  const i14Menu = await clickCmd(page, 'more')
  await wait(160)
  const i14Snap = await toolbarSnap(page)
  const i14Item = await clickMenuItem(page, 'more', 'translate')
  await wait(480)
  const i14AiAfter = await page.evaluate(() => !!document.querySelector('.lark-doc-ai-panel'))
  const i14Events = await readEvents(page)
  rec('S14i', 'v11：more→translate → 抛 lark-doc-toolbar-action 事件并打开包内 AI 面板（真功能入口）',
    !!i14Sel.tr && i14Menu && i14Item && !i14AiBefore && !!i14Snap.node && i14Snap.node.menuName === 'more',
    i14AiAfter && i14Events.some((e) => e.name === 'lark-doc-toolbar-action' && e.detail?.action === 'translate'),
    `选中="${i14Sel.selText}" 菜单=${i14Snap.node?.menuName} 前AI面板=${i14AiBefore} → 后AI面板=${i14AiAfter} 事件=[${i14Events.map((e) => e.detail?.action || e.name).join(',')}]`)
  await page.evaluate(() => {
    const b = document.querySelector('.lark-doc-ai-panel button[aria-label="关闭 AI 预览"]')
    if (b) b.click()
  })
  await wait(180)

  // S14j more→larkSearch → 打开包内 .lark-doc-fr 搜索面板并回填选中词（不再走 window.find）。
  await resetDoc(page)
  const j14Sel = await openTextSel(page, cellMid)
  await page.evaluate(() => {
    window.__selftestFindOrig = window.find
    window.__selftestFindCalls = 0
    window.find = function (...args) {
      window.__selftestFindCalls += 1
      const orig = window.__selftestFindOrig
      return orig ? orig.apply(this, args) : false
    }
  })
  const j14FrBefore = await page.evaluate(() => !!document.querySelector('.lark-doc-fr'))
  const j14Menu = await clickCmd(page, 'more')
  await wait(160)
  const j14Snap = await toolbarSnap(page)
  const j14Item = await clickMenuItem(page, 'more', 'larkSearch')
  await wait(480)
  const j14Fr = await page.evaluate(() => {
    const fr = document.querySelector('.lark-doc-fr')
    return fr ? {
      open: true,
      role: fr.getAttribute('role'),
      query: (fr.querySelector('#lark-doc-fr-find') || {}).value || '',
    } : { open: false, role: null, query: '' }
  })
  const j14FindCalls = await page.evaluate(() => window.__selftestFindCalls)
  rec('S14j', 'v11：more→larkSearch → 打开包内 .lark-doc-fr 搜索面板并回填选中词（不再走 window.find）',
    !!j14Sel.tr && j14Sel.selText.length > 0 && j14Menu && j14Item && !j14FrBefore
      && !!j14Snap.node && j14Snap.node.menuName === 'more',
    j14Fr.open && j14Fr.role === 'search' && j14Fr.query === j14Sel.selText && j14FindCalls === 0,
    `选中="${j14Sel.selText}" 菜单=${j14Snap.node?.menuName} 前面板=${j14FrBefore} → 后 role=${j14Fr.role} 回填="${j14Fr.query}" window.find调用=${j14FindCalls}`)
  await page.evaluate(() => {
    const b = document.querySelector('.lark-doc-fr .lark-doc-fr-close')
    if (b) b.click()
    if (window.__selftestFindOrig !== undefined) window.find = window.__selftestFindOrig
    else delete window.find
  })
  await wait(180)

  // S14k 点边界单颗 ＋ → 真的加一行（结构能力真实入口，替代 v10 action:addRowAfter）。
  await resetDoc(page)
  const k14Cell = await page.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td').getBoundingClientRect()
    return { cx: td.left + 28, cy: td.top + 16, bx: td.left + 30, by: td.bottom - 2 }
  })
  await page.mouse.click(k14Cell.cx, k14Cell.cy)
  await wait(280)
  await page.mouse.move(k14Cell.bx, k14Cell.by)
  await wait(300)
  const k14Plus = await page.evaluate(() => {
    const b = document.querySelector('.lark-doc-table-boundary-tools button')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  const k14RowsBefore = await page.evaluate(() => document.querySelectorAll('.ProseMirror table tr').length)
  if (k14Plus) {
    await page.mouse.move(k14Plus.x, k14Plus.y)
    await wait(280)
    await page.mouse.click(k14Plus.x, k14Plus.y)
    await wait(420)
  }
  const k14RowsAfter = await page.evaluate(() => document.querySelectorAll('.ProseMirror table tr').length)
  rec('S14k', 'v11：点边界单颗 ＋ → 真的加一行（表格结构能力真实入口，替代 v10 action:addRowAfter）',
    !!k14Plus && k14RowsBefore >= 2,
    k14RowsAfter === k14RowsBefore + 1,
    `＋命中=${!!k14Plus} 行数=${k14RowsBefore} → ${k14RowsAfter} (期望 ${k14RowsBefore + 1})`)

  // S14l 结构菜单保持：table-header 标题行/列、merge-cell 合并解禁 / 拆分按状态置灰、cell-bg 色板 + 清除项。
  await resetDoc(page)
  const l14Col = await openCellSel(page, cellMid)
  const l14Pre = await toolbarSnap(page)
  const l14HeaderBtn = await clickCmd(page, 'table-header')
  await wait(160)
  const l14Header = await toolbarSnap(page)
  const l14MergeBtn = await clickCmd(page, 'merge-cell')
  await wait(160)
  const l14Merge = await toolbarSnap(page)
  const l14CellBgBtn = await clickCmd(page, 'cell-bg')
  await wait(160)
  const l14CellBg = await toolbarSnap(page)
  rec('S14l', 'v11：结构菜单保持 —— table-header 2 项、merge-cell 合并解禁 / 无合并单元格时拆分置灰、cell-bg 色板 + 清除项',
    !!l14Col && l14Pre.count === 1 && l14HeaderBtn && l14MergeBtn && l14CellBgBtn,
    !!l14Header.node && l14Header.node.menuName === 'table-header'
      && JSON.stringify(l14Header.node.menuItems) === JSON.stringify(['toggleHeaderRow', 'toggleHeaderColumn'])
      && l14Header.node.menuItemDetails.every((i) => i.menuIconOk)
      && !!l14Merge.node && l14Merge.node.menuName === 'merge-cell'
      && JSON.stringify(l14Merge.node.menuItems) === JSON.stringify(['mergeCells', 'splitCell'])
      && l14Merge.node.menuItemDetails[0]?.disabled === false
      && l14Merge.node.menuItemDetails[1]?.disabled === true
      && l14Merge.node.menuItemDetails.every((i) => i.menuIconOk)
      && !!l14CellBg.node && l14CellBg.node.menuName === 'cell-bg'
      && l14CellBg.node.colorItems.filter((v) => /^cellbg:/.test(v || '')).length >= 1
      && l14CellBg.node.menuItems.includes('cellbg:'),
    `table-header=[${l14Header.node?.menuItems.join(',')}] merge-cell=[${l14Merge.node?.menuItems.join(',')}] disabled=[${l14Merge.node?.menuItemDetails.map((i) => i.disabled).join(',')}] cellbg色块=${l14CellBg.node?.colorItems.length} 清除项=${l14CellBg.node?.menuItems.includes('cellbg:')}`)

  // ═════════ S15：v12 三条反馈独立自测（真实鼠标 + 可观测证据，前提不成立记 INVALID）═════════
  // 不复用上面任何断言的结论：每条都重新 resetDoc、重新开浮窗、重新取 DOM/组件状态。
  // remove 沿用文件既有 clickCmd()（DOM click 派发真实 click 命令，避免 pointerdown 误触发
  // 「点外部收起」闸门，见文件头 helper 注释）；选列/选行走真实鼠标 openCellSel/openRowSel15。

  /** 读组件内部 tableSelectedLine（浏览器内可访问），序列化成可比对证据。 */
  const tableSelLine = (pg) => pg.evaluate(() => {
    const el = document.querySelector('lark-doc')
    const st = el?.document?._handle?.state
    if (!st) return { reachable: false }
    const raw = st.tableSelectedLine
    let sum
    try { sum = raw === undefined ? 'undefined' : JSON.stringify(raw) } catch { sum = 'unserializable' }
    const keys = raw && typeof raw === 'object' ? Object.keys(raw) : []
    return {
      reachable: true,
      raw: sum,
      isEmpty: raw == null || raw === '' || (typeof raw === 'object' && keys.length === 0),
      keys,
    }
  })

  /** 每行单元格文本网格；删除前后逐格比对，才能证明删的是选中那一列/行。 */
  const grid15 = (pg) => pg.evaluate(() =>
    [...document.querySelectorAll('.ProseMirror table tr')]
      .map((tr) => [...tr.children].map((c) => (c.textContent || '').trim())))
  /** 首行各列 / 各行的几何，用于把「真实鼠标点中的选择条」映射到真实列/行索引。 */
  const colRects15 = (pg) => pg.evaluate(() =>
    [...document.querySelectorAll('.ProseMirror table tr')[0].children].map((c) => {
      const r = c.getBoundingClientRect()
      return { l: +r.left.toFixed(1), r: +r.right.toFixed(1) }
    }))
  const rowRects15 = (pg) => pg.evaluate(() =>
    [...document.querySelectorAll('.ProseMirror table tr')].map((tr) => {
      const r = tr.getBoundingClientRect()
      return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1) }
    }))
  /** 浮窗内 ask-ai / 「问问豆包」扫描：data-cmd + 按钮/菜单项的文本/title/aria-label。 */
  const askAiScan15 = (pg) => pg.evaluate(() => {
    const root = document.querySelector('.lark-doc-table-tools')
    if (!root) return null
    const byCmd = root.querySelectorAll('[data-cmd="ask-ai"]').length
    const ctrls = [...root.querySelectorAll('button, [role="menuitem"], .lark-doc-table-tools-menu-item, [data-value]')]
    const hits = ctrls.filter((n) => /问问豆包/.test(
      `${n.textContent || ''} ${n.getAttribute('title') || ''} ${n.getAttribute('aria-label') || ''}`))
      .map((n) => (n.textContent || '').trim() || n.getAttribute('title') || n.getAttribute('aria-label'))
    return { byCmd, askTextCount: hits.length, askTexts: hits }
  })
  /** 真实鼠标点第一个行选择条（整行 CellSelection），返回命中点几何。 */
  const openRowSel15 = async (pg, cellMid) => {
    await pg.mouse.click(cellMid.x, cellMid.y)
    await wait(400)
    const pt = await pg.evaluate(() => {
      const n = document.querySelector('.lark-doc-table-selector.is-row')
      if (!n) return null
      const r = n.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    if (pt) { await pg.mouse.click(pt.x, pt.y); await wait(500) }
    return pt
  }
  /** B 态前提：浮窗已出 + 命令清单恰为 EXPECTED_CMDS_B。 */
  const bStateOk15 = (snap) => snap.count === 1 && !!snap.node
    && JSON.stringify(snap.node.cmds) === JSON.stringify(EXPECTED_CMDS_B)

  // S15a 两态浮窗都不存在 data-cmd="ask-ai"，且无文本含「问问豆包」的按钮/菜单项。
  await resetDoc(page)
  const a15Text = await openTextSel(page, cellMid)
  const a15SnapA = await toolbarSnap(page)
  const a15ScanA = await askAiScan15(page)
  await resetDoc(page)
  const a15Col = await openCellSel(page, cellMid)
  const a15SnapB = await toolbarSnap(page)
  const a15ScanB = await askAiScan15(page)
  const a15Pre = !!a15Text.tr && a15Text.selText.length > 0 && !!a15Col
    && a15SnapA.count === 1 && !!a15SnapA.node && a15SnapB.count === 1 && !!a15SnapB.node
    && JSON.stringify(a15SnapA.node.cmds) === JSON.stringify(EXPECTED_CMDS_A)
    && bStateOk15(a15SnapB) && !!a15ScanA && !!a15ScanB
  rec('S15a', 'v12：两态浮窗都不存在 data-cmd="ask-ai"，且无文本含「问问豆包」的按钮/菜单项',
    a15Pre,
    a15ScanA.byCmd === 0 && a15ScanA.askTextCount === 0
      && a15ScanB.byCmd === 0 && a15ScanB.askTextCount === 0,
    `A态 cmds=${a15SnapA.node?.cmds.length} ask-ai按钮=${a15ScanA?.byCmd} 问问豆包控件=${a15ScanA?.askTextCount}[${(a15ScanA?.askTexts || []).join('|')}] | B态 cmds=${a15SnapB.node?.cmds.length} ask-ai按钮=${a15ScanB?.byCmd} 问问豆包控件=${a15ScanB?.askTextCount}[${(a15ScanB?.askTexts || []).join('|')}] A清单正确=${JSON.stringify(a15SnapA.node?.cmds) === JSON.stringify(EXPECTED_CMDS_A)} B清单正确=${bStateOk15(a15SnapB)}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-15-no-ask-ai.png'), clip })

  // S15b（v12c）：用户确认「复制选区链接」「评论」没有实际功能后两颗按钮整体下线。
  // 这里在 more 菜单**展开时**反向复查 —— 防止「按钮藏进下拉」的假下线：浮窗内
  // share-link / comment 的 data-cmd、中文同名可点控件、data-value=copyAnchorLink 全为 0。
  await resetDoc(page)
  const b15Sel = await openTextSel(page, cellMid)
  const b15PreSnap = await toolbarSnap(page)
  const b15More = await clickCmd(page, 'more')
  await wait(180)
  const b15Snap = await toolbarSnap(page)
  const b15Scan = await page.evaluate(() => {
    const root = document.querySelector('.lark-doc-table-tools')
    if (!root) return null
    const byCmd = ['share-link', 'comment'].map((c) => root.querySelectorAll(`[data-cmd="${c}"]`).length)
    const anchorItems = root.querySelectorAll('[data-value="copyAnchorLink"]').length
    const ctrls = [...root.querySelectorAll('button, [role="menuitem"], .lark-doc-table-tools-menu-item')]
    const byLabel = ['复制选区链接', '评论'].map((label) => ctrls.filter((n) =>
      (n.textContent || '').trim() === label
      || (n.getAttribute('title') || '').trim() === label
      || (n.getAttribute('aria-label') || '').trim() === label).length)
    return { byCmd, anchorItems, byLabel }
  })
  const b15Pre = !!b15Sel.tr && b15Sel.selText.length > 0 && b15More
    && b15PreSnap.count === 1 && !!b15PreSnap.node
    && JSON.stringify(b15PreSnap.node.cmds) === JSON.stringify(EXPECTED_CMDS_A)
    && !!b15Snap.node && b15Snap.count === 1 && b15Snap.node.menuName === 'more'
    && !!b15Scan
  rec('S15b', 'v12c：「复制选区链接」「评论」零入口 —— data-cmd / 中文同名控件 / copyAnchorLink 全为 0，more 菜单未补回',
    b15Pre,
    b15Scan.byCmd.every((n) => n === 0) && b15Scan.byLabel.every((n) => n === 0)
      && b15Scan.anchorItems === 0
      && !b15Snap.node.menuItems.includes('copyAnchorLink'),
    `byCmd=[${b15Scan?.byCmd.join(',')}] byLabel=[${b15Scan?.byLabel.join(',')}] more菜单项=[${b15Snap.node?.menuItems.join(',')}] 菜单含copyAnchorLink=${b15Snap.node?.menuItems.includes('copyAnchorLink')} data-value=copyAnchorLink残留=${b15Scan?.anchorItems}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-15-downline-buttons.png'), clip })

  // S15c 真实鼠标选列/选行 → 记录删除前每行单元格文本 → 点 remove →
  // 验证删掉的正是选中那一列/行（而不是相邻列/行）。两场景各自校验 B 态前提。
  // ── 列删除场景
  await resetDoc(page)
  const c15ColPt = await openCellSel(page, cellMid)
  const c15ColSnap = await toolbarSnap(page)
  const c15ColRects = await colRects15(page)
  const c15GridBeforeCol = await grid15(page)
  const c15ColIdx = c15ColPt
    ? c15ColRects.findIndex((r) => c15ColPt.x >= r.l - 1 && c15ColPt.x <= r.r + 1) : -1
  const c15RemovePt = await btnCenter(page, 'remove')
  const c15RemoveHit = c15RemovePt ? await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    return !!(el && el.closest('.lark-doc-table-tools-btn[data-cmd="remove"]'))
  }, c15RemovePt) : false
  const c15ColPre = !!c15ColPt && c15ColIdx >= 0 && bStateOk15(c15ColSnap)
    && !!c15RemovePt && c15GridBeforeCol.length >= 2 && c15GridBeforeCol[0].length >= 2
  const c15ColBtn = c15ColPre ? await clickCmd(page, 'remove') : false
  await wait(420)
  const c15GridAfterCol = await grid15(page)
  const c15ExpectedCol = c15GridBeforeCol.map((row) => row.filter((_, i) => i !== c15ColIdx))
  const c15ColOk = c15ColPre && c15ColBtn
    && c15GridAfterCol.length === c15GridBeforeCol.length
    && c15GridAfterCol[0].length === c15GridBeforeCol[0].length - 1
    && c15GridAfterCol.every((row, ri) => JSON.stringify(row) === JSON.stringify(c15ExpectedCol[ri]))
  // ── 行删除场景
  await resetDoc(page)
  const c15RowPt = await openRowSel15(page, cellMid)
  const c15RowSnap = await toolbarSnap(page)
  const c15RowRects = await rowRects15(page)
  const c15GridBeforeRow = await grid15(page)
  const c15RowIdx = c15RowPt
    ? c15RowRects.findIndex((r) => c15RowPt.y >= r.t - 1 && c15RowPt.y <= r.b + 1) : -1
  const c15RowPre = !!c15RowPt && c15RowIdx >= 0 && bStateOk15(c15RowSnap)
    && c15GridBeforeRow.length >= 2
  const c15RowBtn = c15RowPre ? await clickCmd(page, 'remove') : false
  await wait(420)
  const c15GridAfterRow = await grid15(page)
  const c15ExpectedRow = c15GridBeforeRow.filter((_, i) => i !== c15RowIdx)
  const c15RowOk = c15RowPre && c15RowBtn
    && c15GridAfterRow.length === c15GridBeforeRow.length - 1
    && c15GridAfterRow.every((row, ri) => JSON.stringify(row) === JSON.stringify(c15ExpectedRow[ri]))
  rec('S15c', 'v12：真实鼠标选列/选行后点 remove → 删掉的正是选中那一列/行（不是相邻列/行）',
    c15ColPre && c15RowPre,
    c15ColOk && c15RowOk,
    `列场景 选中列=${c15ColIdx} remove真实鼠标命中=${c15RemoveHit} B清单正确=${bStateOk15(c15ColSnap)} 删除前=${JSON.stringify(c15GridBeforeCol)} → 删除后=${JSON.stringify(c15GridAfterCol)} 期望=${JSON.stringify(c15ExpectedCol)} 命中=${c15ColOk} | 行场景 选中行=${c15RowIdx} B清单正确=${bStateOk15(c15RowSnap)} 删除前=${JSON.stringify(c15GridBeforeRow)} → 删除后=${JSON.stringify(c15GridAfterRow)} 期望=${JSON.stringify(c15ExpectedRow)} 命中=${c15RowOk}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-15-remove-selected-line.png'), clip })

  // S15d 删除后 tableSelectedLine 被清理、选择条 overlay 不再残留旧 label。
  await resetDoc(page)
  const d15Pt = await openCellSel(page, cellMid)
  const d15Snap = await toolbarSnap(page)
  const d15LineBefore = await tableSelLine(page)
  const d15SelBefore = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('.lark-doc-table-selector')]
    return { count: sels.length, labels: sels.map((n) => (n.textContent || '').trim()).filter(Boolean) }
  })
  const d15Pre = !!d15Pt && bStateOk15(d15Snap) && d15LineBefore.reachable
    && !d15LineBefore.isEmpty && d15SelBefore.count > 0
  const d15Btn = d15Pre ? await clickCmd(page, 'remove') : false
  await wait(420)
  const d15LineAfter = await tableSelLine(page)
  const d15SelAfter = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('.lark-doc-table-selector')]
    return { count: sels.length, labels: sels.map((n) => (n.textContent || '').trim()).filter(Boolean) }
  })
  const d15Residual = d15SelAfter.labels.filter((l) => d15SelBefore.labels.includes(l))
  rec('S15d', 'v12：删除后 tableSelectedLine 被清理、选择条 overlay 不再残留旧 label',
    d15Pre,
    d15Btn && d15LineAfter.reachable && d15LineAfter.isEmpty
      && (d15SelBefore.labels.length === 0 || d15Residual.length === 0),
    `删除前 line=${d15LineBefore.raw}(keys=[${d15LineBefore.keys.join(',')}]) 选择条=${d15SelBefore.count}[${d15SelBefore.labels.join('|')}] → 删除后 line=${d15LineAfter.raw} 已清理=${d15LineAfter.isEmpty} 选择条=${d15SelAfter.count}[${d15SelAfter.labels.join('|')}] 旧label残留=${d15Residual.length}[${d15Residual.join('|')}] B清单正确=${bStateOk15(d15Snap)}`)

  // S15 多次 resetDoc/删除，恢复干净文档再交回下面 S10 的既有流程。
  await resetDoc(page)

  // ═════════ S16：v12 第 4 条反馈（拖选多格 → multi 态浮窗 v12c 11 项）═════════
  // 不复用前面任何断言的结论：每条重新 resetDoc、重新真实拖选、重新取快照。
  // 拖选用 page.mouse down/move/up 真实划过单元格边界，产生非整行/整列 CellSelection；
  // 每条先校验前提（真拖出 CellSelection、浮窗真出、cellKind==='multi'），
  // 前提不成立记 INVALID 并输出诊断。S15 的 tableSelLine/grid15/bStateOk15 在同层作用域可复用。

  /** 单元格几何：按 (行, 列) 取单元格包围盒与中心点（行 0 是表头，行 1 起是数据行）。 */
  const cellRect16 = (pg, r, c) => pg.evaluate(({ rr, cc }) => {
    const cell = document.querySelectorAll('.ProseMirror table tr')[rr]?.children[cc]
    if (!cell) return null
    const b = cell.getBoundingClientRect()
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, x: b.left + b.width / 2, y: b.top + b.height / 2 }
  }, { rr: r, cc: c })

  /** 真实鼠标拖选：从 (r1,c1) 按下、分步拖过单元格边界、到 (r2,c2) 抬起。 */
  const dragCells16 = async (pg, r1, c1, r2, c2) => {
    const a = await cellRect16(pg, r1, c1)
    const b = await cellRect16(pg, r2, c2)
    if (!a || !b) return null
    await pg.mouse.move(a.l + 12, a.y)
    await pg.mouse.down()
    await pg.mouse.move(b.x, b.y, { steps: 14 })
    await pg.mouse.up()
    await wait(550)
    return { a, b }
  }

  /** 编辑器选区是否 CellSelection、覆盖几格（forEachCell 数格子，非 CellSelection 记 -1）。 */
  const selInfo16 = (pg) => pg.evaluate(() => {
    const ed = (window.__larkDoc || document.querySelector('lark-doc')).getEditor()
    const s = ed.state.selection
    let cells = -1
    try { cells = 0; s.forEachCell(ed.state.doc, () => { cells++ }) } catch { cells = -1 }
    return {
      isCell: s.$anchorCell != null && s.$headCell != null,
      cells,
      name: (s.constructor && s.constructor.name) || null,
    }
  })

  /**
   * v12 cellKind 是 `buildTableToolsState()` 的返回值（不落组件 data），VM 未暴露到 DOM。
   * 前提改用两个**可独立观测**的信号推断（避免循环论证）：
   *  - 编辑器当前选区是 CellSelection（$anchorCell/$headCell 都存在）；
   *  - 浮窗 bar 按钮集合的形状特征：含 table-header 且末尾 remove → line；
   *    无 table-header/remove 且末尾 more（v12c 后 comment 已下线）→ multi。
   */
  const toolsState16 = (pg) => pg.evaluate(() => {
    const ed = (window.__larkDoc || document.querySelector('lark-doc')).getEditor()
    const s = ed?.state?.selection
    const isCell = !!(s && s.$anchorCell != null && s.$headCell != null)
    const bar = document.querySelector('.lark-doc-table-tools .lark-doc-table-tools-bar')
    const cmds = bar ? [...bar.querySelectorAll('.lark-doc-table-tools-btn')].map((b) => b.getAttribute('data-cmd')) : []
    let kind = null
    if (bar && cmds.length) {
      if (cmds.includes('table-header') && cmds[cmds.length - 1] === 'remove') kind = 'line'
      else if (isCell && !cmds.includes('table-header') && !cmds.includes('remove')
        && !cmds.includes('comment') && !cmds.includes('share-link')
        && cmds[cmds.length - 1] === 'more') kind = 'multi'
    }
    return { reachable: true, open: !!bar, cellKind: kind, cellSelection: isCell, cmds }
  })

  /** multi 态 bar 子节点标签序列（11 button + 3 span 的固定顺序契约）。 */
  const barTags16 = (pg) => pg.evaluate(() => {
    const bar = document.querySelector('.lark-doc-table-tools .lark-doc-table-tools-bar')
    return bar ? [...bar.children].map((n) => n.tagName.toLowerCase()) : null
  })

  /** multi 契约：11 个 data-cmd 顺序 + bar 子节点 14 个标签序列 + 3 span（1 条 .is-full）。 */
  const multiOk16 = (snap, tags) => snap.count === 1 && !!snap.node
    && JSON.stringify(snap.node.cmds) === JSON.stringify(EXPECTED_CMDS_E)
    && JSON.stringify(tags) === JSON.stringify(EXPECTED_BAR_TAGS_E)
    && snap.node.separators === 3 && snap.node.fullSeparators === 1

  // S16a 拖选两个单元格 → 全页唯一统一浮窗、无 data-mode、11 个 data-cmd 顺序 ===
  // EXPECTED_CMDS_E（无 table-header/remove，末尾按钮是 more，下线两按钮不出现）。
  await resetDoc(page)
  const a16Drag = await dragCells16(page, 1, 0, 1, 1)
  const a16Sel = await selInfo16(page)
  const a16St = await toolsState16(page)
  const a16Snap = await toolbarSnap(page)
  const a16Tags = await barTags16(page)
  const a16Pre = !!a16Drag && a16Sel.isCell
    && a16St.reachable && a16St.cellKind === 'multi'
    && a16Snap.count === 1 && !!a16Snap.node
  rec('S16a', 'v12c：真实拖选两个单元格 → 全页唯一浮窗、无 data-mode、11 个 data-cmd 顺序 === EXPECTED_CMDS_E（无 table-header/remove、末尾 more）',
    a16Pre,
    a16Snap.count === 1 && a16Snap.legacy === 0 && a16Snap.bubbles === 0
      && a16Snap.node.hasModeAttr === false
      && multiOk16(a16Snap, a16Tags)
      && !a16Snap.node.cmds.includes('table-header') && !a16Snap.node.cmds.includes('remove')
      && !a16Snap.node.cmds.includes('comment') && !a16Snap.node.cmds.includes('share-link')
      && a16Snap.node.cmds[a16Snap.node.cmds.length - 1] === 'more',
    `拖选=${!!a16Drag} CellSelection=${a16Sel.isCell}(覆盖${a16Sel.cells}格,${a16Sel.name}) cellKind=${a16St.cellKind} tools=${a16Snap.count} legacy=${a16Snap.legacy} bubbles=${a16Snap.bubbles} hasModeAttr=${a16Snap.node?.hasModeAttr} cmds=[${a16Snap.node?.cmds.join(',')}] bar子节点=${a16Tags ? a16Tags.join(',') : 'null'} sep=${a16Snap.node?.separators}(is-full=${a16Snap.node?.fullSeparators})`)
  await page.screenshot({ path: path.join(OUT, 'selftest-16-multi-toolbar.png'), clip })

  // S16b multi 态 merge-cell 菜单：「合并单元格」不置灰且点击真合并两个单元格
  // （正文 HTML 出现 colspan/rowspan 或合并后格文本变化），随后「拆分单元格」解禁
  // 且点击真拆回（实现方式参考 S13c）。
  await resetDoc(page)
  const b16Drag = await dragCells16(page, 1, 0, 1, 1)
  const b16St = await toolsState16(page)
  const b16Menu = await clickCmd(page, 'merge-cell')
  await wait(160)
  const b16Merge = await menuItemState(page, 'merge-cell', 'mergeCells')
  const b16Split0 = await menuItemState(page, 'merge-cell', 'splitCell')
  const b16Html0 = await docHtml(page)
  const b16Merged = b16Merge.exists && !b16Merge.disabled
    ? await clickMenuItem(page, 'merge-cell', 'mergeCells') : false
  await wait(420)
  const b16Html1 = await docHtml(page)
  const b16Grid1 = await grid15(page)
  const b16MergeHit = /colspan="[2-9]|rowspan="[2-9]/.test(b16Html1)
    || (b16Grid1.length === 3 && b16Grid1[1].length === 2
      && /甲一/.test(b16Grid1[1][0]) && /甲二/.test(b16Grid1[1][0]))
  await clickCmd(page, 'merge-cell')
  await wait(160)
  const b16Split1 = await menuItemState(page, 'merge-cell', 'splitCell')
  const b16Split = b16Split1.exists && !b16Split1.disabled
    ? await clickMenuItem(page, 'merge-cell', 'splitCell') : false
  await wait(420)
  const b16Html2 = await docHtml(page)
  const b16Pre = !!b16Drag && b16St.reachable && b16St.cellKind === 'multi'
    && b16Menu && b16Merge.exists && b16Split0.exists && b16Html0 !== ''
  rec('S16b', 'v12：multi 态「合并单元格」不置灰且真合并（colspan/rowspan 或格文本变化），「拆分单元格」随后解禁并真拆回',
    b16Pre,
    b16Merge.disabled === false && b16Split0.disabled === true && b16Merged && b16Html0 !== b16Html1
      && b16MergeHit && b16Split1.disabled === false && b16Split && b16Html1 !== b16Html2,
    `merge.disabled=${b16Merge.disabled} 初始split.disabled=${b16Split0.disabled} 合并点击=${b16Merged} 结构变化=${b16Html0 !== b16Html1} 合并证据(colspan/rowspan或文本)=${b16MergeHit} 合并后网格=${JSON.stringify(b16Grid1)} 拆分解禁=${b16Split1.disabled === false} 拆分点击=${b16Split} 拆回变化=${b16Html1 !== b16Html2}`)

  // S16c multi 态锚点：浮窗 x 中心落在被拖选两个单元格包围盒的水平范围内
  // （容差 2px），或浮窗整体在表格上方（垂直翻转布局）。
  await resetDoc(page)
  const c16Drag = await dragCells16(page, 1, 0, 1, 1)
  const c16St = await toolsState16(page)
  const c16Tool = await page.evaluate(() => {
    const n = document.querySelector('.lark-doc-table-tools')
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  })
  const c16Pre = !!c16Drag && c16St.reachable && c16St.cellKind === 'multi' && !!c16Tool
  const c16UnionL = c16Drag ? Math.min(c16Drag.a.l, c16Drag.b.l) : NaN
  const c16UnionR = c16Drag ? Math.max(c16Drag.a.r, c16Drag.b.r) : NaN
  const c16TOL = 2
  const c16InX = !!c16Tool && !Number.isNaN(c16UnionL)
    && c16Tool.cx >= c16UnionL - c16TOL && c16Tool.cx <= c16UnionR + c16TOL
  const c16Above = !!c16Tool && c16Tool.b <= geo.table.t + c16TOL
  rec('S16c', 'v12：multi 态浮窗锚点 —— x 中心落在被拖两格包围盒水平范围内（或整体在表格上方）',
    c16Pre,
    c16InX || c16Above,
    `浮窗中心=(${c16Tool ? c16Tool.cx.toFixed(1) : 'null'}, ${c16Tool ? c16Tool.cy.toFixed(1) : 'null'}) 浮窗底=${c16Tool ? c16Tool.b.toFixed(1) : 'null'} 拖选两格并集x=[${c16UnionL.toFixed(1)}, ${c16UnionR.toFixed(1)}] 表格top=${geo.table.t.toFixed(1)} 命中x范围=${c16InX} 在表格上方=${c16Above} 容差=${c16TOL}px`)

  // S16d 残留标记清理：先点列选择条（line 态，B 13 项），再真实拖选两个单元格
  // （multi 态）。断言：浮窗切到 11 项 multi 契约、锚点不再指向旧列（新浮窗 x 落在
  // 新两格并集内且与旧列选择条 x 明显错开）、tableSelectedLine 清空或与新选区一致。
  await resetDoc(page)
  const d16ColPt = await openCellSel(page, cellMid)
  const d16StLine = await toolsState16(page)
  const d16SnapLine = await toolbarSnap(page)
  const d16Line0 = await tableSelLine(page)
  const d16Old = await page.evaluate(() => {
    const col = document.querySelector('.lark-doc-table-selector.is-column')
    const tool = document.querySelector('.lark-doc-table-tools')
    const cr = col?.getBoundingClientRect()
    const tr = tool?.getBoundingClientRect()
    return { colX: cr ? cr.left + cr.width / 2 : null, toolCx: tr ? tr.left + tr.width / 2 : null }
  })
  const d16Drag = await dragCells16(page, 1, 1, 1, 2)
  const d16St = await toolsState16(page)
  const d16Snap = await toolbarSnap(page)
  const d16Line1 = await tableSelLine(page)
  const d16Tool = await page.evaluate(() => {
    const t = document.querySelector('.lark-doc-table-tools')?.getBoundingClientRect()
    return t ? { cx: t.left + t.width / 2, b: t.bottom } : null
  })
  const d16Pre = !!d16ColPt && d16StLine.reachable && d16StLine.cellKind === 'line'
    && bStateOk15(d16SnapLine) && d16Line0.reachable && !d16Line0.isEmpty
    && !!d16Old.colX && !!d16Drag && d16St.reachable && d16St.cellKind === 'multi'
    && d16Snap.count === 1 && !!d16Snap.node
  const d16UnionL = d16Drag ? Math.min(d16Drag.a.l, d16Drag.b.l) : NaN
  const d16UnionR = d16Drag ? Math.max(d16Drag.a.r, d16Drag.b.r) : NaN
  const d16InNew = !!d16Tool && !Number.isNaN(d16UnionL)
    && (d16Tool.cx >= d16UnionL - 2 && d16Tool.cx <= d16UnionR + 2 || d16Tool.b <= geo.table.t + 2)
  const d16LeftOld = !!d16Tool && !!d16Old.colX && Math.abs(d16Tool.cx - d16Old.colX) > 8
  const d16LineOk = d16Line1.reachable && (d16Line1.isEmpty || d16Line1.raw !== d16Line0.raw)
  rec('S16d', 'v12c：line→multi 切换 —— 浮窗切到 11 项 multi 契约、锚点离开旧列、tableSelectedLine 清空或与新选区一致',
    d16Pre,
    d16Snap.count === 1 && JSON.stringify(d16Snap.node.cmds) === JSON.stringify(EXPECTED_CMDS_E)
      && d16InNew && d16LeftOld && d16LineOk,
    `line态 cellKind=${d16StLine.cellKind} cmds=${d16SnapLine.node?.cmds.length} 旧列选择条x=${d16Old.colX?.toFixed(1)} 旧浮窗x=${d16Old.toolCx?.toFixed(1)} | multi态 cellKind=${d16St.cellKind} cmds=${d16Snap.node?.cmds.length} 新浮窗x=${d16Tool?.cx?.toFixed(1)} 新两格并集x=[${d16UnionL.toFixed(1)}, ${d16UnionR.toFixed(1)}] 锚点命中新范围或表格上方=${d16InNew} 离开旧列(偏移${Math.abs((d16Tool?.cx ?? 0) - (d16Old.colX ?? 0)).toFixed(1)}px)=${d16LeftOld} | tableSelectedLine 前=${d16Line0.raw} 后=${d16Line1.raw} 清理=${d16LineOk}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-16-line-to-multi.png'), clip })

  // ── S17 拖列宽跟随（v12b）：prosemirror-tables 的 mousemove 只 `displayColumnWidth()`
  // 直改 DOM 宽度、**不派发 transaction**（transaction 只在 mouseup 发一次），挂在
  // transaction hook 上的选择条刷新全程不跑 —— 真实复现「拖拽列宽时顶部的条没有
  // 跟着一起变」。修复 = 活跃 `resize-cursor` 期间 rAF 持续同步。本段用真实鼠标贴近
  // 单元格右缘热区（≤5px）→ 出现 resize 手柄 → 按下分步拖拽，全程采样对比。
  await resetDoc(page)
  await page.mouse.click(cellMid.x, cellMid.y)
  await wait(300)
  const edge17 = await page.evaluate(() => {
    const td = document.querySelectorAll('.ProseMirror table td')[1]
    if (!td) return null
    const r = td.getBoundingClientRect()
    return { x: r.right - 3, y: r.top + r.height / 2, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  })
  let handle17 = 0
  if (edge17) {
    await page.mouse.move(edge17.cx, edge17.cy)
    await wait(80)
    await page.mouse.move(edge17.x, edge17.y, { steps: 6 })
    await wait(200)
    handle17 = await page.evaluate(() => document.querySelectorAll('.ProseMirror .column-resize-handle').length)
  }
  const bars17 = () => page.evaluate(() => {
    const sel = [...document.querySelectorAll('.lark-doc-table-selector.is-column')]
    const cells = [...(document.querySelector('.ProseMirror table')?.querySelector('tr')?.cells || [])]
    const pair = (n) => { const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] }
    return { bars: sel.map(pair), cells: cells.map(pair) }
  })
  const aligned17 = (s) => s.bars.length === s.cells.length
    && s.bars.every((b, i) => Math.abs(b[0] - s.cells[i][0]) <= 3 && Math.abs(b[1] - s.cells[i][1]) <= 3)
  const samples17 = []
  let released17 = null
  if (handle17 > 0 && edge17) {
    await page.mouse.down()
    await wait(80)
    for (let i = 1; i <= 5; i += 1) {
      await page.mouse.move(edge17.x - i * 14, edge17.y)
      await wait(90)
      samples17.push(await bars17())
    }
    await page.screenshot({ path: path.join(OUT, 'selftest-17-bars-follow.png') })
    await page.mouse.up()
    await wait(400)
    released17 = await bars17()
  }
  const pre17 = handle17 > 0 && !!edge17 && samples17.length > 0
  rec('S17a', 'v12b：拖列宽全程（真实鼠标分步拖拽）顶部列选择条与列几何一致',
    pre17,
    samples17.every((s) => aligned17(s)),
    `采样=${samples17.length}步 对齐步=[${samples17.map((s, i) => (aligned17(s) ? i + 1 : null)).filter(Boolean).join(',')}] 失配步=[${samples17.map((s, i) => (!aligned17(s) ? i + 1 : null)).filter(Boolean).join(',') || '无'}] 手柄=${handle17}`)
  rec('S17b', 'v12b：松手后（transaction 派发）选择条与列几何一致',
    pre17,
    !!released17 && aligned17(released17),
    `松手后 bars=${JSON.stringify(released17?.bars)} cells=${JSON.stringify(released17?.cells)}`)

  // ── S18 v12c：按钮点击盒与顶部功能栏对齐 + 两颗下线按钮三态复查 ──
  // 用户反馈「table 的浮窗栏按钮大小有点小，看看是不是要和顶部功能栏按钮图标大小一致呢」。
  // 基线实测：顶部普通按钮 30×30、浮窗普通按钮 24×30，两边 SVG 图标本来都已是 16×16，
  // 偏小的是点击盒 / 圆角 / 内边距。修复后浮窗改 30×30（bar 高 30、容器总高仍 42）。
  const sizeScan18 = (pg) => pg.evaluate(() => {
    const bb = (n) => { const r = n.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }
    const float = document.querySelector('.lark-doc-table-tools')
    const bar = float?.querySelector('.lark-doc-table-tools-bar')
    const fb = float?.querySelector('.lark-doc-table-tools-btn:not(.has-caret)')
    const tb = [...document.querySelectorAll('.lark-doc-toolbar .lark-doc-tools button')]
      .find((n) => !n.querySelector('.lark-doc-caret') && n.querySelector('svg'))
    const fcs = fb ? getComputedStyle(fb) : null
    const downline = ['share-link', 'comment'].map((c) => document.querySelectorAll(`[data-cmd="${c}"]`).length)
    return {
      fbtn: fb ? bb(fb) : null, tbtn: tb ? bb(tb) : null,
      ficon: fb?.querySelector('svg') ? bb(fb.querySelector('svg')) : null,
      ticon: tb?.querySelector('svg') ? bb(tb.querySelector('svg')) : null,
      bar: bar ? bb(bar) : null, float: float ? bb(float) : null,
      radius: fcs?.borderRadius, padding: fcs?.padding, minHeight: fcs?.minHeight,
      downline,
      cmds: float ? [...float.querySelectorAll('button[data-cmd]')].map((n) => n.dataset.cmd) : [],
    }
  })
  const sizeOk18 = (m) => !!m.fbtn && !!m.tbtn
    && m.fbtn.w === 30 && m.fbtn.h === 30 && m.tbtn.w === 30 && m.tbtn.h === 30
    && m.ficon?.w === 16 && m.ficon?.h === 16 && m.ticon?.w === 16 && m.ticon?.h === 16
    && m.bar?.h === 30 && m.float?.h === 42
    && m.radius === '6px' && m.padding === '0px 6px' && m.minHeight === '30px'
  const downlineOk18 = (m) => m.downline.every((n) => n === 0)
    && !m.cmds.includes('share-link') && !m.cmds.includes('comment')

  await resetDoc(page)
  const a18Sel = await openTextSel(page, cellMid)
  const m18Text = await sizeScan18(page)
  rec('S18a', 'v12c：文字态浮窗普通按钮 30×30 == 顶部功能栏 30×30；两边图标仍同为 16×16；bar 高 30、浮窗高 42',
    !!a18Sel.tr && a18Sel.selText.length > 0 && !!m18Text.fbtn && !!m18Text.tbtn,
    sizeOk18(m18Text),
    `浮窗按钮=${JSON.stringify(m18Text.fbtn)} 顶部按钮=${JSON.stringify(m18Text.tbtn)} 图标=${JSON.stringify(m18Text.ficon)}/${JSON.stringify(m18Text.ticon)} bar=${JSON.stringify(m18Text.bar)} float=${JSON.stringify(m18Text.float)} radius=${m18Text.radius} padding=${m18Text.padding} minHeight=${m18Text.minHeight}`)
  await page.screenshot({ path: path.join(OUT, 'selftest-18-viewport.png') })
  await page.screenshot({ path: path.join(OUT, 'selftest-18-float-closeup.png'), clip })

  rec('S18b', 'v12c：文字态全页无 share-link / comment 按钮',
    !!m18Text.fbtn,
    downlineOk18(m18Text),
    `byCmd=[${m18Text.downline.join(',')}] cmds=[${m18Text.cmds.join(',')}]`)

  await resetDoc(page)
  const b18Col = await openCellSel(page, cellMid)
  const m18Line = await sizeScan18(page)
  rec('S18c', 'v12c：整列态同样 30×30 对齐，且下线两按钮未复活',
    !!b18Col && !!m18Line.fbtn && JSON.stringify(m18Line.cmds) === JSON.stringify(EXPECTED_CMDS_B),
    sizeOk18(m18Line) && downlineOk18(m18Line),
    `浮窗按钮=${JSON.stringify(m18Line.fbtn)} byCmd=[${m18Line.downline.join(',')}] cmds=[${m18Line.cmds.join(',')}]`)

  await resetDoc(page)
  const c18Drag = await dragCells16(page, 1, 0, 1, 1)
  const c18St = await toolsState16(page)
  const m18Multi = await sizeScan18(page)
  rec('S18d', 'v12c：multi 态同样 30×30 对齐、末尾收在 more，且下线两按钮未复活',
    !!c18Drag && c18St.cellKind === 'multi' && !!m18Multi.fbtn
      && JSON.stringify(m18Multi.cmds) === JSON.stringify(EXPECTED_CMDS_E),
    sizeOk18(m18Multi) && downlineOk18(m18Multi) && m18Multi.cmds[m18Multi.cmds.length - 1] === 'more',
    `浮窗按钮=${JSON.stringify(m18Multi.fbtn)} byCmd=[${m18Multi.downline.join(',')}] cmds=[${m18Multi.cmds.join(',')}]`)

  // ═════════ S19：v12d ＋ 悬浮提示（飞书真源两张截图：列 ＋ →「插入列」、行 ＋ →「插入行」）═════════
  // 真实鼠标：hover 边线不弹 → hover ＋（150ms 延迟）弹深底白字气泡 + 朝下箭头 → 离开即收。
  const tipScan = (pg) => pg.evaluate(() => {
    const wrap = document.querySelector('.lark-doc-table-boundary-tools')
    const tip = wrap?.querySelector('.lark-doc-table-boundary-tip')
    const plus = wrap?.querySelector('button')
    if (!wrap || !tip || !plus) return null
    const tr = tip.getBoundingClientRect()
    const pr = plus.getBoundingClientRect()
    const cs = getComputedStyle(tip)
    return {
      text: tip.textContent.trim(),
      role: tip.getAttribute('role'),
      visible: tip.classList.contains('is-visible') && cs.visibility === 'visible' && parseFloat(cs.opacity) === 1,
      bg: cs.backgroundColor, arrowBg: getComputedStyle(tip, '::after').borderTopColor,
      fontSize: cs.fontSize, radius: cs.borderRadius, pointerEvents: cs.pointerEvents,
      tipTop: +tr.y.toFixed(1), tipBottom: +tr.bottom.toFixed(1), tipRight: +tr.right.toFixed(1),
      tipCx: +(tr.x + tr.width / 2).toFixed(1),
      plusTop: +pr.top.toFixed(1), plusCx: +(pr.x + pr.width / 2).toFixed(1),
      vw: window.innerWidth,
    }
  })
  const tipGeomOk = (m) => !!m && m.tipBottom <= m.plusTop + 2 && Math.abs(m.tipCx - m.plusCx) <= 6
    && m.tipTop >= 0 && m.tipRight <= m.vw

  await resetDoc(page)
  // 真实鼠标 hover 列边线；resetDoc 后首个 pointerover 偶发被 re-render 吞掉，最多重试 3 次。
  let m19Line = null
  for (let i = 0; i < 3 && !m19Line; i++) {
    await page.mouse.move(cellMid.x, cellMid.y)
    await wait(350)
    await page.mouse.move(geo.td.r - 2, geo.td.t + 18)
    await wait(450)
    m19Line = await tipScan(page)
  }
  rec('S19a', 'v12d：只 hover 列边线未碰 ＋ → tip 不提前弹出（150ms 延迟；文本已按轴就绪「插入列」）',
    !!m19Line,
    !!m19Line && m19Line.visible === false && m19Line.text === '插入列',
    `visible=${m19Line?.visible} text=${m19Line?.text}`)

  const plusPt19 = await page.evaluate(() => {
    const b = document.querySelector('.lark-doc-table-boundary-tools button')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (plusPt19) { await page.mouse.move(plusPt19.x, plusPt19.y); await wait(420) }
  const m19Col = await tipScan(page)
  rec('S19b', 'v12d：hover 列 ＋ → 飞书同款 tip 可见：role=tooltip、「插入列」、深底白字 12px / radius 8px、pointer-events:none',
    !!m19Col,
    !!m19Col && m19Col.visible === true && m19Col.role === 'tooltip' && m19Col.text === '插入列'
      && m19Col.bg === m19Col.arrowBg && m19Col.bg !== 'rgba(0, 0, 0, 0)'
      && m19Col.fontSize === '12px' && m19Col.radius === '8px' && m19Col.pointerEvents === 'none',
    `visible=${m19Col?.visible} text=${m19Col?.text} bg=${m19Col?.bg} arrow=${m19Col?.arrowBg} font=${m19Col?.fontSize} radius=${m19Col?.radius}`)
  rec('S19c', 'v12d：列 tip 几何 —— 底边在 ＋ 圆点上方（箭头搭在圆点顶缘）、水平对齐圆心、不越视口',
    !!m19Col, tipGeomOk(m19Col),
    `tipBottom=${m19Col?.tipBottom} plusTop=${m19Col?.plusTop} tipCx=${m19Col?.tipCx} plusCx=${m19Col?.plusCx}`)
  if (plusPt19) {
    await page.screenshot({ path: path.join(OUT, 'selftest-19-tip-column.png'), clip: { x: Math.max(0, plusPt19.x - 140), y: Math.max(0, plusPt19.y - 110), width: 320, height: 200 } })
  }

  // 行轴：真实鼠标移到行边界 → tip 文本切「插入行」；离开 ＋ 先收起。同样带重试。
  let m19RowLine = null
  for (let i = 0; i < 3 && !m19RowLine; i++) {
    await page.mouse.move(geo.td.l + 30, geo.td.b - 2)
    await wait(500)
    m19RowLine = await tipScan(page)
  }
  rec('S19d', 'v12d：切到行轴 → tip 文本同步切「插入行」，未 hover ＋ 时不可见',
    !!m19RowLine,
    !!m19RowLine && m19RowLine.visible === false && m19RowLine.text === '插入行',
    `visible=${m19RowLine?.visible} text=${m19RowLine?.text}`)
  const rowPlusPt19 = await page.evaluate(() => {
    const b = document.querySelector('.lark-doc-table-boundary-tools button')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (rowPlusPt19) { await page.mouse.move(rowPlusPt19.x, rowPlusPt19.y); await wait(420) }
  const m19Row = await tipScan(page)
  rec('S19e', 'v12d：hover 行 ＋ → tip「插入行」可见，几何同列态（底边在圆点上方、水平对齐圆心）',
    !!m19Row,
    !!m19Row && m19Row.visible === true && m19Row.text === '插入行' && tipGeomOk(m19Row),
    `visible=${m19Row?.visible} text=${m19Row?.text} tipBottom=${m19Row?.tipBottom} plusTop=${m19Row?.plusTop} tipCx=${m19Row?.tipCx} plusCx=${m19Row?.plusCx}`)
  if (rowPlusPt19) {
    await page.screenshot({ path: path.join(OUT, 'selftest-19-tip-row.png'), clip: { x: Math.max(0, rowPlusPt19.x - 140), y: Math.max(0, rowPlusPt19.y - 110), width: 320, height: 200 } })
  }

  await page.mouse.move(geo.out.x, geo.out.y)
  await wait(300)
  const m19After = await tipScan(page)
  rec('S19f', 'v12d：鼠标离开边界条 → tip 与边界条一起收起（无残留气泡）',
    true,
    m19After === null || m19After.visible === false,
    `wrap=${m19After ? '在' : '收'} visible=${m19After?.visible}`)

  // 恢复一个「表格浮窗 + 选择条可见」的真实状态，供 S10a（打印态隐藏）做有效判定。
  await openTextSel(page, cellMid)

  // ── S10 打印态隐藏
  await page.emulateMedia({ media: 'print' })
  await wait(300)
  const printVisible = await page.evaluate(() => {
    // 打印规则隐藏的是父容器（.lark-doc-table-overlay）：子元素 computed display
    // 仍是原值，必须用「是否还在渲染树里」判定，否则会假报 FAIL。
    const sels = [...document.querySelectorAll('.lark-doc-table-selector, .lark-doc-table-boundary-tools, .lark-doc-table-tools, .lark-doc-table-overlay')]
    return sels.filter((n) => {
      const c = getComputedStyle(n)
      return n.getClientRects().length > 0 && c.visibility !== 'hidden' && parseFloat(c.opacity) > 0.01
    }).length
  })
  rec('S10a', '打印态：所有表格 UI 隐藏', true, printVisible === 0, `仍可见=${printVisible}`)
  await page.emulateMedia({ media: 'screen' })

  rec('S11a', '页面无 JS 运行时错误', true, pageErrors.length === 0, `errors=${pageErrors.length} ${pageErrors.slice(0, 2).join(' | ')}`)

  const pass = rows.filter((r) => r.status === 'PASS').length
  const fail = rows.filter((r) => r.status === 'FAIL').length
  const invalid = rows.filter((r) => r.status === 'INVALID').length
  console.log(`\n汇总: PASS=${pass} FAIL=${fail} INVALID=${invalid} 共${rows.length}`)
  fs.writeFileSync(path.join(OUT, 'selftest-result.json'), JSON.stringify({ url: URL, geo, rows, pass, fail, invalid, pageErrors }, null, 2))
  await browser.close()
  process.exit(fail > 0 || invalid > 0 ? 1 : 0)
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(2) })
