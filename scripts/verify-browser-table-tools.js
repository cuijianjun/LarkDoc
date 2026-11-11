'use strict'
/**
 * 浏览器级验证：v11 飞书统一浮窗 + 表格边界 ＋ + md 浮层几何
 * （feat/md-table-interaction · v11 契约）。
 *
 * 这三条都是原生 DOM（`src/ui/tableTools.js` / `src/ui/tableOverlays.js`），显隐由
 * 编辑器实时 state + 离散 pointerdown 驱动，不是状态机。所以断言必须真的把光标放进
 * 单元格、真的选中文字、真的点选择条、真的把鼠标移到边线上 —— 改 data 伪造只能证明
 * `v-if` 写对了，证明不了驱动源。
 *
 * v11（用户要求「浮窗 1:1 对齐飞书：图标与下拉箭头统一到顶部功能栏那一套、下拉交互
 * 改成 hover 打开 + 150ms 延迟关 + click 切换、删掉自造的 table-ops 与「更多」里暂不
 * 具备的 4 项；文字态 12 项 / 选择条态 14 项按上下文 syncChildren 真摘除插入」）后的
 * 核心契约（v12c 已把「复制选区链接」「评论」两颗无实现按钮从三态全部摘除，
 * 项数改为 文字态 10 / 选择条态 13 / 多格拖选态 11；按钮点击盒对齐顶部 30×30）：
 *   ① 全页面**只有一个**浮窗 DOM：`.lark-doc-table-tools`。旧 `.lark-doc-table-float`
 *      整层删除，任何时刻 `querySelectorAll` 计数只能是 0 或 1。
 *   ② 根 `div[role=toolbar][aria-label=表格工具]` position:fixed，**不再有** `data-mode`、
 *      `.is-text-mode`、`.is-table-mode`。两种选区（表格内非空文字选区 / 点行列选择条
 *      产生的整行整列 CellSelection）弹出的是**同一个浮窗 DOM 根节点**，items 按上下文
 *      用 syncChildren 在同一条 bar 上真摘除/插入：v12c 后文字态 10 个 data-cmd、
 *      选择条态 13 个 data-cmd（B 比 A 多 3 颗表格专属按钮、去掉 link、末尾多 remove）。
 *      v12 反馈④（「选中两个单元格或者多个，功能栏浮窗的按钮不对」）后共有**三种上下文**
 *      （`buildTableToolsState().cellKind`）：文字态 text 10 项 / 整行整列 line 13 项 /
 *      **拖选两个及以上单元格 multi 11 项**（局部 CellSelection，飞书形态 E：开头 合并/背景、
 *      没有 table-header、没有 remove、末尾收在 more）。
 *      ⚠️ v12c：`share-link`（假 `#pos=` 链接、无 hash 解析 / 无宿主接线）与 `comment`
 *      （无 Provider 时只有本地 mark、无评论面板）都已下线，全页不得再出现这两个
 *      data-cmd 或同名可点控件；命令分发里的假分支也一并删除。
 *   ③ 根子节点 = `div.lark-doc-table-tools-bar`（常驻）+ 最多 1 个
 *      `div.lark-doc-table-tools-menu[data-menu][role=menu]`（打开下拉才挂、真摘除）。
 *   ④ **`table-ops` 按钮被彻底删除**：任何 `data-cmd=table-ops` / `data-menu=table-ops` /
 *      `action:*` 菜单项都不应存在。表格结构操作改由边界 ＋、`merge-cell` / `table-header`
 *      下拉、末尾 `remove`、`align` 的 valign 项等真源入口承接。
 *   ⑤ 图标与下拉箭头统一到 `iconNode()` 那套：按钮内
 *      `span.lark-doc-table-tools-icon.lark-doc-icon > svg`（16×16），caret
 *      `span.lark-doc-caret.lark-doc-icon > svg`（12px），菜单项图标
 *      `span.lark-doc-table-tools-menu-icon.lark-doc-icon > svg`；不再有字符
 *      `.lark-doc-table-tools-glyph` / `.lark-doc-table-tools-caret`。
 *   ⑥ 下拉交互同顶部功能栏：hover/focus 打开、mouseleave 排 150ms 关、进菜单取消关、
 *      离菜单再排关；hover 打开时点触发按钮不关，click 打开时再点关；Escape / 点外部关；
 *      同一时刻最多 1 个菜单，切换时旧菜单节点真摘除。「更多」裁到 2 项
 *      （translate / larkSearch）；被删的 5 项（含 v12 新删的 copyAnchorLink）不在菜单里。
 *   ⑦ 显隐触发条件不变：表格内非空文字选区、点行列选择条产生的整行整列 CellSelection、
 *      或拖选两个及以上单元格的局部 CellSelection（v12 multi 态）才出；点外部 / Escape
 *      消失；只读态不出；打印态隐藏；`.lark-doc-bubble` 在表格浮窗打开时必须为 0（防双窗）。
 *   ⑧ v12d：边界 ＋ hover 出飞书同款悬浮提示（列「插入列」/ 行「插入行」，深底白字 12px +
 *      radius 8px + 朝下箭头，150ms 延迟、离开即收、pointer-events:none）；原生 title
 *      同步移除防双重 tooltip。tip 常驻边界条根内（childTags = span,button,div），
 *      只 hover 边线未碰 ＋ 时不得提前弹出。
 *
 * v4（WorkBuddy `nearestIdx` 1:1）保留的几何契约（本轮全部不动）：
 *   ⑧ 边界条一条边线只有一颗 ＋；v6 起 hover 内部边线即挂 hover line（反馈⑦），
 *      线长严格 = 表格内部尺寸；最左 / 最上外边缘不产生 ＋。
 *   ⑨ md 浮层：12px 选择条 / 双向渐隐 / 自绘滚动条 / 拖拽重排；v7 窄表格线不越界、
 *      零可见蓝胶囊；v8 ＋ 按钮底色透明；v9 纯 hover 内部边线即出 ＋ 与高亮线。
 *
 * 宿主自适应：`window.__larkDoc`（8080 demo）或 `<lark-doc>` Web Component
 * （8123 `examples/element-demo.html`）。两者都是 light DOM、都暴露
 * `getEditor()/setContent()/setReadonly()`，脚本不依赖具体宿主。
 *
 * 用法：
 *   NODE_PATH=... node scripts/verify-browser-table-tools.js [url]
 *   LARK_DOC_VERIFY_URL=http://127.0.0.1:8123/examples/element-demo.html \
 *     node scripts/verify.mjs table-tools
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const results = []

// v11 契约常量（v12c 更新）：飞书单行工具条三种上下文 data-cmd 固定顺序（文字态 10 /
// 选择条态 13 / multi 拖选态 11）、各上下文 bar 子节点 tag 序列（按 src/ui/tableTools.js
// 的 toolbarItems() 逐项展开）、5 个 mark 按钮 / 3 颗表格专属按钮 / 4 个 caret 菜单按钮、
// 两态菜单按钮集合、「更多」保留 2 项与被删 5 项、「转换为」11 个菜单项、对齐 8 个菜单项。
const EXPECTED_CMDS_A = [
  'turninto', 'align', 'bold', 'strike', 'italic', 'underline',
  'link', 'code', 'highlight', 'more',
]
const EXPECTED_CMDS_B = [
  'table-header', 'merge-cell', 'cell-bg', 'turninto', 'align',
  'bold', 'strike', 'italic', 'underline', 'code', 'highlight', 'more', 'remove',
]
// toolbarItems('text') = [TURN, ALIGN, DIV, ...MARKS, FULL_DIV, ...TAIL]
// → 10 button + 2 span（其中 1 条 .is-full）；toolbarItems('line') 多一组 CELL_* 与前置
// DIV、末尾 REMOVE → 13 button + 3 span。条数由 tag 序列推导，不沿用 v10 的 18 按钮 / 4 分隔线。
const EXPECTED_BAR_TAGS_A = [
  'button', 'button', 'span', 'button', 'button', 'button', 'button', 'button',
  'button', 'button', 'span', 'button',
]
const EXPECTED_BAR_TAGS_B = [
  'button', 'button', 'button', 'span', 'button', 'button', 'span', 'button',
  'button', 'button', 'button', 'button', 'button', 'span', 'button', 'button',
]
const SEP_A = EXPECTED_BAR_TAGS_A.filter((t) => t === 'span').length
const SEP_B = EXPECTED_BAR_TAGS_B.filter((t) => t === 'span').length
// v12 形态 E / v12c：拖选两个及以上单元格（局部 CellSelection，cellKind='multi'）→ 11 项。
// 开头是 合并单元格 / 单元格背景（🔴 没有 table-header），末尾是 more（🔴 不是 remove、也不是已下线的评论）。
const EXPECTED_CMDS_E = [
  'merge-cell', 'cell-bg', 'turninto', 'align', 'bold', 'strike',
  'italic', 'underline', 'code', 'highlight', 'more',
]
// toolbarItems('multi') = [MERGE, BG, DIV, TURN, ALIGN, DIV, ...MARKS(去 link),
// FULL_DIV, ...TAIL] → 11 button + 3 span（其中 1 条 .is-full）。
const EXPECTED_BAR_TAGS_E = [
  'button', 'button', 'span', 'button', 'button', 'span', 'button', 'button',
  'button', 'button', 'button', 'button', 'span', 'button',
]
const SEP_E = EXPECTED_BAR_TAGS_E.filter((t) => t === 'span').length
const MARK_CMDS = ['bold', 'strike', 'italic', 'underline', 'code']
const TABLE_ONLY_CMDS = ['table-header', 'merge-cell', 'cell-bg']
const CARET_CMDS = ['turninto', 'align', 'highlight', 'more']
const MENU_CMDS_A = ['turninto', 'align', 'highlight', 'more']
const MENU_CMDS_B = ['table-header', 'merge-cell', 'cell-bg', 'turninto', 'align', 'highlight', 'more']
const MORE_ITEMS = ['translate', 'larkSearch']
const MORE_REMOVED = ['searchWeb', 'saveBlockTemplate', 'newChildDocWithContent', 'create-lingo', 'copyAnchorLink']
const TURN_INTO_ITEMS = [
  'paragraph', 'heading1', 'heading2', 'heading3', 'orderedList', 'bulletList',
  'taskList', 'codeBlock', 'blockquote', 'callout', 'synced',
]
const ALIGN_ITEMS = [
  'align:left', 'align:center', 'align:right', 'valign:top', 'valign:middle',
  'valign:bottom', 'indent:1', 'indent:-1',
]

function findChromium() {
  const cache = path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    for (const candidate of [
      path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]) if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function record(name, ok, detail = '') {
  results.push({ ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ══════════════ 页面内工具函数（必须自包含：会被 page.evaluate 序列化执行） ══════════════

/** 两套宿主统一门面：8080 demo 用 `window.__larkDoc`，8123 element-demo 用 `<lark-doc>`。
 *  注意：page.evaluate 里的函数会被**单独序列化**到浏览器，Node 层的顶层变量在页面里
 *  并不存在，所以每处都内联 `(window.__larkDoc || document.querySelector('lark-doc'))`，
 *  不要抽成顶层函数再从页面内调用（会得到 ReferenceError: hostApi is not defined）。 */

/**
 * v11 统一浮窗快照。⚠️ 未挂载时不是返回 null 就完事，还要给出全页节点计数，
 * 才能验「只有一个浮窗 DOM」这条最高优先级契约；挂载后逐字段量两态 data-cmd、
 * 分隔线、mark 按钮 aria-pressed、SVG 图标 / SVG caret / 字符 glyph 残留，以及菜单
 * （真挂载 / 真摘除 / 最多 1 个 / 菜单项图标与置灰）。
 */
const measureToolbar = () => {
  const nodes = document.querySelectorAll('.lark-doc-table-tools')
  const legacy = document.querySelectorAll('.lark-doc-table-float')
  const snapshot = { count: nodes.length, legacy: legacy.length, node: null }
  if (!nodes.length) return snapshot
  const el = nodes[0]
  const rootChildren = [...el.children]
  const bar = el.querySelector('.lark-doc-table-tools-bar')
  const barChildren = bar ? [...bar.children] : []
  const menus = [...el.querySelectorAll('.lark-doc-table-tools-menu[data-menu]')]
  const menu = menus[0] || null
  const buttons = barChildren.filter((n) => n.tagName === 'BUTTON' && n.classList.contains('lark-doc-table-tools-btn'))
  const seps = barChildren.filter((n) => n.classList.contains('lark-doc-table-tools-sep'))
  const cs = getComputedStyle(el)
  snapshot.node = {
    tag: el.tagName.toLowerCase(),
    classes: [...el.classList],
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    // v11：根不再有 mode 属性；保留 mode/hasModeAttr 字段专门用于「必须为 null / 不存在」的断言。
    mode: el.dataset.mode || null,
    hasModeAttr: el.hasAttribute('data-mode'),
    // A 态给根打的身份标记：切到 B 态还在 → 证明两态复用同一个 DOM 根节点。
    rootMarker: el.getAttribute('data-verify-root'),
    position: cs.position,
    zIndex: cs.zIndex,
    rootChildTags: rootChildren.map((n) => n.tagName.toLowerCase()),
    rootChildClasses: rootChildren.map((n) => n.className),
    hasBar: !!bar,
    barCount: rootChildren.filter((n) => n.classList.contains('lark-doc-table-tools-bar')).length,
    // v11：同一时刻最多 1 个 menu，打开才挂、收起真摘除（不是 display:none 假切换）。
    menuCount: menus.length,
    menuName: menu ? menu.dataset.menu : null,
    menuRole: menu ? menu.getAttribute('role') : null,
    menuAttached: !!menu && menu.parentNode === el,
    menuItems: menu ? [...menu.querySelectorAll('button.lark-doc-table-tools-menu-item')].map((b) => ({
      value: b.dataset.value || null,
      text: b.textContent.trim(),
      pressed: b.getAttribute('aria-pressed'),
      disabled: b.disabled,
      ariaDisabled: b.getAttribute('aria-disabled'),
      // v11：菜单项图标 = iconNode() 的 .lark-doc-table-tools-menu-icon.lark-doc-icon > svg。
      menuIconOk: (() => {
        const i = b.querySelector('span.lark-doc-table-tools-menu-icon.lark-doc-icon')
        return !!i && i.querySelectorAll('svg').length === 1
      })(),
    })) : [],
    colorItems: menu ? [...menu.querySelectorAll('button.lark-doc-table-tools-color')].map((b) => b.dataset.value || null) : [],
    menuDividers: menu ? menu.querySelectorAll('.lark-doc-table-tools-menu-divider').length : 0,
    // v11：table-ops 被彻底删除，任何 action:* / data-menu=table-ops / data-cmd=table-ops 都不该在。
    actionValues: [...el.querySelectorAll('[data-value^="action:"]')].map((n) => n.getAttribute('data-value')),
    tableOpsButtons: el.querySelectorAll('.lark-doc-table-tools-btn[data-cmd="table-ops"]').length,
    tableOpsMenus: el.querySelectorAll('.lark-doc-table-tools-menu[data-menu="table-ops"]').length,
    glyphNodes: el.querySelectorAll('.lark-doc-table-tools-glyph').length,
    legacyCaretNodes: el.querySelectorAll('.lark-doc-table-tools-caret').length,
    // 旧 v5 items 残留检测：v11 bar 里必须全为 0 / false。
    hasLabel: !!bar && !!bar.querySelector('label'),
    selectCount: el.querySelectorAll('.lark-doc-select').length,
    colorInputs: el.querySelectorAll('input[type="color"]').length,
    // bar 结构：子节点 tag 序列（v12c：10/13/11 按钮 + 2/3/3 条 sep，其中 1 条 .is-full）。
    barChildTags: barChildren.map((n) => n.tagName.toLowerCase()),
    separators: seps.length,
    fullSeparators: seps.filter((s) => s.classList.contains('is-full')).length,
    buttons: buttons.map((b) => {
      const icon = b.querySelector('span.lark-doc-table-tools-icon.lark-doc-icon')
      const caret = b.querySelector('span.lark-doc-caret.lark-doc-icon')
      return {
        cmd: b.dataset.cmd || null,
        text: b.textContent.trim(),
        type: b.getAttribute('type'),
        title: b.getAttribute('title'),
        ariaLabel: b.getAttribute('aria-label'),
        pressed: b.getAttribute('aria-pressed'),
        hasPressed: b.hasAttribute('aria-pressed'),
        isActive: b.classList.contains('is-active'),
        isTableOnly: b.classList.contains('is-table-only'),
        disabled: b.disabled,
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
        hasGlyph: !!b.querySelector('.lark-doc-table-tools-glyph'),
        hasLegacyCaret: !!b.querySelector('.lark-doc-table-tools-caret'),
      }
    }),
    cmds: buttons.map((b) => b.dataset.cmd || null),
  }
  return snapshot
}

/** 表格内造一个**非空 TextSelection** —— v11 统一浮窗的显隐驱动源之一。 */
const selectTableText = () => {
  const editor = (window.__larkDoc || document.querySelector('lark-doc')).getEditor()
  const p = document.querySelector('.ProseMirror table td p, .ProseMirror table th p')
  if (!p) return null
  const pos = editor.view.posAtDOM(p, 0)
  editor.commands.setTextSelection({ from: pos, to: pos + 1 })
  editor.commands.focus()
  return { from: pos, to: pos + 1 }
}

/** 边界条快照（单 ＋ + 条件 hover line）。 */
const measureBoundary = () => {
  const el = document.querySelector('.lark-doc-table-boundary-tools')
  if (!el) return null
  const cs = getComputedStyle(el)
  const line = el.querySelector('.lark-doc-table-boundary-line')
  const buttons = [...el.children].filter((n) => n.tagName === 'BUTTON')
  const rect = el.getBoundingClientRect()
  const plusRect = buttons[0] ? buttons[0].getBoundingClientRect() : null
  return {
    tag: el.tagName.toLowerCase(),
    classes: [...el.classList],
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    childTags: [...el.children].map((n) => n.tagName.toLowerCase()),
    columnVar: cs.getPropertyValue('--lark-doc-column-line-left').trim(),
    rowVar: cs.getPropertyValue('--lark-doc-row-line-top').trim(),
    line: line ? {
      className: line.className,
      ariaHidden: line.getAttribute('aria-hidden'),
      left: line.style.left,
      top: line.style.top,
      width: Math.round(parseFloat(getComputedStyle(line).width) || 0),
      height: Math.round(parseFloat(getComputedStyle(line).height) || 0),
    } : null,
    buttons: buttons.map((b) => ({
      className: b.className,
      type: b.getAttribute('type'),
      text: b.textContent.trim(),
      ariaLabel: b.getAttribute('aria-label'),
      title: b.getAttribute('title'),
    })),
    plusCenter: plusRect ? { x: plusRect.left + plusRect.width / 2, y: plusRect.top + plusRect.height / 2 } : null,
    plusTop: plusRect ? Math.round(plusRect.top) : null,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    // v12d：飞书同款 ＋ 悬浮提示（is-visible 才可见；文本随轴切换 插入列 / 插入行）。
    tip: (() => {
      const tip = el.querySelector('.lark-doc-table-boundary-tip')
      if (!tip) return null
      const r = tip.getBoundingClientRect()
      const cs = getComputedStyle(tip)
      return {
        text: tip.textContent.trim(),
        role: tip.getAttribute('role'),
        visible: tip.classList.contains('is-visible') && cs.visibility === 'visible' && parseFloat(cs.opacity) === 1,
        bg: cs.backgroundColor,
        arrowBg: getComputedStyle(tip, '::after').borderTopColor,
        fontSize: cs.fontSize,
        radius: cs.borderRadius,
        box: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) },
        centerX: +(r.x + r.width / 2).toFixed(1),
        pointerEvents: cs.pointerEvents,
      }
    })(),
    tableSize: { width: Math.round(rect.width), height: Math.round(rect.height) },
    // v7：真表格 rect 必须从 .ProseMirror table 取。旧断言只比 boundary-tools 自己
    // 的 rect（= wrapper 宽），nodeview 返回 wrapper 时「线超出表格」会被判成通过。
    realTable: (() => {
      const t = document.querySelector('.ProseMirror table')
      if (!t) return null
      const r = t.getBoundingClientRect()
      return { width: Math.round(r.width), height: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) }
    })(),
  }
}

/** md 浮层几何层快照：选择条 / 渐隐 / 自绘滚动条 / 重排预览件。 */
const measureOverlay = () => {
  const el = document.querySelector('.lark-doc-table-overlay')
  if (!el) return null
  const sels = [...el.querySelectorAll('.lark-doc-table-selector')]
  const scroll = el.querySelector('.lark-doc-table-scrollbar')
  return {
    visible: el.classList.contains('is-visible'),
    colSelectors: sels.filter((n) => n.classList.contains('is-column')).length,
    rowSelectors: sels.filter((n) => n.classList.contains('is-row')).length,
    selectorA11y: sels.length > 0 && sels.every((n) => n.getAttribute('role') === 'button'
      && n.getAttribute('tabindex') === '0' && /^选择第 \d+ (列|行)$/.test(n.getAttribute('aria-label') || '')),
    pressed: sels.filter((n) => n.getAttribute('aria-pressed') === 'true').length,
    edges: [...el.querySelectorAll('.lark-doc-table-edge')].map((n) => n.className),
    scrollbar: scroll ? {
      role: scroll.getAttribute('role'),
      label: scroll.getAttribute('aria-label'),
      orientation: scroll.getAttribute('aria-orientation'),
      min: scroll.getAttribute('aria-valuemin'),
      max: scroll.getAttribute('aria-valuemax'),
    } : null,
    hasThumb: !!el.querySelector('.lark-doc-table-scrollbar-thumb'),
    hasDropLine: !!el.querySelector('.lark-doc-table-drop-line'),
    hasDragCard: !!el.querySelector('.lark-doc-table-drag-card'),
  }
}

/** 表格首行各单元格文字（用来验列重排是否真的换了顺序）。 */
const firstRowTexts = () => {
  const tr = document.querySelector('.ProseMirror table tr')
  return tr ? [...tr.children].map((c) => c.textContent.trim()) : []
}

/** 几何 / 视口坐标。 */
const tableGeometry = () => {
  const table = document.querySelector('.ProseMirror table')
  if (!table) return null
  const r = table.getBoundingClientRect()
  const cells = [...table.querySelectorAll('td,th')]
  const first = cells[0] ? cells[0].getBoundingClientRect() : null
  return {
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    firstCell: first ? {
      right: { x: first.right - 2, y: first.top + first.height / 2 },
      bottom: { x: first.left + first.width / 2, y: first.bottom - 2 },
      center: { x: first.left + first.width / 2, y: first.top + first.height / 2 },
    } : null,
    // 贴着表格**外边缘**、但刻意避开任何内部边线的落点：最左 / 最上不该产生 ＋。
    leftOuter: { x: r.left + 1, y: r.top + 12 },
    topOuter: { x: r.left + 12, y: r.top + 1 },
    cornerOuter: { x: r.left - 16, y: r.top - 16 },
  }
}

/** 把光标放进第 index 个 tableCell（0 基）。 */
const selectCell = (index) => {
  const editor = (window.__larkDoc || document.querySelector('lark-doc')).getEditor()
  let seen = 0
  let pos = null
  editor.state.doc.descendants((node, p) => {
    if (pos !== null) return false
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      if (seen === index) pos = p + 2
      seen += 1
      return false
    }
    return true
  })
  if (pos === null) return null
  editor.commands.setTextSelection(pos)
  editor.commands.focus()
  return pos
}

/** 表格后的正文段落中心（点击它 = 点表格外）。 */
const outsidePoint = () => {
  const paragraphs = [...document.querySelectorAll('.ProseMirror p')]
  const p = paragraphs[paragraphs.length - 1]
  if (!p) return null
  const r = p.getBoundingClientRect()
  return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }
}

/** 列 / 行选择条中心点（点它 = 整列 / 整行 CellSelection → 同一个 v11 统一浮窗）。 */
const selectorPoints = (axis) => [...document.querySelectorAll(`.lark-doc-table-selector.is-${axis}`)]
  .map((n) => {
    const r = n.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  })

const TABLE = '<p>表格前的正文</p>' +
  '<table><tbody>' +
  '<tr><td><p>甲一</p></td><td><p>甲二</p></td></tr>' +
  '<tr><td><p>乙一</p></td><td><p>乙二</p></td></tr>' +
  '</tbody></table>' +
  '<p>表格后的正文</p>'

// v12 状态 E 用例：**3 列**表格。2×2 表里同行拖两格 = 整行（tableCellSelectionKind 会判
// 成 line），必须 3 列才能让「拖选同行前两格」成为非整行整列的局部 CellSelection → multi。
const TABLE_MULTI = '<p>表格前的正文</p>' +
  '<table><tbody>' +
  '<tr><td><p>甲一</p></td><td><p>甲二</p></td><td><p>甲三</p></td></tr>' +
  '<tr><td><p>乙一</p></td><td><p>乙二</p></td><td><p>乙三</p></td></tr>' +
  '</tbody></table>' +
  '<p>表格后的正文</p>'

const setDoc = async (page) => {
  await page.evaluate((content) => {
    const host = (window.__larkDoc || document.querySelector('lark-doc'))
    host.setContent(content)
    host.getEditor().commands.focus('start')
  }, TABLE)
  await page.waitForTimeout(420)
}

/** 点回表格（清 dismiss / Escape 闸门）→ 造非空文字选区 → 应得 v11 统一浮窗。 */
const openTextSelection = async (page, geo) => {
  await page.mouse.click(geo.firstCell.center.x, geo.firstCell.center.y)
  await page.waitForTimeout(240)
  await page.evaluate(selectTableText)
  await page.waitForTimeout(300)
  return page.evaluate(measureToolbar)
}

/** 点回表格 → 点第 index 条选择条（整行 / 整列 CellSelection）→ 同一个 v11 统一浮窗。 */
const openCellSelection = async (page, geo, axis, index = 0) => {
  await page.mouse.click(geo.firstCell.center.x, geo.firstCell.center.y)
  await page.waitForTimeout(300)
  const points = await page.evaluate(selectorPoints, axis)
  if (!points.length) return { count: 0, legacy: 0, node: null, points }
  await page.mouse.click(points[index].x, points[index].y)
  await page.waitForTimeout(340)
  const snap = await page.evaluate(measureToolbar)
  snap.points = points
  return snap
}

/** v12 状态 E：第 1 行前两个数据单元格中心（真实鼠标拖选端点）。 */
const cellDragPoints = () => {
  const tr = document.querySelector('.ProseMirror table tr')
  if (!tr) return null
  const cells = [...tr.children].slice(0, 2)
  if (cells.length < 2) return null
  return cells.map((c) => {
    const r = c.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: c.textContent.trim() }
  })
}

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // 真鼠标 hover / 移开要用的视口中心；page.evaluate 的函数体自包含（只吃参数 c）。
  const btnCenter = (cmd) => page.evaluate((c) => {
    const b = document.querySelector(`.lark-doc-table-tools-btn[data-cmd="${c}"]`)
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, cmd)
  const menuCenter = () => page.evaluate(() => {
    const m = document.querySelector('.lark-doc-table-tools-menu[data-menu]')
    if (!m) return null
    const r = m.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const h = window.__larkDoc || document.querySelector('lark-doc')
    return !!(h && typeof h.getEditor === 'function' && h.getEditor())
  }, null, { timeout: 20000 })
  await setDoc(page)

  // ═════════════ ① 唯一浮窗：默认不常驻 / 折叠光标不显示 ═════════════
  let snap = await page.evaluate(measureToolbar)
  record('[唯一浮窗] 只加载文档 → 浮窗**不在 DOM**（默认不常驻）',
    snap.count === 0 && snap.legacy === 0, `tools=${snap.count} legacy=${snap.legacy}`)

  const geo = await page.evaluate(tableGeometry)
  record('[唯一浮窗] 拿到表格真实几何（点击与边线量法都依赖它）',
    !!geo && !!geo.firstCell, geo ? `${Math.round(geo.rect.width)}×${Math.round(geo.rect.height)}` : '没找到表格')

  await page.mouse.move(geo.firstCell.center.x, geo.firstCell.center.y)
  await page.waitForTimeout(260)
  snap = await page.evaluate(measureToolbar)
  record('[唯一浮窗] 只 hover 表格（未点击）→ 仍不出现（不是 hover 常驻）',
    snap.count === 0, `tools=${snap.count}`)
  const ovHoverOnly = await page.evaluate(measureOverlay)
  record('[浮层 v6] 只 hover 表格（未点击）→ 行列选择条**不画**（反馈②：点击表格才出）',
    !ovHoverOnly || (ovHoverOnly.colSelectors === 0 && ovHoverOnly.rowSelectors === 0),
    ovHoverOnly ? `col=${ovHoverOnly.colSelectors} row=${ovHoverOnly.rowSelectors}` : 'overlay 未挂载')

  // v9：反馈⑦的真实路径是**纯 hover、还没点进表格**（光标在表格外正文里）。旧实现
  // 依赖 editor.isActive('table')，只在「先点进表格」的旧用例下能过，这里补上漏检。
  const hoverEdge = await page.evaluate(() => {
    const r = document.querySelector('.ProseMirror table td').getBoundingClientRect()
    return { x: r.right - 2, y: r.top + 16 }
  })
  await page.mouse.move(hoverEdge.x, hoverEdge.y)
  await page.waitForTimeout(320)
  const boundaryHoverOnly = await page.evaluate(() => {
    const wrap = document.querySelector('.lark-doc-table-boundary-tools')
    const line = wrap?.querySelector('.lark-doc-table-boundary-line')
    return {
      open: !!wrap && getComputedStyle(wrap).display !== 'none',
      plus: !!wrap?.querySelector('button'),
      lineClass: line?.className || '',
      selectors: document.querySelectorAll('.lark-doc-table-selector').length,
    }
  })
  record('[边界条 v9] 未点击表格、纯 hover 内部边线 → ＋与高亮线即出现，且仍不画选择条（反馈⑦）',
    boundaryHoverOnly.open && boundaryHoverOnly.plus
      && /is-column-line|is-row-line/.test(boundaryHoverOnly.lineClass)
      && boundaryHoverOnly.selectors === 0,
    `open=${boundaryHoverOnly.open} plus=${boundaryHoverOnly.plus} line=${boundaryHoverOnly.lineClass} selectors=${boundaryHoverOnly.selectors}`)
  await page.mouse.move(8, 8)
  await page.waitForTimeout(180)

  await page.mouse.click(geo.firstCell.center.x, geo.firstCell.center.y)
  await page.waitForTimeout(300)
  snap = await page.evaluate(measureToolbar)
  record('[唯一浮窗] 只点进单元格（折叠光标、没选文字）→ 浮窗**不显示**（v11 沿用）',
    snap.count === 0, `tools=${snap.count}`)
  const ovClicked = await page.evaluate(measureOverlay)
  record('[浮层 v6] 点进表格后 → 2 列 + 2 行选择条出现（点击闸门放行）',
    !!ovClicked && ovClicked.colSelectors === 2 && ovClicked.rowSelectors === 2,
    ovClicked ? `col=${ovClicked.colSelectors} row=${ovClicked.rowSelectors}` : '没渲染')

  // ═════════════ ② 状态 A：表格内非空文字选区 → v11 统一浮窗（v12c 10 项） ═════════════
  snap = await openTextSelection(page, geo)
  const nodeA = snap.node
  const cmdsA = nodeA ? nodeA.cmds.slice() : []
  record('[状态 A] 表格内选中文字 → 浮窗真进 DOM，且**全页恰好 1 个**浮层节点',
    snap.count === 1 && snap.legacy === 0,
    `tools=${snap.count} legacy=${snap.legacy}`)

  // 给浮窗根与 bold 按钮打身份标记：状态 B 里验「同一个 DOM 根节点 / 按钮一次建好只挂摘」。
  await page.evaluate(() => {
    const el = document.querySelector('.lark-doc-table-tools')
    if (el) el.setAttribute('data-verify-root', 'A1')
    const b = document.querySelector('.lark-doc-table-tools-btn[data-cmd="bold"]')
    if (b) b.setAttribute('data-verify-btn', '1')
  })

  record('[唯一浮窗 v7] 文字选区态通用划词气泡条 `.lark-doc-bubble` 不在 DOM（不双窗）',
    (await page.evaluate(() => document.querySelectorAll('.lark-doc-bubble').length)) === 0, 'bubble=0')

  record('[状态 A] 旧 v4 的第二个浮窗 `.lark-doc-table-float` 已整层删除',
    snap.legacy === 0 && (await page.evaluate(() => document.querySelectorAll('[class*="lark-doc-table-float"]').length)) === 0,
    `legacyNodes=${snap.legacy}`)

  record('[状态 A] 根是 div[role=toolbar][aria-label=表格工具]，position=fixed',
    !!nodeA && nodeA.tag === 'div' && nodeA.role === 'toolbar' && nodeA.ariaLabel === '表格工具'
      && nodeA.position === 'fixed',
    nodeA ? `${nodeA.tag} role=${nodeA.role} position=${nodeA.position} z=${nodeA.zIndex}` : '没渲染')

  record('[状态 A 统一浮窗] 根无 data-mode / is-text-mode / is-table-mode；子节点 = bar（+ 至多 1 个 menu）',
    !!nodeA && nodeA.mode === null && !nodeA.hasModeAttr
      && !nodeA.classes.includes('is-text-mode') && !nodeA.classes.includes('is-table-mode')
      && nodeA.hasBar && nodeA.barCount === 1 && nodeA.menuCount <= 1
      && nodeA.rootChildTags.every((t) => t === 'div'),
    nodeA ? `mode=${nodeA.mode} hasModeAttr=${nodeA.hasModeAttr} [${nodeA.classes.join('.')}] root=[${nodeA.rootChildClasses.join(' | ')}] menu=${nodeA.menuCount}` : '没渲染')

  record('[状态 A] 10 个 data-cmd 齐全且顺序 = v12c 文字态工具条（无 share-link / comment）',
    !!nodeA && JSON.stringify(nodeA.cmds) === JSON.stringify(EXPECTED_CMDS_A),
    nodeA ? nodeA.cmds.join(',') : '没渲染')

  // v12：最左侧「问问豆包」（data-cmd=ask-ai）彻底移除，浮窗按钮/菜单项也不得再出现该文案。
  const askAiAudit = await page.evaluate(() => {
    const askAi = document.querySelectorAll('[data-cmd="ask-ai"]').length
    const root = document.querySelector('.lark-doc-table-tools')
    const controls = root ? [...root.querySelectorAll('button, [role="menuitem"]')] : []
    const doubao = controls.filter((b) => /问问豆包/.test(
      `${b.textContent || ''}|${b.title || ''}|${b.getAttribute('aria-label') || ''}`)).length
    return { askAi, doubao, controls: controls.length }
  })
  record('[v12] 全页无 data-cmd="ask-ai" 按钮（「问问豆包」彻底移除）；浮窗按钮/菜单项的 text/title/aria-label 均不含「问问豆包」',
    askAiAudit.askAi === 0 && askAiAudit.doubao === 0,
    `askAi=${askAiAudit.askAi} doubaoHits=${askAiAudit.doubao} controls=${askAiAudit.controls}`)

  record('[状态 A] bar 内 10 按钮 + 2 条 sep（其中 1 条 .is-full），子节点序列精确 = toolbarItems(text)',
    !!nodeA && JSON.stringify(nodeA.barChildTags) === JSON.stringify(EXPECTED_BAR_TAGS_A)
      && nodeA.buttons.length === 10 && nodeA.separators === SEP_A && nodeA.fullSeparators === 1,
    nodeA ? `${nodeA.barChildTags.join(',')} sep=${nodeA.separators} full=${nodeA.fullSeparators}` : '没渲染')

  record('[状态 A syncChildren] 文字态真摘除表格专属 3 颗与 remove（不在 DOM），link 挂在（B 态才反）',
    !!nodeA && TABLE_ONLY_CMDS.every((cmd) => !nodeA.cmds.includes(cmd)) && !nodeA.cmds.includes('remove')
      && nodeA.cmds.includes('link') && !nodeA.cmds.includes('share-link') && !nodeA.cmds.includes('comment')
      && (await page.evaluate(() => document.querySelectorAll('.lark-doc-table-tools-btn[data-cmd="table-header"], .lark-doc-table-tools-btn[data-cmd="remove"]').length)) === 0,
    nodeA ? `[${nodeA.cmds.join(',')}]` : '没渲染')

  record('[状态 A] 每颗按钮 type=button / title / aria-label / data-cmd 齐全且 title===aria-label',
    !!nodeA && nodeA.buttons.every((b) => b.type === 'button' && b.title && b.ariaLabel === b.title && b.cmd),
    nodeA ? `buttons=${nodeA.buttons.length} 齐全` : '没渲染')

  record('[状态 A] bar 内无平铺的 13 项表格操作按钮 / 无 label>input[type=color] / 无 .lark-doc-select 旧下拉',
    // 必须整串精确匹配：v11 的下拉触发按钮 title 是「合并 / 拆分单元格」，
    // 用无锚点正则会把它误判成旧版平铺的「拆分单元格」按钮。
    !!nodeA && !nodeA.buttons.some((b) => /^(上方加行|下方加行|删行|左侧加列|右侧加列|删列|合并单元格|拆分单元格|表头行|表头列|清空单元格|均分列宽|删除表格)$/.test(b.title || ''))
      && !nodeA.hasLabel && nodeA.colorInputs === 0 && nodeA.selectCount === 0,
    nodeA ? `titles=[${nodeA.buttons.map((b) => b.title).join(' / ')}] label=${nodeA.hasLabel} colorInputs=${nodeA.colorInputs} selects=${nodeA.selectCount}` : '没渲染')

  record('[状态 A] 5 个 mark 按钮带 aria-pressed="true|false"（共 5 个）',
    !!nodeA && MARK_CMDS.every((cmd) => nodeA.buttons.some((b) => b.cmd === cmd && b.hasPressed && (b.pressed === 'true' || b.pressed === 'false')))
      && nodeA.buttons.filter((b) => b.hasPressed).length === 5,
    nodeA ? `pressed=[${nodeA.buttons.filter((b) => b.hasPressed).map((b) => `${b.cmd}=${b.pressed}`).join(',')}]` : '没渲染')

  record('[状态 A] 4 个菜单按钮（turninto/align/highlight/more）aria-haspopup=menu / aria-expanded=false / 带 SVG caret',
    !!nodeA && MENU_CMDS_A.every((cmd) => nodeA.buttons.some((b) => b.cmd === cmd && b.haspopup === 'menu' && b.expanded === 'false'))
      && nodeA.buttons.filter((b) => b.haspopup === 'menu').length === 4
      && nodeA.buttons.filter((b) => b.haspopup === 'menu' && b.hasCaretSpan).length === 4,
    nodeA ? `[${nodeA.buttons.filter((b) => b.haspopup === 'menu').map((b) => `${b.cmd}:${b.expanded}`).join(',')}]` : '没渲染')

  record('[v11 图标] 所有按钮都是 SVG 图标（span.lark-doc-table-tools-icon.lark-doc-icon > svg，16×16），无字符 .lark-doc-table-tools-glyph 节点',
    !!nodeA && nodeA.buttons.length === 10 && nodeA.buttons.every((b) => b.iconOk)
      && nodeA.buttons.every((b) => !b.hasGlyph) && nodeA.glyphNodes === 0,
    nodeA ? `iconOk=${nodeA.buttons.filter((b) => b.iconOk).length}/${nodeA.buttons.length} glyph=${nodeA.glyphNodes}` : '没渲染')

  // v12c：用户「按钮大小有点小，看看是不是要和顶部功能栏按钮图标大小一致」。
  // 真实量测：浮窗普通按钮盒 30×30 == 顶部功能栏普通按钮 30×30；两边图标都 16×16；
  // bar 高 30（按钮不再溢出）；容器总高仍是真源 42（padding 5px + 30 + border 2）。
  const v12cSize = await page.evaluate(() => {
    const bb = (n) => { const r = n.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }
    const float = document.querySelector('.lark-doc-table-tools')
    const bar = float?.querySelector('.lark-doc-table-tools-bar')
    const fbtn = float?.querySelector('.lark-doc-table-tools-btn:not(.has-caret)')
    const tbtn = [...document.querySelectorAll('.lark-doc-toolbar .lark-doc-tools button')]
      .find((n) => !n.querySelector('.lark-doc-caret') && n.querySelector('svg'))
    const ficon = fbtn?.querySelector('svg')
    const ticon = tbtn?.querySelector('svg')
    const fcs = fbtn ? getComputedStyle(fbtn) : null
    return {
      fbtn: fbtn ? bb(fbtn) : null, tbtn: tbtn ? bb(tbtn) : null,
      ficon: ficon ? bb(ficon) : null, ticon: ticon ? bb(ticon) : null,
      bar: bar ? bb(bar) : null, float: float ? bb(float) : null,
      radius: fcs?.borderRadius, padding: fcs?.padding, minHeight: fcs?.minHeight,
    }
  })
  record('[v12c 尺寸] 浮窗普通按钮盒 30×30 == 顶部功能栏 30×30；图标仍同为 16×16；bar 高 30、浮窗高 42、radius/padding 对齐',
    !!v12cSize.fbtn && !!v12cSize.tbtn
      && v12cSize.fbtn.w === 30 && v12cSize.fbtn.h === 30
      && v12cSize.tbtn.w === 30 && v12cSize.tbtn.h === 30
      && v12cSize.ficon?.w === 16 && v12cSize.ficon?.h === 16
      && v12cSize.ticon?.w === 16 && v12cSize.ticon?.h === 16
      && v12cSize.bar?.h === 30 && v12cSize.float?.h === 42
      && v12cSize.radius === '6px' && v12cSize.padding === '0px 6px' && v12cSize.minHeight === '30px',
    JSON.stringify(v12cSize))

  // v12c：两颗无实现按钮从**全页**消失（含 data-cmd 与中文文案控件），且 more 菜单未补回 copyAnchorLink。
  const v12cRemoved = await page.evaluate(() => {
    const cmds = ['share-link', 'comment']
    const byCmd = cmds.map((c) => document.querySelectorAll(`[data-cmd="${c}"]`).length)
    const names = ['复制选区链接', '评论']
    const byLabel = names.map((label) => [...document.querySelectorAll('.lark-doc-table-tools button, .lark-doc-table-tools [role="menuitem"]')]
      .filter((b) => (b.textContent || '').trim() === label
        || (b.getAttribute('title') || '').trim() === label
        || (b.getAttribute('aria-label') || '').trim() === label).length)
    return { byCmd, byLabel, cmds, names }
  })
  record('[v12c 下线] 全页无 data-cmd=share-link / comment 按钮，浮窗内也无「复制选区链接」「评论」同名可点控件',
    v12cRemoved.byCmd.every((n) => n === 0) && v12cRemoved.byLabel.every((n) => n === 0),
    `byCmd=${JSON.stringify(v12cRemoved.cmds.map((c, i) => `${c}:${v12cRemoved.byCmd[i]}`))} byLabel=${JSON.stringify(v12cRemoved.names.map((c, i) => `${c}:${v12cRemoved.byLabel[i]}`))}`)

  record('[v11 图标] 4 个 caret 按钮的箭头是 12px SVG（span.lark-doc-caret.lark-doc-icon > svg），无字符 .lark-doc-table-tools-caret 节点',
    !!nodeA && CARET_CMDS.every((cmd) => nodeA.buttons.some((b) => b.cmd === cmd && b.caretOk && b.hasCaretSpan))
      && nodeA.buttons.filter((b) => b.hasCaretSpan).length === 4
      && nodeA.buttons.filter((b) => b.hasCaret && b.caretOk).length === 4
      && nodeA.buttons.every((b) => !b.hasLegacyCaret) && nodeA.legacyCaretNodes === 0,
    nodeA ? `caretOk=${nodeA.buttons.filter((b) => b.caretOk).length} legacyCaret=${nodeA.legacyCaretNodes}` : '没渲染')

  const opsLeft = await page.evaluate(() => ({
    btn: document.querySelectorAll('[data-cmd="table-ops"]').length,
    menu: document.querySelectorAll('[data-menu="table-ops"]').length,
    action: document.querySelectorAll('.lark-doc-table-tools [data-value^="action:"]').length,
  }))
  record('[v11 table-ops 删除] 全页无 data-cmd=table-ops 按钮 / data-menu=table-ops 菜单 / action:* 菜单项（13 项 action 顺序断言已移除）',
    opsLeft.btn === 0 && opsLeft.menu === 0 && opsLeft.action === 0
      && !!nodeA && nodeA.tableOpsButtons === 0 && nodeA.tableOpsMenus === 0 && nodeA.actionValues.length === 0,
    `btn=${opsLeft.btn} menu=${opsLeft.menu} action=${opsLeft.action} snapAction=${nodeA?.actionValues.length}`)

  // hover 表格按钮：全局 `.lark-doc button:hover` 不能把图标刷成 --ld-bg-accent 浅绿。
  const hoverTokens = await page.evaluate(() => {
    const root = document.querySelector('.lark-doc') || document.documentElement
    const cs = getComputedStyle(root)
    const toRgb = (v) => {
      const p = document.createElement('span')
      p.style.backgroundColor = v
      document.body.appendChild(p)
      const out = getComputedStyle(p).backgroundColor
      p.remove()
      return out
    }
    const accent = cs.getPropertyValue('--ld-bg-accent').trim()
    const hover = cs.getPropertyValue('--ld-bg-hover').trim()
    return { accent, hover, accentRgb: toRgb(accent), hoverRgb: toRgb(hover) }
  })
  const hoverBtnRect = await page.evaluate(() => {
    const b = document.querySelector('.lark-doc-table-tools-btn[data-cmd="link"]')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (hoverBtnRect) {
    await page.mouse.move(hoverBtnRect.x, hoverBtnRect.y)
    await page.waitForTimeout(160)
  }
  const hoverBg = await page.evaluate(() => {
    const b = document.querySelector('.lark-doc-table-tools-btn[data-cmd="link"]')
    return b ? getComputedStyle(b).backgroundColor : null
  })
  record('[状态 A v11] hover 表格按钮底色不被全局 button:hover 刷成 --ld-bg-accent 浅绿（颜色只用 --ld-* token）',
    !!hoverBg && hoverBg !== hoverTokens.accentRgb
      && (hoverBg === 'rgba(0, 0, 0, 0)' || hoverBg === 'transparent' || hoverBg === hoverTokens.hoverRgb),
    `bg=${hoverBg} accent(${hoverTokens.accent})=${hoverTokens.accentRgb} hover(${hoverTokens.hover})=${hoverTokens.hoverRgb}`)
  await page.mouse.move(8, 8)
  await page.waitForTimeout(120)

  // 动作分发：点 data-cmd=bold 真的给选中文字加 mark，且 aria-pressed / .is-active 回填（不是死按钮）。
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="bold"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(340)
  const boldState = await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="bold"]')
    return {
      active: (window.__larkDoc || document.querySelector('lark-doc')).getEditor().isActive('bold'),
      strong: document.querySelectorAll('.ProseMirror table strong').length,
      pressed: btn ? btn.getAttribute('aria-pressed') : null,
      isActive: btn ? btn.classList.contains('is-active') : false,
    }
  })
  record('[状态 A] 点 data-cmd=bold → aria-pressed=true / .is-active / toggleMark 真的生效',
    boldState.pressed === 'true' && boldState.isActive && (boldState.active || boldState.strong > 0),
    `pressed=${boldState.pressed} isActive=${boldState.isActive} active=${boldState.active} strong=${boldState.strong}`)

  // ═════════════ ③ 消失条件：点其它地方 / Escape / 离散点击闸门 ═════════════
  const outside = await page.evaluate(outsidePoint)
  await page.mouse.click(outside.x, outside.y)
  await page.waitForTimeout(320)
  snap = await page.evaluate(measureToolbar)
  record('[显隐] 点击表格外正文 → 浮窗**真从 DOM 摘掉**（count=0）',
    snap.count === 0, `tools=${snap.count}`)

  // 只把选区用命令恢复成表格内非空文字选区，不产生任何 pointerdown：
  // dismiss 闸门必须仍然锁住，否则就是「hover / 选区自己把浮窗浮出来」的老缺陷。
  await page.evaluate(selectTableText)
  await page.waitForTimeout(280)
  snap = await page.evaluate(measureToolbar)
  record('[显隐] 点外部后仅程序化恢复表格内选区（无点击）→ 仍不出现',
    snap.count === 0, `tools=${snap.count}`)

  snap = await openTextSelection(page, geo)
  record('[显隐] 重新**点回表格**并选中文字 → 同一个统一浮窗再次出现（离散点击驱动）',
    snap.count === 1 && !!snap.node && snap.node.mode === null
      && JSON.stringify(snap.node.cmds) === JSON.stringify(EXPECTED_CMDS_A),
    snap.node ? `mode=${snap.node.mode} cmds=${snap.node.cmds.length}` : '没渲染')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(280)
  snap = await page.evaluate(measureToolbar)
  record('[显隐] Escape → 浮窗收起', snap.count === 0, `tools=${snap.count}`)

  await page.evaluate(selectTableText)
  await page.waitForTimeout(260)
  snap = await page.evaluate(measureToolbar)
  record('[显隐] Escape 后仅恢复选区（无点击）→ 仍不出现',
    snap.count === 0, `tools=${snap.count}`)

  // ═════════════ ③.1 v11 下拉：hover 打开 / 150ms 延迟关 / 进菜单取消 / click 切换 / 最多 1 个 / Escape 与点外部 ═════════════
  // 显隐组结束时 Escape 已把浮窗收起，这里重新点回表格拿回同一个统一浮窗。
  snap = await openTextSelection(page, geo)
  record('[v11 下拉] 前置：重新点回表格 → 统一浮窗回到 DOM（未开菜单时 menuCount=0）',
    snap.count === 1 && snap.node?.menuCount === 0,
    snap.node ? `tools=${snap.count} menu=${snap.node.menuCount} cmds=${snap.node.cmds.length}` : '没渲染')

  // 先把鼠标停到角落，避免上一次点击残留的 hover 把菜单提前打开。
  await page.mouse.move(8, 8)
  await page.waitForTimeout(180)
  const turnPt = await btnCenter('turninto')
  record('[v11 下拉] turninto 触发按钮有真实可 hover 几何', !!turnPt,
    turnPt ? `${Math.round(turnPt.x)},${Math.round(turnPt.y)}` : '没找到按钮')
  // mouseenter（真 hover）→ openMenu(name, btn, true)。
  if (turnPt) await page.mouse.move(turnPt.x, turnPt.y)
  await page.waitForTimeout(200)
  let menuSnap = await page.evaluate(measureToolbar)
  record('[v11 下拉] hover 打开 → 挂 data-menu=turninto[role=menu]、attached、最多 1 个、触发按钮 aria-expanded=true',
    menuSnap.count === 1 && menuSnap.node?.menuCount === 1
      && menuSnap.node.menuName === 'turninto' && menuSnap.node.menuRole === 'menu'
      && menuSnap.node.menuAttached === true && menuSnap.node.hasBar && menuSnap.node.barCount === 1
      && menuSnap.node.buttons.some((b) => b.cmd === 'turninto' && b.expanded === 'true' && b.isMenuOpen)
      && (await page.evaluate(() => document.querySelectorAll('.lark-doc-table-tools-menu[data-menu]').length)) === 1,
    menuSnap.node ? `menu=${menuSnap.node.menuName} role=${menuSnap.node.menuRole} attached=${menuSnap.node.menuAttached} expanded=[${menuSnap.node.buttons.filter((b) => b.expanded === 'true').map((b) => b.cmd).join(',')}] root=[${menuSnap.node.rootChildClasses.join(' | ')}]` : '没渲染')

  record('[v11 下拉] turninto 菜单 11 个菜单项（+1 分隔线＝飞书 12 项）值精确、每项图标是 .lark-doc-table-tools-menu-icon SVG、当前块 paragraph 回填 aria-pressed=true',
    !!menuSnap.node && JSON.stringify(menuSnap.node.menuItems.map((i) => i.value)) === JSON.stringify(TURN_INTO_ITEMS)
      && menuSnap.node.menuDividers === 1
      && menuSnap.node.menuItems.every((i) => i.menuIconOk)
      && menuSnap.node.menuItems.some((i) => i.value === 'paragraph' && i.pressed === 'true')
      && menuSnap.node.menuItems.some((i) => i.value === 'heading1' && i.pressed === 'false'),
    menuSnap.node ? `items=[${menuSnap.node.menuItems.map((i) => i.value).join(',')}] div=${menuSnap.node.menuDividers} pressed=[${menuSnap.node.menuItems.map((i) => `${i.value}:${i.pressed}`).join(',')}]` : '没渲染')

  record('[v11 图标] aria-expanded=true 的按钮内 .lark-doc-caret 是 12px SVG 箭头，全浮窗无字符 glyph / caret 节点',
    !!menuSnap.node && menuSnap.node.buttons.filter((b) => b.expanded === 'true').length === 1
      && menuSnap.node.buttons.find((b) => b.expanded === 'true')?.caretOk === true
      && menuSnap.node.legacyCaretNodes === 0 && menuSnap.node.glyphNodes === 0,
    menuSnap.node ? `expandedCaretOk=${menuSnap.node.buttons.find((b) => b.expanded === 'true')?.caretOk} legacyCaret=${menuSnap.node.legacyCaretNodes} glyph=${menuSnap.node.glyphNodes}` : '没渲染')

  // hover 已展开时再点触发按钮不关（toolbarMenusMixin.toggleHeadingMenu 同款）。
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="turninto"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(120)
  const afterHoverClick = await page.evaluate(measureToolbar)
  record('[v11 下拉] hover 已展开 → 再点触发按钮不关闭（click 不切 hover 打开的菜单）',
    afterHoverClick.node?.menuCount === 1 && afterHoverClick.node.menuName === 'turninto',
    afterHoverClick.node ? `menu=${afterHoverClick.node.menuName}/${afterHoverClick.node.menuCount}` : '没渲染')

  // 进菜单取消 150ms 延迟关 → 等 180ms 仍在；离开菜单再排关 → 等 180ms 真摘除。
  const mPt = await menuCenter()
  record('[v11 下拉] 菜单有真实可进入几何（供「进菜单取消关」验证）', !!mPt,
    mPt ? `${Math.round(mPt.x)},${Math.round(mPt.y)}` : '没找到菜单')
  if (mPt) await page.mouse.move(mPt.x, mPt.y)
  await page.waitForTimeout(180)
  const afterEnterMenu = await page.evaluate(measureToolbar)
  record('[v11 下拉] 进入菜单取消 mouseleave 排的 150ms 关闭 → 等 180ms 菜单仍在',
    afterEnterMenu.node?.menuCount === 1 && afterEnterMenu.node.menuName === 'turninto',
    afterEnterMenu.node ? `menu=${afterEnterMenu.node.menuName}/${afterEnterMenu.node.menuCount}` : '没渲染')
  await page.mouse.move(8, 8)
  await page.waitForTimeout(180)
  const afterLeaveMenu = await page.evaluate(measureToolbar)
  record('[v11 下拉] 离开菜单 → 重新排 150ms 关闭，等 180ms 菜单真摘除（menuCount=0，根只剩 bar）',
    afterLeaveMenu.count === 1 && afterLeaveMenu.node?.menuCount === 0
      && afterLeaveMenu.node.menuName === null && afterLeaveMenu.node.rootChildTags.length === 1,
    afterLeaveMenu.node ? `menu=${afterLeaveMenu.node.menuCount} root=[${afterLeaveMenu.node.rootChildClasses.join(' | ')}]` : '没渲染')

  // click 打开：DOM .click() 不触发 mouseenter，得到 hoverOpened=false 的纯 click 态。
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="more"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(180)
  const moreSnap = await page.evaluate(measureToolbar)
  const removedLeft = await page.evaluate((vals) => vals.filter((v) =>
    !!document.querySelector(`.lark-doc-table-tools [data-value="${v}"]`)), MORE_REMOVED)
  record('[v12 更多] click 打开 more 菜单；裁到 2 项 translate/larkSearch，被删 5 项（含 copyAnchorLink）不在菜单也不在浮窗任何位置',
    moreSnap.count === 1 && moreSnap.node?.menuCount === 1 && moreSnap.node.menuName === 'more'
      && JSON.stringify(moreSnap.node.menuItems.map((i) => i.value)) === JSON.stringify(MORE_ITEMS)
      && moreSnap.node.menuItems.every((i) => i.menuIconOk)
      && MORE_REMOVED.every((v) => !moreSnap.node.menuItems.some((i) => i.value === v))
      && removedLeft.length === 0,
    moreSnap.node ? `items=[${moreSnap.node.menuItems.map((i) => i.value).join(',')}] removedLeft=[${removedLeft.join(',')}]` : '没渲染')

  // v12c：「复制选区链接」「评论」两颗无实现按钮整体下线。即使在 more 菜单展开时复查，
  // 也不能从菜单里补回 copyAnchorLink / comment 入口（防止「按钮藏进下拉」的假下线）。
  const downlineAudit = await page.evaluate(() => {
    const root = document.querySelector('.lark-doc-table-tools')
    if (!root) return { byCmd: [-1, -1], menuCopy: -1, commentMenu: -1, labelControls: [-1, -1] }
    const byCmd = ['share-link', 'comment'].map((c) => root.querySelectorAll(`[data-cmd="${c}"]`).length)
    const menuCopy = root.querySelectorAll('[data-value="copyAnchorLink"]').length
    const commentMenu = [...root.querySelectorAll('[role="menuitem"], button')]
      .filter((n) => /评论|comment/i.test(`${n.getAttribute('data-value') || ''}|${n.getAttribute('aria-label') || ''}`)).length
    const clickable = [...root.querySelectorAll('button, [role="menuitem"], a[href]')]
    const labelControls = ['复制选区链接', '评论'].map((label) => clickable.filter((b) =>
      (b.textContent || '').trim() === label
      || (b.getAttribute('title') || '').trim() === label
      || (b.getAttribute('aria-label') || '').trim() === label).length)
    return { byCmd, menuCopy, commentMenu, labelControls }
  })
  record('[v12c 下线复查] more 菜单展开时仍无 share-link / comment 按钮，菜单未补回 copyAnchorLink / 评论项，浮窗内无两按钮同名可点控件',
    moreSnap.node?.menuName === 'more' && downlineAudit.byCmd.every((n) => n === 0)
      && downlineAudit.menuCopy === 0 && downlineAudit.commentMenu === 0
      && downlineAudit.labelControls.every((n) => n === 0),
    `menu=${moreSnap.node?.menuName} byCmd=[${downlineAudit.byCmd.join(',')}] menuCopy=${downlineAudit.menuCopy} commentMenu=${downlineAudit.commentMenu} labelControls=[${downlineAudit.labelControls.join(',')}]`)

  // 给当前 more 菜单节点打身份标记；切到 align 时旧节点必须真摘除。
  await page.evaluate(() => {
    const m = document.querySelector('.lark-doc-table-tools-menu[data-menu="more"]')
    if (m) m.setAttribute('data-verify-prev-menu', '1')
  })
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="align"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(180)
  menuSnap = await page.evaluate(measureToolbar)
  const allMenuCount = await page.evaluate(() => document.querySelectorAll('.lark-doc-table-tools-menu[data-menu]').length)
  const prevMenuGone = await page.evaluate(() => !document.querySelector('.lark-doc-table-tools-menu[data-verify-prev-menu="1"]'))
  record('[v11 下拉] 切到 align → 旧 more 菜单节点真摘除、data-menu=align、同时最多 1 个菜单',
    menuSnap.count === 1 && menuSnap.node?.menuCount === 1 && menuSnap.node.menuName === 'align'
      && prevMenuGone && allMenuCount === 1,
    `menu=${menuSnap.node?.menuName} count=${menuSnap.node?.menuCount} prevGone=${prevMenuGone} 全页menu=${allMenuCount}`)

  record('[v11 下拉] align 菜单 8 项（align/valign/indent）+ 2 分隔线、valign 三项齐全、图标全为 SVG（表格结构操作仍可达）',
    !!menuSnap.node && JSON.stringify(menuSnap.node.menuItems.map((i) => i.value)) === JSON.stringify(ALIGN_ITEMS)
      && menuSnap.node.menuDividers === 2
      && menuSnap.node.menuItems.filter((i) => /^valign:/.test(i.value || '')).length === 3
      && menuSnap.node.menuItems.every((i) => i.menuIconOk),
    menuSnap.node ? `items=[${menuSnap.node.menuItems.map((i) => i.value).join(',')}] div=${menuSnap.node.menuDividers}` : '没渲染')

  // highlight 色板：color:* / bg:* 两组 + 无颜色时 highlight:clear 按 state 置灰。
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="highlight"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(180)
  const hlSnap = await page.evaluate(measureToolbar)
  const hlColors = hlSnap.node ? hlSnap.node.colorItems : []
  record('[v11 下拉] highlight 色板：color:* / bg:* 两组色块 + 清除项（无颜色时按 state 置灰）',
    hlSnap.node?.menuName === 'highlight'
      && hlColors.filter((v) => /^color:/.test(v || '')).length >= 1
      && hlColors.filter((v) => /^bg:/.test(v || '')).length >= 1
      && hlSnap.node.menuItems.some((i) => i.value === 'highlight:clear' && i.disabled === true)
      && hlSnap.node.menuDividers === 1,
    `menu=${hlSnap.node?.menuName} colors=${hlColors.length} clearDisabled=${hlSnap.node?.menuItems.find((i) => i.value === 'highlight:clear')?.disabled}`)

  // 点外部（表格外正文）收起菜单，浮窗按既有显隐契约一起收起。
  const beforeOutside = await page.evaluate(measureToolbar)
  const outsideMenuPoint = await page.evaluate(outsidePoint)
  await page.mouse.click(outsideMenuPoint.x, outsideMenuPoint.y)
  await page.waitForTimeout(300)
  const afterOutside = await page.evaluate(measureToolbar)
  const outsideMenuLeft = await page.evaluate(() => document.querySelectorAll('.lark-doc-table-tools-menu[data-menu]').length)
  record('[v11 下拉] 点外部 → 菜单真摘除（全页 menu 节点=0，浮窗按显隐契约收起）',
    beforeOutside.node?.menuCount === 1 && outsideMenuLeft === 0 && afterOutside.count === 0,
    `before=${beforeOutside.node?.menuName}/${beforeOutside.node?.menuCount} menuLeft=${outsideMenuLeft} after.tools=${afterOutside.count}`)

  // Escape 收起菜单（重新点回表格后再打开一次）。
  snap = await openTextSelection(page, geo)
  await page.mouse.move(8, 8)
  await page.waitForTimeout(120)
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="highlight"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(160)
  const beforeEsc = await page.evaluate(measureToolbar)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(280)
  const afterEsc = await page.evaluate(measureToolbar)
  const escMenuLeft = await page.evaluate(() => document.querySelectorAll('.lark-doc-table-tools-menu[data-menu]').length)
  record('[v11 下拉] Escape → 菜单收起（全页 menu 节点=0，浮窗按显隐契约收起）',
    beforeEsc.node?.menuCount === 1 && beforeEsc.node?.menuName === 'highlight'
      && escMenuLeft === 0 && afterEsc.count === 0,
    `before=${beforeEsc.node?.menuName}/${beforeEsc.node?.menuCount} menuLeft=${escMenuLeft} after.tools=${afterEsc.count}`)

  // 精确验证 closeMenus 真摘除：只点「浮窗外、但仍在表格块内」的探针，不改选区，
  // 浮窗必须仍在（count=1）、菜单必须被摘除（menuCount=0）—— 排除「整窗被摘除」的假阳性。
  snap = await openTextSelection(page, geo)
  await page.mouse.move(8, 8)
  await page.waitForTimeout(120)
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="align"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(160)
  const beforeProbe = await page.evaluate(measureToolbar)
  await page.evaluate(() => {
    const wrapper = document.querySelector('.ProseMirror .tableWrapper') || document.querySelector('.tableWrapper')
    const probe = document.createElement('span')
    probe.setAttribute('data-verify-probe', '1')
    const parent = wrapper || document.body
    parent.appendChild(probe)
    probe.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    probe.remove()
  })
  await page.waitForTimeout(200)
  const afterProbe = await page.evaluate(measureToolbar)
  record('[v11 下拉] 点浮窗外（表格块内）→ closeMenus 真摘除菜单且浮窗仍在（非整窗摘除）',
    beforeProbe.node?.menuCount === 1
      && afterProbe.count === 1 && afterProbe.node?.menuCount === 0
      && afterProbe.node.cmds.length === 10,
    `before=${beforeProbe.node?.menuName} after.tools=${afterProbe.count} after.menu=${afterProbe.node?.menuCount} cmds=${afterProbe.node?.cmds.length}`)

  // ═════════════ ③.2 v11 命令分发：真实效果（不只测 DOM） ═════════════
  // turninto→heading1：v11 tableToolbarCommand 直接以当前选区 run('setHeading')。
  await setDoc(page)
  const geoF1 = await page.evaluate(tableGeometry)
  await openTextSelection(page, geoF1)
  await page.mouse.move(8, 8)
  await page.waitForTimeout(120)
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="turninto"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(160)
  const turnF = await page.evaluate(measureToolbar)
  const h1Before = await page.evaluate(() => document.querySelectorAll('.ProseMirror h1').length)
  await page.evaluate(() => {
    const item = document.querySelector('.lark-doc-table-tools-menu[data-menu="turninto"] button.lark-doc-table-tools-menu-item[data-value="heading1"]')
    if (item) item.click()
  })
  await page.waitForTimeout(420)
  const headState = await page.evaluate(() => ({
    h1: document.querySelectorAll('.ProseMirror h1').length,
    headingActive: (window.__larkDoc || document.querySelector('lark-doc')).getEditor().isActive('heading'),
    html: document.querySelector('.ProseMirror')?.innerHTML || '',
  }))
  record('[v11 分发] tableToolbarCommand：turninto→heading1 → 真的变 H1（菜单项真分发、不只测 DOM）',
    turnF.node?.menuName === 'turninto' && turnF.node.menuItems.some((i) => i.value === 'heading1')
      && (headState.h1 > h1Before || headState.headingActive === true || /<h1[\s>]/.test(headState.html)),
    `menu=${turnF.node?.menuName} h1=${h1Before}→${headState.h1} headingActive=${headState.headingActive}`)

  // align→align:center：段落 text-align 真的变化（computed / 编辑器属性 = center）。
  await setDoc(page)
  const geoF2 = await page.evaluate(tableGeometry)
  await openTextSelection(page, geoF2)
  await page.mouse.move(8, 8)
  await page.waitForTimeout(120)
  const alignBefore = await page.evaluate(() => {
    const p = document.querySelector('.ProseMirror table td p')
    return p ? getComputedStyle(p).textAlign : null
  })
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="align"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(160)
  const alignMenuF = await page.evaluate(measureToolbar)
  await page.evaluate(() => {
    const item = document.querySelector('.lark-doc-table-tools-menu[data-menu="align"] button.lark-doc-table-tools-menu-item[data-value="align:center"]')
    if (item) item.click()
  })
  await page.waitForTimeout(420)
  const alignAfter = await page.evaluate(() => {
    const p = document.querySelector('.ProseMirror table td p')
    const ed = (window.__larkDoc || document.querySelector('lark-doc')).getEditor()
    let nodeAlign = null
    try { nodeAlign = ed.state.selection.$from.parent?.attrs?.textAlign ?? null } catch { nodeAlign = null }
    return { computed: p ? getComputedStyle(p).textAlign : null, inline: p ? p.style.textAlign : null, nodeAlign }
  })
  const alignIsCenter = alignAfter.computed === 'center' || alignAfter.nodeAlign === 'center' || alignAfter.inline === 'center'
  const alignChanged = alignBefore !== alignAfter.computed || alignAfter.nodeAlign !== null || alignAfter.inline !== ''
  record('[v11 分发] tableToolbarCommand：align→align:center → 段落真的居中（computed / 编辑器属性 = center）',
    alignMenuF.node?.menuName === 'align' && alignMenuF.node.menuItems.some((i) => i.value === 'align:center')
      && alignIsCenter && alignChanged,
    `menu=${alignMenuF.node?.menuName} 前=${alignBefore} 后 computed=${alignAfter.computed} inline=${alignAfter.inline} nodeAlign=${alignAfter.nodeAlign}`)

  // ═════════════ ④ 状态 B：点列 / 行选择条 → 同一个 v11 统一浮窗 ═════════════
  await setDoc(page)
  const geoB = await page.evaluate(tableGeometry)
  let snapB = await openCellSelection(page, geoB, 'column', 0)
  let nodeB = snapB.node
  record('[状态 B] 点第 1 条列选择条 → 浮窗出现且**仍然全页恰好 1 个**',
    snapB.count === 1 && snapB.legacy === 0, `tools=${snapB.count} legacy=${snapB.legacy}`)

  record('[唯一浮窗 v7] 点选择条态通用划词气泡条 `.lark-doc-bubble` 也不在 DOM',
    (await page.evaluate(() => document.querySelectorAll('.lark-doc-bubble').length)) === 0, 'bubble=0')

  record('[状态 B 统一浮窗] A/B 复用**同一个**浮窗 DOM 根节点（A 打的标记仍在），无 data-mode / 两种 mode class',
    !!nodeB && nodeB.rootMarker === 'A1' && nodeB.mode === null && !nodeB.hasModeAttr
      && !nodeB.classes.includes('is-text-mode') && !nodeB.classes.includes('is-table-mode')
      && (await page.evaluate(() => document.querySelectorAll('.lark-doc-table-tools').length)) === 1,
    nodeB ? `marker=${nodeB.rootMarker} A=[${cmdsA.join(',')}] B=[${nodeB.cmds.join(',')}] mode=${nodeB.mode} [${nodeB.classes.join('.')}]` : '没渲染')

  const boldSameNode = await page.evaluate(() => !!document.querySelector('.lark-doc-table-tools-btn[data-cmd="bold"][data-verify-btn="1"]'))
  record('[状态 B syncChildren] 按钮节点一次建好、按上下文挂摘：A 标记的 bold 仍是同一节点，link 真摘除、share-link/comment 保持下线、表格专属 3 颗 + remove 真插入',
    !!nodeB && boldSameNode
      && !nodeB.cmds.includes('link') && !nodeB.cmds.includes('share-link') && !nodeB.cmds.includes('comment')
      && TABLE_ONLY_CMDS.every((cmd) => nodeB.cmds.includes(cmd)) && nodeB.cmds.includes('remove'),
    nodeB ? `boldSame=${boldSameNode} A=[${cmdsA.join(',')}] B=[${nodeB.cmds.join(',')}]` : '没渲染')

  record('[状态 B] 13 个 data-cmd 齐全且顺序 = v12c 选择条态工具条',
    !!nodeB && JSON.stringify(nodeB.cmds) === JSON.stringify(EXPECTED_CMDS_B),
    nodeB ? nodeB.cmds.join(',') : '没渲染')

  record('[状态 B] 每颗按钮 type=button / title===aria-label / data-cmd 非空',
    !!nodeB && nodeB.buttons.every((b) => b.type === 'button' && b.title === b.ariaLabel && b.cmd),
    nodeB ? `buttons=${nodeB.buttons.length} 齐全` : '没渲染')

  record('[状态 B] 5 个 mark 按钮带 aria-pressed="true|false"（共 5 个）',
    !!nodeB && MARK_CMDS.every((cmd) => nodeB.buttons.some((b) => b.cmd === cmd && b.hasPressed && (b.pressed === 'true' || b.pressed === 'false')))
      && nodeB.buttons.filter((b) => b.hasPressed).length === 5,
    nodeB ? `pressed=[${nodeB.buttons.filter((b) => b.hasPressed).map((b) => `${b.cmd}=${b.pressed}`).join(',')}]` : '没渲染')

  record('[状态 B] bar 内无 label > input[type=color] / 无 .lark-doc-select 旧下拉原语（v11 统一走 menu）',
    !!nodeB && !nodeB.hasLabel && nodeB.colorInputs === 0 && nodeB.selectCount === 0,
    nodeB ? `label=${nodeB.hasLabel} colorInputs=${nodeB.colorInputs} selects=${nodeB.selectCount}` : '没渲染')

  // v11 背景色走 cell-bg 下拉色板（不再是 label > input[type=color] 默认值）。
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="cell-bg"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(180)
  const cellBgMenu = await page.evaluate(measureToolbar)
  const cellBgValues = cellBgMenu.node ? cellBgMenu.node.colorItems.filter((v) => /^cellbg:/.test(v || '')) : []
  record('[状态 B] 背景色走 cell-bg 下拉色板：data-value=cellbg:* 的 color 按钮 + 清除项（非 #f2faf6 input 默认值）',
    cellBgMenu.node?.menuName === 'cell-bg' && cellBgValues.length >= 1
      && !!cellBgMenu.node && cellBgMenu.node.menuItems.some((i) => i.value === 'cellbg:'),
    `menu=${cellBgMenu.node?.menuName} cellbg=[${cellBgValues.join(',')}] clear=${cellBgMenu.node?.menuItems.some((i) => i.value === 'cellbg:')}`)
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="cell-bg"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(140)

  // merge-cell 菜单：2 项；无合并单元格时「合并」解禁、「拆分」按状态置灰（v11 全量审计）；图标 SVG。
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="merge-cell"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(180)
  const mergeMenu = await page.evaluate(measureToolbar)
  const mergeVals = mergeMenu.node ? mergeMenu.node.menuItems.map((i) => i.value) : []
  record('[状态 B] merge-cell 菜单含两项：合并解禁、无可拆分单元格时拆分置灰、图标 SVG（表格结构操作仍可达）',
    mergeMenu.node?.menuName === 'merge-cell'
      && JSON.stringify(mergeVals) === JSON.stringify(['mergeCells', 'splitCell'])
      && mergeMenu.node.menuItems[0]?.disabled === false
      && mergeMenu.node.menuItems[1]?.disabled === true
      && mergeMenu.node.menuItems.every((i) => i.menuIconOk),
    `menu=${mergeMenu.node?.menuName} items=[${mergeVals.join(',')}] disabled=[${mergeMenu.node?.menuItems.map((i) => i.disabled).join(',')}]`)
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="merge-cell"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(140)
  snapB = await page.evaluate(measureToolbar)
  nodeB = snapB.node

  record('[状态 B] 7 个菜单按钮齐全（table-header/merge-cell/cell-bg/turninto/align/highlight/more），aria-haspopup=menu / aria-expanded=false',
    !!nodeB && MENU_CMDS_B.every((cmd) => nodeB.buttons.some((b) => b.cmd === cmd))
      && nodeB.buttons.filter((b) => b.haspopup === 'menu').length === MENU_CMDS_B.length
      && nodeB.buttons.filter((b) => b.haspopup === 'menu').every((b) => b.expanded === 'false'),
    nodeB ? `[${nodeB.buttons.filter((b) => b.haspopup === 'menu').map((b) => b.cmd).join(',')}]` : '没渲染')

  record('[状态 B] 只有 4 个 caret 按钮（turninto/align/highlight/more）带 SVG 箭头，表格专属 3 颗纯图标无 caret',
    !!nodeB && CARET_CMDS.every((cmd) => nodeB.buttons.some((b) => b.cmd === cmd && b.hasCaret && b.caretOk))
      && nodeB.buttons.filter((b) => b.hasCaret).length === 4
      && TABLE_ONLY_CMDS.every((cmd) => nodeB.buttons.some((b) => b.cmd === cmd && !b.hasCaret && !b.hasCaretSpan)),
    nodeB ? `caret=[${nodeB.buttons.filter((b) => b.hasCaret).map((b) => b.cmd).join(',')}] tableOnly=[${TABLE_ONLY_CMDS.map((c) => `${c}:${nodeB.buttons.find((b) => b.cmd === c)?.hasCaret}`).join(',')}]` : '没渲染')

  record('[状态 B 统一] 13 按钮 + 3 条 sep（其中 1 条 .is-full），bar 子节点序列精确 = toolbarItems(line)',
    !!nodeB && nodeB.buttons.length === 13 && nodeB.separators === SEP_B && nodeB.fullSeparators === 1
      && JSON.stringify(nodeB.barChildTags) === JSON.stringify(EXPECTED_BAR_TAGS_B)
      && MARK_CMDS.every((cmd) => nodeB.buttons.some((b) => b.cmd === cmd))
      && TABLE_ONLY_CMDS.every((cmd) => nodeB.buttons.some((b) => b.cmd === cmd)),
    nodeB ? `buttons=${nodeB.buttons.length} sep=${nodeB.separators} full=${nodeB.fullSeparators} tags=[${nodeB.barChildTags.join(',')}]` : '没渲染')

  record('[唯一浮窗] A/B 复用**同一个**节点，从不出现两个弹窗',
    snapB.count === 1 && snapB.legacy === 0
      && (await page.evaluate(() => document.querySelectorAll('.lark-doc-table-tools, .lark-doc-table-float').length)) === 1,
    `nodes=${snapB.count + snapB.legacy}`)

  // v12 真实功能：CellSelection 下点末尾 remove → 按真实 selectedRect 删**当前选中列**，
  // 不再走 this.run() 的 focus 链（旧实现会误删相邻列）。记录删除前后每行单元格文本，
  // 精确核对删掉的是第 0 列（甲一/乙一）而不是相邻的第 1 列（甲二/乙二）。
  const beforeRemove = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror table tr')]
    .map((tr) => [...tr.children].map((c) => c.textContent.trim())))
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="remove"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(420)
  const afterRemove = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror table tr')]
    .map((tr) => [...tr.children].map((c) => c.textContent.trim())))
  record('[状态 B / v12 删除] 选第 0 列后点 remove → 按真实 selectedRect 删当前列（每行 2→1、留下原第 1 列 甲二/乙二，不是相邻误删）',
    beforeRemove.length === 2 && beforeRemove.every((r) => r.length === 2)
      && afterRemove.length === 2 && afterRemove.every((r) => r.length === 1)
      && afterRemove[0][0] === beforeRemove[0][1] && afterRemove[1][0] === beforeRemove[1][1]
      && afterRemove[0][0] !== beforeRemove[0][0] && afterRemove[1][0] !== beforeRemove[1][0],
    `before=[${beforeRemove.map((r) => r.join('|')).join(' ; ')}] after=[${afterRemove.map((r) => r.join('|')).join(' ; ')}]`)

  // v12 同样核对「删当前行」：选第 0 行后点 remove，必须删第 0 行（甲一/甲二）而不是相邻的第 1 行。
  await setDoc(page)
  const geoBRow = await page.evaluate(tableGeometry)
  await openCellSelection(page, geoBRow, 'row', 0)
  const beforeRowRemove = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror table tr')]
    .map((tr) => [...tr.children].map((c) => c.textContent.trim())))
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="remove"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(420)
  const afterRowRemove = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror table tr')]
    .map((tr) => [...tr.children].map((c) => c.textContent.trim())))
  record('[状态 B / v12 删除] 选第 0 行后点 remove → 按真实 selectedRect 删当前行（2 行→1 行、留下原第 1 行 乙一/乙二，不是相邻误删）',
    beforeRowRemove.length === 2 && beforeRowRemove.every((r) => r.length === 2)
      && afterRowRemove.length === 1 && afterRowRemove[0].length === 2
      && afterRowRemove[0][0] === beforeRowRemove[1][0] && afterRowRemove[0][1] === beforeRowRemove[1][1]
      && afterRowRemove[0][0] !== beforeRowRemove[0][0],
    `before=[${beforeRowRemove.map((r) => r.join('|')).join(' ; ')}] after=[${afterRowRemove.map((r) => r.join('|')).join(' ; ')}]`)

  await setDoc(page)
  const geoB2 = await page.evaluate(tableGeometry)
  snapB = await openCellSelection(page, geoB2, 'column', 0)
  await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="table-header"]')
    if (btn) btn.click()
  })
  await page.waitForTimeout(180)
  const headerMenu = await page.evaluate(measureToolbar)
  const headerItems = headerMenu.node ? headerMenu.node.menuItems.map((i) => i.value) : []
  record('[状态 B] table-header 菜单结构：标题行/标题列 2 项、图标全为 .lark-doc-table-tools-menu-icon SVG',
    headerMenu.node?.menuName === 'table-header'
      && JSON.stringify(headerItems) === JSON.stringify(['toggleHeaderRow', 'toggleHeaderColumn'])
      && headerMenu.node.menuItems.every((i) => i.menuIconOk),
    `menu=${headerMenu.node?.menuName} items=[${headerItems.join(',')}]`)
  await page.evaluate(() => {
    const item = document.querySelector('.lark-doc-table-tools-menu[data-menu="table-header"] button.lark-doc-table-tools-menu-item[data-value="toggleHeaderRow"]')
    if (item) item.click()
  })
  await page.waitForTimeout(420)
  const headerState = await page.evaluate(() => ({ th: document.querySelectorAll('.ProseMirror table th').length }))
  record('[状态 B] 点 table-header 下拉的 toggleHeaderRow → 首行变 th（菜单项真分发）',
    headerItems.length === 2 && headerState.th > 0,
    `menu=${headerMenu.node?.menuName} items=[${headerItems.join(',')}] th=${headerState.th}`)

  // 行选择条同样出同一个统一浮窗；items 按上下文切成 13 项。
  await setDoc(page)
  const geoB3 = await page.evaluate(tableGeometry)
  snapB = await openCellSelection(page, geoB3, 'row', 0)
  record('[状态 B] 点第 1 条行选择条 → 也是**同一个统一浮窗**（整行 CellSelection，13 个 data-cmd、无 mode）',
    snapB.count === 1 && !!snapB.node && snapB.node.mode === null
      && snapB.node.rootMarker === 'A1'
      && JSON.stringify(snapB.node.cmds) === JSON.stringify(EXPECTED_CMDS_B),
    snapB.node ? `marker=${snapB.node.rootMarker} mode=${snapB.node.mode} cmds=${snapB.node.cmds.length} [${snapB.node.classes.join('.')}]` : '没渲染')

  // 从 B 切回 A：syncChildren 真摘除表格专属 3 颗 + remove、插回 link；
  // v12c 已下线的 share-link / comment 不得被 syncBar 顺手挂回来。
  const snapBack = await openTextSelection(page, geoB3)
  record('[统一浮窗] B → A → 回到 10 个 data-cmd、items 真摘除/插回、无 mode 属性、bar 序列精确、下线两按钮未复活',
    snapBack.count === 1 && !!snapBack.node && snapBack.node.mode === null && !snapBack.node.hasModeAttr
      && JSON.stringify(snapBack.node.cmds) === JSON.stringify(cmdsA)
      && JSON.stringify(snapBack.node.barChildTags) === JSON.stringify(EXPECTED_BAR_TAGS_A)
      && snapBack.node.buttons.length === 10 && snapBack.node.separators === SEP_A
      && !snapBack.node.cmds.includes('remove') && TABLE_ONLY_CMDS.every((c) => !snapBack.node.cmds.includes(c))
      && snapBack.node.cmds.includes('link')
      && !snapBack.node.cmds.includes('share-link') && !snapBack.node.cmds.includes('comment')
      && !snapBack.node.hasLabel && snapBack.node.selectCount === 0,
    snapBack.node ? `mode=${snapBack.node.mode} cmds=${snapBack.node.cmds.length} sep=${snapBack.node.separators} [${snapBack.node.cmds.join(',')}]` : '没渲染')

  // ═════════════ ④.2 状态 E：拖选两个及以上单元格 → multi 态 11 项（v12 反馈④ / v12c） ═════════════
  // 用户反馈「选中两个单元格或者多个，功能栏浮窗的按钮不对」：拖选产生的是**局部**
  // CellSelection（selectedRect 非整行整列 → cellKind='multi'），不能复用 line 的 13 项
  // 形态。必须用真鼠标 down/move/up 跨过单元格边界驱动 —— 程序化 setCellSelection
  // 证明不了 mousemove → CellSelection 这条真实链路。
  await page.evaluate((content) => {
    (window.__larkDoc || document.querySelector('lark-doc')).setContent(content)
  }, TABLE_MULTI)
  await page.waitForTimeout(420)
  const geoE = await page.evaluate(tableGeometry)
  const dragE = await page.evaluate(cellDragPoints)
  record('[状态 E] 前置：3 列表格拿到同行前两格拖选端点',
    !!geoE?.firstCell && !!dragE && dragE.length === 2,
    dragE ? `${dragE.map((p) => p.text).join(' → ')}` : '没找到单元格')
  if (geoE?.firstCell && dragE && dragE.length === 2) {
    // 先点进表格复位 dismiss 闸门（显隐驱动源是离散 pointerdown），再从甲一拖到甲二。
    await page.mouse.click(geoE.firstCell.center.x, geoE.firstCell.center.y)
    await page.waitForTimeout(300)
    await page.mouse.move(dragE[0].x, dragE[0].y)
    await page.mouse.down()
    // steps 分段移动，确保真的跨过单元格边界（一步 move 可能跳过 mousemove 判定）。
    await page.mouse.move((dragE[0].x + dragE[1].x) / 2, dragE[0].y, { steps: 4 })
    await page.mouse.move(dragE[1].x, dragE[1].y, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(360)

    const dragInfo = await page.evaluate(() => ({
      selectedCells: document.querySelectorAll('.ProseMirror .selectedCell').length,
      tools: document.querySelectorAll('.lark-doc-table-tools').length,
      legacy: document.querySelectorAll('.lark-doc-table-float').length,
      firstRowCells: document.querySelector('.ProseMirror table tr')?.children.length || 0,
    }))
    record('[状态 E] 前置：真实拖拽跨过单元格边界 → 产生非整行整列 CellSelection（≥2 格 .selectedCell 且首行 >2 格）',
      dragInfo.selectedCells >= 2 && dragInfo.firstRowCells > 2,
      `selectedCell=${dragInfo.selectedCells} 首行格数=${dragInfo.firstRowCells}（>2 才保证不是整行 line）`)

    snap = await page.evaluate(measureToolbar)
    const nodeE = snap.node
    const cmdsE = nodeE ? nodeE.cmds.slice() : []
    record('[状态 E] 拖选两个单元格 → 浮窗出现且**全页恰好 1 个**（没出浮窗即失败，不写恒真断言）',
      dragInfo.selectedCells >= 2 && snap.count === 1 && snap.legacy === 0,
      `selectedCell=${dragInfo.selectedCells} tools=${snap.count} legacy=${snap.legacy}`)

    record('[状态 E] 11 个 data-cmd 齐全且顺序 = v12c 多格拖选形态 E（开头 合并/背景、无 table-header、末尾 more）',
      !!nodeE && JSON.stringify(cmdsE) === JSON.stringify(EXPECTED_CMDS_E),
      nodeE ? nodeE.cmds.join(',') : `没渲染（selectedCell=${dragInfo.selectedCells} tools=${snap.count}）`)

    record('[状态 E] 末尾是 data-cmd="more"（🔴 不是 remove、也不是已下线的 comment / share-link）；table-header 与 remove 在 multi 态都不存在',
      !!nodeE && cmdsE[cmdsE.length - 1] === 'more'
        && !cmdsE.includes('table-header') && !cmdsE.includes('remove')
        && !cmdsE.includes('comment') && !cmdsE.includes('share-link')
        && (await page.evaluate(() => document.querySelectorAll('.lark-doc-table-tools-btn[data-cmd="table-header"], .lark-doc-table-tools-btn[data-cmd="remove"]').length)) === 0,
      nodeE ? `末尾=${cmdsE[cmdsE.length - 1]} header/remove/下线两按钮皆无` : '没渲染')

    record('[状态 E] bar 内 11 按钮 + 3 条 sep（其中 1 条 .is-full），子节点序列精确 = toolbarItems(multi)',
      !!nodeE && nodeE.buttons.length === 11 && nodeE.separators === SEP_E && nodeE.fullSeparators === 1
        && JSON.stringify(nodeE.barChildTags) === JSON.stringify(EXPECTED_BAR_TAGS_E),
      nodeE ? `${nodeE.barChildTags.join(',')} sep=${nodeE.separators} full=${nodeE.fullSeparators}` : '没渲染')

    record('[状态 E 统一浮窗] 仍只有一个浮窗节点、无 data-mode / mode class，且与 A/B 复用同一个 DOM 根（A1 标记仍在）',
      snap.count === 1 && !!nodeE && nodeE.mode === null && !nodeE.hasModeAttr
        && !nodeE.classes.includes('is-text-mode') && !nodeE.classes.includes('is-table-mode')
        && nodeE.rootMarker === 'A1' && nodeE.rootChildTags.every((t) => t === 'div'),
      nodeE ? `marker=${nodeE.rootMarker} mode=${nodeE.mode} [${nodeE.classes.join('.')}]` : '没渲染')

    // merge-cell 菜单：state.cellSelection（line / multi 都为 true）→「合并单元格」不置灰。
    await page.mouse.move(8, 8)
    await page.waitForTimeout(160)
    await page.evaluate(() => {
      const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="merge-cell"]')
      if (btn) btn.click()
    })
    await page.waitForTimeout(180)
    const mergeMenuE = await page.evaluate(measureToolbar)
    const mergeValsE = mergeMenuE.node ? mergeMenuE.node.menuItems.map((i) => i.value) : []
    record('[状态 E] merge-cell 菜单可用：data-menu=merge-cell 挂载、两项齐全、「合并单元格」**不置灰**（cellSelection=true）',
      mergeMenuE.count === 1 && mergeMenuE.node?.menuName === 'merge-cell'
        && JSON.stringify(mergeValsE) === JSON.stringify(['mergeCells', 'splitCell'])
        && mergeMenuE.node.menuItems[0]?.disabled === false,
      `menu=${mergeMenuE.node?.menuName} items=[${mergeValsE.join(',')}] disabled=[${mergeMenuE.node?.menuItems.map((i) => i.disabled).join(',')}]`)
    await page.evaluate(() => {
      const btn = document.querySelector('.lark-doc-table-tools-btn[data-cmd="merge-cell"]')
      if (btn) btn.click()
    })
    await page.waitForTimeout(140)

    // 复位：Escape 收浮窗，避免残留 multi 选区影响后续 ⑤ 边界条断言。
    await page.keyboard.press('Escape')
    await page.waitForTimeout(280)
    snap = await page.evaluate(measureToolbar)
    record('[状态 E] Escape → 浮窗收起（复位，不影响后续断言）', snap.count === 0, `tools=${snap.count}`)
  }

  // ═════════════ ⑤ 边界条：一条边线一颗 ＋ ═════════════
  await setDoc(page)
  await page.evaluate(selectCell, 0)
  await page.waitForTimeout(260)
  const g2 = await page.evaluate(tableGeometry)
  await page.mouse.click(g2.firstCell.center.x, g2.firstCell.center.y)
  await page.waitForTimeout(240)

  await page.mouse.move(g2.firstCell.right.x, g2.firstCell.right.y)
  await page.waitForTimeout(280)
  let boundary = await page.evaluate(measureBoundary)
  record('[边界条] 鼠标贴单元格右边界 → 边界条进 DOM，class 带 is-column',
    !!boundary && boundary.classes.indexOf('is-column') !== -1,
    boundary ? boundary.classes.join('.') : '没渲染')

  record('[边界条] 根是 div[role=toolbar][aria-label=表格边界操作]',
    !!boundary && boundary.tag === 'div' && boundary.role === 'toolbar' && boundary.ariaLabel === '表格边界操作',
    boundary ? `${boundary.role}/${boundary.ariaLabel}` : '没渲染')

  record('[边界条] 列态**恰好一颗** ＋（lark-doc-table-col-plus-btn）+ 1 条 hover line + 1 颗 tip，且无旧双按钮 class',
    !!boundary && boundary.buttons.length === 1
      && boundary.childTags.join(',') === 'span,button,div'
      && /\blark-doc-table-col-plus-btn\b/.test(boundary.buttons[0].className)
      && boundary.buttons[0].text === '＋' && boundary.buttons[0].type === 'button'
      && !boundary.buttons.some((b) => /is-column-before|is-column-after|is-row-before|is-row-after/.test(b.className)),
    boundary ? `${boundary.childTags.join(',')} [${boundary.buttons.map((b) => b.className)}]` : '没渲染')

  record('[边界条] 列 ＋ aria-label = 在此处插入列；原生 title 已移除（v12d 自绘 tip 取代，防双重 tooltip）',
    !!boundary && boundary.buttons[0].ariaLabel === '在此处插入列' && !boundary.buttons[0].title,
    boundary ? `aria=${boundary.buttons[0].ariaLabel} title=${JSON.stringify(boundary.buttons[0].title)}` : '没渲染')

  record('[边界条 v6] ＋ 按钮无外圈光晕（::before box-shadow = none，反馈⑥）',
    (await page.evaluate(() => {
      const btn = document.querySelector('.lark-doc-table-boundary-tools button')
      return btn ? getComputedStyle(btn, '::before').boxShadow : null
    })) === 'none', 'box-shadow=none')

  record('[边界条 v6] 悬浮内部边线（未碰＋）→ hover line 即挂进 DOM（反馈⑦：交界处需高亮）',
    !!boundary && !!boundary.line && boundary.line.className === 'lark-doc-table-boundary-line is-column-line',
    boundary && boundary.line ? boundary.line.className : '没挂载')

  record('[v12d tip] 只 hover 边线未碰 ＋ → tip 不提前弹出（150ms 延迟，仅 hover ＋ 才出现）',
    !!boundary && !!boundary.tip && boundary.tip.visible === false && boundary.tip.text === '插入列',
    boundary && boundary.tip ? `visible=${boundary.tip.visible} text=${boundary.tip.text}` : '没渲染')

  record('[边界条] 只写当前轴变量：--lark-doc-column-line-left 为 px，row-line-top 为空',
    !!boundary && /^-?\d+(\.\d+)?px$/.test(boundary.columnVar) && boundary.rowVar === '',
    boundary ? `colVar=${boundary.columnVar} rowVar="${boundary.rowVar}"` : '没渲染')

  await page.mouse.move(boundary.plusCenter.x, boundary.plusCenter.y)
  await page.waitForTimeout(280)
  boundary = await page.evaluate(measureBoundary)
  const plusBtnBg = await page.evaluate(() => {
    const btn = document.querySelector('.lark-doc-table-boundary-tools button')
    return btn ? getComputedStyle(btn).backgroundColor : null
  })
  record('[边界条 v8] hover ＋ 时按钮自身底色透明（全局 button:hover 不给它画外圈，反馈④）',
    plusBtnBg === 'rgba(0, 0, 0, 0)' || plusBtnBg === 'transparent', `btnBg=${plusBtnBg}`)
  record('[边界条] hover ＋ → hover line 挂进 DOM，class = is-column-line / aria-hidden=true',
    !!boundary && !!boundary.line && boundary.line.className === 'lark-doc-table-boundary-line is-column-line'
      && boundary.line.ariaHidden === 'true',
    boundary && boundary.line ? boundary.line.className : '没挂载')

  record('[v12d tip] hover 列 ＋ → 飞书同款 tip 可见：role=tooltip、文本「插入列」、深底白字 12px / radius 8px、pointer-events:none',
    !!boundary && !!boundary.tip && boundary.tip.visible === true
      && boundary.tip.role === 'tooltip' && boundary.tip.text === '插入列'
      && boundary.tip.bg === boundary.tip.arrowBg && boundary.tip.bg !== 'rgba(0, 0, 0, 0)'
      && boundary.tip.fontSize === '12px' && boundary.tip.radius === '8px'
      && boundary.tip.pointerEvents === 'none',
    boundary && boundary.tip ? `visible=${boundary.tip.visible} text=${boundary.tip.text} bg=${boundary.tip.bg} arrow=${boundary.tip.arrowBg} font=${boundary.tip.fontSize} radius=${boundary.tip.radius}` : '没渲染')

  record('[v12d tip] 列 tip 几何：底边在 ＋ 圆点上方（箭头搭在圆点顶缘）、水平对齐 ＋ 圆心、不越视口',
    !!boundary && !!boundary.tip && !!boundary.plusCenter
      && boundary.tip.box.bottom <= boundary.plusTop + 2
      && boundary.tip.box.bottom > boundary.plusTop - 16
      && Math.abs(boundary.tip.centerX - boundary.plusCenter.x) <= 6
      && boundary.tip.box.y >= 0
      && boundary.tip.box.right <= boundary.viewport.w && boundary.tip.box.right > 0,
    boundary && boundary.tip ? `tipBottom=${boundary.tip.box.bottom} plusTop=${boundary.plusTop} tipCx=${boundary.tip.centerX} plusCx=${boundary.plusCenter.x} box=${JSON.stringify(boundary.tip.box)}` : '没渲染')

  record('[边界条 v7] 竖线高度 = **真实表格**内部高度（wrapper 更宽时不越界）',
    !!boundary && !!boundary.line && !!boundary.realTable
      && Math.abs(boundary.line.height - boundary.realTable.height) <= 2
      && boundary.line.height <= boundary.realTable.height + 1,
    boundary && boundary.line ? `line.h=${boundary.line.height} table.h=${boundary.realTable?.height} wrap.h=${boundary.tableSize.height}` : '没挂载')

  const colsBefore = await page.evaluate(() => document.querySelectorAll('.ProseMirror table tr')[0].children.length)
  await page.mouse.click(boundary.plusCenter.x, boundary.plusCenter.y)
  await page.waitForTimeout(420)
  const colsAfter = await page.evaluate(() => document.querySelectorAll('.ProseMirror table tr')[0].children.length)
  record('[边界条] 点单颗 ＋ → 真的加一列（2 → 3），且边界条自己收起',
    colsAfter === colsBefore + 1 && (await page.evaluate(measureBoundary)) === null,
    `${colsBefore} → ${colsAfter}`)

  await setDoc(page)
  await page.evaluate(selectCell, 0)
  await page.waitForTimeout(260)
  const g3 = await page.evaluate(tableGeometry)
  await page.mouse.click(g3.firstCell.center.x, g3.firstCell.center.y)
  await page.waitForTimeout(220)
  await page.mouse.move(g3.firstCell.bottom.x, g3.firstCell.bottom.y)
  await page.waitForTimeout(280)
  boundary = await page.evaluate(measureBoundary)
  record('[边界条] 鼠标贴单元格下边界 → 切成行态（is-row / 单颗 lark-doc-table-row-plus-btn）',
    !!boundary && boundary.classes.indexOf('is-row') !== -1 && boundary.buttons.length === 1
      && /\blark-doc-table-row-plus-btn\b/.test(boundary.buttons[0].className)
      && boundary.buttons[0].ariaLabel === '在此处插入行',
    boundary ? `${boundary.classes.join('.')} [${boundary.buttons.map((b) => b.className)}]` : '没渲染')

  record('[边界条] 行态只写 --lark-doc-row-line-top（列变量清空）',
    !!boundary && /^-?\d+(\.\d+)?px$/.test(boundary.rowVar) && boundary.columnVar === '',
    boundary ? `rowVar=${boundary.rowVar} colVar="${boundary.columnVar}"` : '没渲染')

  await page.mouse.move(boundary.plusCenter.x, boundary.plusCenter.y)
  await page.waitForTimeout(280)
  boundary = await page.evaluate(measureBoundary)
  record('[边界条 v7] hover ＋ → 横线 is-row-line，宽度 = **真实表格**宽且不越界',
    !!boundary && !!boundary.line && boundary.line.className === 'lark-doc-table-boundary-line is-row-line'
      && !!boundary.realTable && boundary.line.width > 0
      && Math.abs(boundary.line.width - boundary.realTable.width) <= 2,
    boundary && boundary.line ? `line.w=${boundary.line.width} table.w=${boundary.realTable?.width} wrap.w=${boundary.tableSize.width}` : '没挂载')

  record('[v12d tip] hover 行 ＋ → tip 切为「插入行」，几何同列态（底边在 ＋ 圆点上方、水平对齐圆心、不越视口）',
    !!boundary && !!boundary.tip && boundary.tip.visible === true
      && boundary.tip.text === '插入行' && boundary.tip.role === 'tooltip'
      && boundary.tip.box.bottom <= boundary.plusTop + 2
      && Math.abs(boundary.tip.centerX - boundary.plusCenter.x) <= 6
      && boundary.tip.box.y >= 0 && boundary.tip.box.right <= boundary.viewport.w,
    boundary && boundary.tip ? `text=${boundary.tip.text} tipBottom=${boundary.tip.box.bottom} plusTop=${boundary.plusTop} tipCx=${boundary.tip.centerX} plusCx=${boundary.plusCenter.x}` : '没渲染')

  // v11：表格结构操作仍可达 —— 行 ＋ 真的加行（v10 的 table-ops action:addRowAfter 已删除）。
  const rowsBeforePlus = await page.evaluate(() => document.querySelectorAll('.ProseMirror table tr').length)
  await page.mouse.click(boundary.plusCenter.x, boundary.plusCenter.y)
  await page.waitForTimeout(420)
  const rowsAfterPlus = await page.evaluate(() => document.querySelectorAll('.ProseMirror table tr').length)
  record('[边界条] 点单颗行 ＋ → 真的加一行（2 → 3），表格结构操作仍可达（替代 v10 table-ops 的加行入口）',
    rowsAfterPlus === rowsBeforePlus + 1 && (await page.evaluate(measureBoundary)) === null,
    `rows=${rowsBeforePlus} → ${rowsAfterPlus}`)

  for (const [label, point] of [
    ['最左外边缘', g3.leftOuter],
    ['最上外边缘', g3.topOuter],
    ['左上角外侧', g3.cornerOuter],
  ]) {
    await page.mouse.move(point.x, point.y)
    await page.waitForTimeout(240)
    record(`[边界条] 悬浮表格${label} → 不产生 ＋（只认单元格右 / 下内部边线）`,
      (await page.evaluate(measureBoundary)) === null, '无候选边线')
  }

  const outside3 = await page.evaluate(outsidePoint)
  await page.mouse.move(outside3.x, outside3.y)
  await page.waitForTimeout(300)
  record('[边界条] 鼠标离开边线 → 边界条真从 DOM 摘掉',
    (await page.evaluate(measureBoundary)) === null, '已摘除')

  // ═════════════ ⑥ md 浮层几何层：选择条 / 渐隐 / 滚动条 / 重排 ═════════════
  await setDoc(page)
  const g5 = await page.evaluate(tableGeometry)
  await page.mouse.click(g5.firstCell.center.x, g5.firstCell.center.y)
  await page.waitForTimeout(320)
  const ov = await page.evaluate(measureOverlay)
  record('[浮层] 点进表格 → .lark-doc-table-overlay.is-visible 挂载',
    !!ov && ov.visible, ov ? `visible=${ov.visible}` : '没渲染')
  record('[浮层] 2×2 表格 → 2 条列选择条 + 2 条行选择条，且 A11Y 齐全',
    !!ov && ov.colSelectors === 2 && ov.rowSelectors === 2 && ov.selectorA11y,
    ov ? `col=${ov.colSelectors} row=${ov.rowSelectors} a11y=${ov.selectorA11y}` : '没渲染')
  record('[浮层] 左右渐隐 + 自绘滚动条[role=scrollbar] + 滑块 + 重排预览件齐全',
    !!ov && ov.edges.some((c) => c.includes('is-left')) && ov.edges.some((c) => c.includes('is-right'))
      && !!ov.scrollbar && ov.scrollbar.role === 'scrollbar' && ov.scrollbar.label === '表格横向滚动'
      && ov.scrollbar.orientation === 'horizontal' && ov.scrollbar.min === '0' && ov.scrollbar.max === '100'
      && ov.hasThumb && ov.hasDropLine && ov.hasDragCard,
    ov ? `${ov.edges.length} edges, scrollbar=${!!ov.scrollbar}` : '没渲染')

  const selPoints = await page.evaluate(selectorPoints, 'column')
  record('[浮层] 列选择条有真实可点击几何（宽高 > 0）',
    selPoints.length === 2 && selPoints.every((p) => p.w > 0 && p.h > 0 && Number.isFinite(p.x)),
    selPoints.map((p) => `${Math.round(p.w)}×${Math.round(p.h)}@${Math.round(p.x)},${Math.round(p.y)}`).join(' '))

  if (selPoints.length === 2) {
    await page.mouse.click(selPoints[0].x, selPoints[0].y)
    await page.waitForTimeout(300)
    const pressed = (await page.evaluate(measureOverlay))?.pressed
    record('[浮层] 点第 1 条列选择条 → 真的选中整列（aria-pressed=true）',
      pressed === 1, `pressed=${pressed}`)

    const before = await page.evaluate(firstRowTexts)
    await page.mouse.move(selPoints[0].x, selPoints[0].y)
    await page.mouse.down()
    await page.mouse.move(selPoints[1].x, selPoints[1].y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(420)
    const after = await page.evaluate(firstRowTexts)
    record('[浮层] 拖动列选择条 → moveTableColumn 真的把两列换了顺序',
      before.length === 2 && after.length === 2 && before[0] === after[1] && before[1] === after[0],
      `${before.join('|')} → ${after.join('|')}`)
  }

  // ═════════ ⑥.1 v7：窄表格（wrapper 比表格宽）线与浮窗的回归 ═════════
  // 用户实测反馈「高亮条超过 table」：自定义 nodeview 的 nodeDOM 返回 .tableWrapper
  // （纸张宽 539px），而内部 <table> 只有 242px，旧代码把 wrapper 宽当线宽。
  // 之前 ⑥ 的 2×2 表格恰好 table 宽 == wrapper 宽，断言是假阳性，这里补专门场景。
  const NARROW = '<p>前</p><table><tbody>' +
    '<tr><th><p>列一</p></th><th><p>列二</p></th><th><p>列三</p></th></tr>' +
    '<tr><td><p>甲一</p></td><td><p>甲二</p></td><td><p>甲三</p></td></tr>' +
    '<tr><td><p>乙一</p></td><td><p>乙二</p></td><td><p>乙三</p></td></tr>' +
    '</tbody></table><p>后</p>'
  await page.evaluate((content) => {
    (window.__larkDoc || document.querySelector('lark-doc')).setContent(content)
  }, NARROW)
  await page.waitForTimeout(420)
  const gN = await page.evaluate(tableGeometry)
  await page.mouse.click(gN.firstCell.center.x, gN.firstCell.center.y)
  await page.waitForTimeout(260)
  await page.mouse.move(gN.firstCell.bottom.x, gN.firstCell.bottom.y)
  await page.waitForTimeout(380)
  const narrow = await page.evaluate(() => {
    const t = document.querySelector('.ProseMirror table')?.getBoundingClientRect()
    const wrap = document.querySelector('.tableWrapper')?.getBoundingClientRect()
    const line = document.querySelector('.lark-doc-table-boundary-line')?.getBoundingClientRect()
    return {
      tableW: t ? Math.round(t.width) : 0,
      wrapW: wrap ? Math.round(wrap.width) : 0,
      lineW: line ? Math.round(line.width) : 0,
      lineRight: line ? Math.round(line.right) : 0,
      tableRight: t ? Math.round(t.right) : 0,
      bubbles: document.querySelectorAll('.lark-doc-bubble').length,
      tools: document.querySelectorAll('.lark-doc-table-tools').length,
    }
  })
  record('[边界条 v7] 窄表格确实复现 wrapper 比表格宽（用例有效）',
    narrow.wrapW > narrow.tableW + 20, `table.w=${narrow.tableW} wrapper.w=${narrow.wrapW}`)
  record('[边界条 v7] 行高亮线宽度 = 表格宽，右端**不超过表格**（反馈：线超 table）',
    narrow.lineW > 0 && Math.abs(narrow.lineW - narrow.tableW) <= 2
      && narrow.lineRight <= narrow.tableRight + 2,
    `line.w=${narrow.lineW} table.w=${narrow.tableW} line.right=${narrow.lineRight} table.right=${narrow.tableRight}`)
  record('[唯一浮窗 v7] 窄表格选区态也只有 0 个气泡条 / 至多 1 个表格浮窗',
    narrow.bubbles === 0 && narrow.tools <= 1, `bubble=${narrow.bubbles} tools=${narrow.tools}`)

  // ① 蓝胶囊：columnResizing 只在悬浮列边界时动态插入 .column-resize-handle，
  // 所以断言必须在「手柄确实在 DOM 里」的状态下做，否则恒真（v6 的假阳性）。
  await page.mouse.move(gN.firstCell.right.x, gN.firstCell.right.y)
  await page.waitForTimeout(360)
  const caps = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.ProseMirror .column-resize-handle')]
    return {
      count: nodes.length,
      visible: nodes.filter((n) => {
        const a = getComputedStyle(n, '::after')
        return a.content !== 'none' && parseFloat(a.opacity) > 0.05
      }).length,
      hasResizeCursor: !!document.querySelector('.ProseMirror.resize-cursor'),
    }
  })
  record('[浮层 v7] 悬浮列交界时手柄热区在（用例有效）且**零个可见蓝色胶囊**（反馈①）',
    caps.count > 0 && caps.visible === 0,
    `handles=${caps.count} visible=${caps.visible} resize-cursor=${caps.hasResizeCursor}`)

  // ═════════════ ⑥.2 打印态：@media print 隐藏表格浮窗（防打印带出操作条） ═════════════
  await setDoc(page)
  const geoPrint = await page.evaluate(tableGeometry)
  snap = await openTextSelection(page, geoPrint)
  const printBefore = snap.count
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  const printSnap = await page.evaluate(() => {
    const el = document.querySelector('.lark-doc-table-tools')
    return {
      count: document.querySelectorAll('.lark-doc-table-tools').length,
      display: el ? getComputedStyle(el).display : null,
      // 打印规则可能作用在祖先上，子元素 computed display 仍是原值，用渲染树判定更稳。
      clientRects: el ? el.getClientRects().length : -1,
    }
  })
  record('[打印态] @media print → 表格浮窗被隐藏（display:none / 不在渲染树，DOM 仍在）',
    printBefore === 1 && printSnap.count === 1 && printSnap.display === 'none' && printSnap.clientRects === 0,
    `before=${printBefore} count=${printSnap.count} display=${printSnap.display} rects=${printSnap.clientRects}`)
  await page.emulateMedia({ media: 'screen' })
  await page.waitForTimeout(160)

  // ═════════════ ⑦ 只读态 ═════════════
  await page.evaluate(selectCell, 0)
  await page.waitForTimeout(220)
  await page.evaluate(() => { (window.__larkDoc || document.querySelector('lark-doc')).setReadonly(true) })
  await page.waitForTimeout(340)
  snap = await page.evaluate(measureToolbar)
  record('[只读] 只读态下唯一浮窗不进 DOM（count=0）', snap.count === 0, '只读')
  const g4 = await page.evaluate(tableGeometry)
  await page.mouse.move(g4.firstCell.right.x, g4.firstCell.right.y)
  await page.waitForTimeout(260)
  record('[只读] 只读态下边界条也不进 DOM',
    (await page.evaluate(measureBoundary)) === null, '只读')

  record('无脚本错误', errors.length === 0, errors.join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
  process.exit(failed.length ? 1 : 0)
})().catch((error) => {
  console.error('运行失败：', error)
  process.exit(2)
})
