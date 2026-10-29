'use strict'
/**
 * 浏览器级验证：右下角 `?` 帮助圆钮与 hover 菜单（`editor/HelpFab.vue`，阶段 5 批次 5G）。
 *
 * 这块体量最小的组件，语义却是最「纯粹的交互」：没有外部状态进来的路径，所有开关都在
 * 组件自己身上（`menuOpen` + 160ms 定时器）。原生化时必须逐条守住下面五件事：
 *   ① 开合是 **`v-if`**（菜单真进真出 DOM），不是 `v-show`；
 *   ② `aria-expanded` **永远存在**，取值 `'true'` / `'false'`（不是 toggle 掉属性）；
 *   ③ 鼠标越过「圆钮 → 菜单」之间那 **12px 缝隙**不能闪 —— 160ms 抖动窗口，与二级
 *      子菜单同口径（07 §9）。这条最容易被「顺手优化」成 0ms 而回归；
 *   ④ 5 项里**只有「快捷键」**在本项目有落点（打开快捷键抽屉），其余 4 项点了只关菜单，
 *      **不许伪造跳转**、不许弹空态；
 *   ⑤ 菜单在圆钮**上方 12px**（`bottom: calc(100% + 12px)`）、宽 120px、项 112×30。
 *
 * 量法说明（`lark-doc.css:2218-2225`，viewport 1440×900）：
 * - `.lark-doc-help-fab-wrap` `position:fixed; right:19px; bottom:30px; z-index:60`；
 * - `.lark-doc-help-fab` **36×36**、`border-radius:50%`、`display:grid; place-items:center`、
 *   `font-size:16px`、`box-shadow: var(--ld-shadow-tooltip)`；
 * - `.lark-doc-help-menu` **120px** 宽、`padding:8px 4px`、`border-radius:8px`；
 * - `.lark-doc-help-menu-item` **112×30**、`gap:8px`、`font-size:12px`、`text-align:left`。
 *
 * 依赖：demo dev server（`window.__larkDoc`）。用法：
 *   node scripts/verify-browser-help-fab.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const results = []

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

/** 圆钮 + 菜单的整体快照。菜单不在 DOM 里时 `menu === null` —— 断言 ① 就靠这个 null。 */
const measureFab = () => {
  const wrap = document.querySelector('.lark-doc-help-fab-wrap')
  if (!wrap) return { wrapInDom: false }
  const button = wrap.querySelector('.lark-doc-help-fab')
  const menu = wrap.querySelector('.lark-doc-help-menu')
  const cs = getComputedStyle(wrap)
  const buttonStyle = button ? getComputedStyle(button) : null
  const buttonRect = button ? button.getBoundingClientRect() : null
  const items = menu ? [...menu.querySelectorAll('.lark-doc-help-menu-item')] : []
  const menuStyle = menu ? getComputedStyle(menu) : null
  const menuRect = menu ? menu.getBoundingClientRect() : null
  return {
    wrapInDom: true,
    // wrap 自身：定位与层级（06 六档体系的第 1 档 60）
    wrapPosition: cs.position,
    wrapZIndex: cs.zIndex,
    wrapRight: Math.round(parseFloat(cs.right)),
    wrapBottom: Math.round(parseFloat(cs.bottom)),
    // 圆钮
    button: button ? {
      tag: button.tagName.toLowerCase(),
      classes: [...button.classList],
      type: button.getAttribute('type'),
      ariaLabel: button.getAttribute('aria-label'),
      ariaHaspopup: button.getAttribute('aria-haspopup'),
      // ⚠️ 这里要的是「属性存在 + 取值」，`null` 就是违约（不是 undefined 的等价物）
      ariaExpanded: button.getAttribute('aria-expanded'),
      text: button.textContent.trim(),
      // 除 class / type / aria-* 之外不许有别的东西
      extraAttrs: [...button.attributes].map((a) => a.name)
        .filter((name) => name !== 'class' && name !== 'type' && name.indexOf('aria-') !== 0),
      width: buttonRect ? Math.round(buttonRect.width) : null,
      height: buttonRect ? Math.round(buttonRect.height) : null,
      radius: buttonStyle ? buttonStyle.borderRadius : null,
      display: buttonStyle ? buttonStyle.display : null,
      placeItems: buttonStyle ? buttonStyle.placeItems || buttonStyle.alignItems : null,
      fontSize: buttonStyle ? buttonStyle.fontSize : null,
      shadow: buttonStyle ? buttonStyle.boxShadow : null,
      centerX: buttonRect ? buttonRect.left + buttonRect.width / 2 : null,
      centerY: buttonRect ? buttonRect.top + buttonRect.height / 2 : null,
      top: buttonRect ? buttonRect.top : null,
    } : null,
    // 菜单（v-if → 不在 DOM 里时为 null）
    menu: menu ? {
      tag: menu.tagName.toLowerCase(),
      classes: [...menu.classList],
      role: menu.getAttribute('role'),
      ariaLabel: menu.getAttribute('aria-label'),
      width: menuRect ? Math.round(menuRect.width) : null,
      paddingTop: menuStyle.paddingTop,
      paddingLeft: menuStyle.paddingLeft,
      radius: menuStyle.borderRadius,
      display: menuStyle.display,
      // 菜单底边与圆钮顶边的间距：`bottom: calc(100% + 12px)` → 恰 12px
      gapToButton: Math.round(buttonRect.top - menuRect.bottom),
      right: Math.round(parseFloat(menuStyle.right)),
      itemCount: items.length,
      itemTexts: items.map((item) => item.textContent.trim()),
      items: items.map((item) => {
        const style = getComputedStyle(item)
        const rect = item.getBoundingClientRect()
        const icon = item.querySelector('.lark-doc-icon')
        const label = item.querySelector('span:not(.lark-doc-icon)')
        const iconRect = icon ? icon.getBoundingClientRect() : null
        return {
          tag: item.tagName.toLowerCase(),
          type: item.getAttribute('type'),
          role: item.getAttribute('role'),
          classes: [...item.classList],
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          fontSize: style.fontSize,
          gap: style.gap,
          textAlign: style.textAlign,
          iconWidth: iconRect ? Math.round(iconRect.width) : null,
          iconHeight: iconRect ? Math.round(iconRect.height) : null,
          // 段序：图标 span 在前、文案 span 在后（与 SFC 的 `<lark-doc-icon /><span>` 一致）
          childTags: [...item.children].map((n) => `${n.tagName.toLowerCase()}.${n.className}`),
          labelText: label ? label.textContent.trim() : null,
        }
      }),
    } : null,
    // 有抽屉开着吗（「快捷键」项的落点）
    drawerInDom: !!document.querySelector('.lark-doc-drawer.lark-doc-help-drawer'),
  }
}

// —— 页面操作 ——

const readFab = (page) => page.evaluate(measureFab)

const moveTo = async (page, x, y) => {
  await page.mouse.move(x, y)
  await page.waitForTimeout(60)
}

/** 把指针挪到远处正文上（mouseleave → hideLater），并等够 160ms 窗口。 */
const parkPointer = async (page) => {
  await page.mouse.move(600, 500)
  await page.waitForTimeout(260)
}

/**
 * 悬停到圆钮中心（mouseenter → showMenu）。
 *
 * ⚠️ 必须先 `parkPointer`：`mouseenter` 只在「从外部进入」时触发，指针已经停在圆钮上
 * 再 `mouse.move` 到同一坐标**不会**重放事件 —— 菜单不会重新打开（探针会误判成
 * 「点某项没反应」）。
 */
const hoverFab = async (page) => {
  await parkPointer(page)
  const snap = await readFab(page)
  await moveTo(page, snap.button.centerX, snap.button.centerY)
  await page.waitForTimeout(140)
}

const clickMenuItem = async (page, label) => {
  await page.evaluate((text) => {
    const item = [...document.querySelectorAll('.lark-doc-help-menu-item')]
      .find((node) => node.textContent.trim() === text)
    if (item) item.click()
  }, label)
  await page.waitForTimeout(280)
}

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  // 关掉可能已经开着的抽屉（Esc 逐层收浮层里 helpOpen 排在中段，按两次更稳）
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // ——————————————————— ① 初始态：菜单真不在 DOM 里 ———————————————————
  const idle = await readFab(page)
  record('[初始] 圆钮在 DOM 里，菜单**不在 DOM 里**（v-if 语义，不是 display:none）',
    idle.wrapInDom === true && idle.button !== null && idle.menu === null,
    idle.wrapInDom ? `button=${!!idle.button} menu=${idle.menu}` : '根节点都没有')

  record('[初始] `aria-expanded` 属性存在且为 `"false"`（不是摘掉属性、不是 "undefined"）',
    !!idle.button && idle.button.ariaExpanded === 'false',
    idle.button ? JSON.stringify(idle.button.ariaExpanded) : '没渲染')

  // ——————————————————— ② 结构 ———————————————————
  record('[结构] 圆钮 = button.lark-doc-help-fab[type=button][aria-label=帮助][aria-haspopup=menu]，文案 `?`',
    !!idle.button && idle.button.tag === 'button' && idle.button.type === 'button' &&
      idle.button.classes.length === 1 && idle.button.classes[0] === 'lark-doc-help-fab' &&
      idle.button.ariaLabel === '帮助' && idle.button.ariaHaspopup === 'menu' && idle.button.text === '?',
    idle.button ? `${idle.button.tag}[${idle.button.classes.join('.')}] ${JSON.stringify(idle.button.text)}` : '没渲染')

  record('[结构] 圆钮上除 class / type / aria-* 之外**没有多余属性**（不许悄悄挂 role / data-*）',
    !!idle.button && idle.button.extraAttrs.length === 0,
    idle.button ? `[${idle.button.extraAttrs.join(',')}]` : '没渲染')

  // ——————————————————— ③ 圆钮版式 ———————————————————
  record('[版式] 圆钮 36×36 + `border-radius:50%` + `display:grid` + `place-items:center`',
    !!idle.button && idle.button.width === 36 && idle.button.height === 36 &&
      idle.button.radius === '50%' && idle.button.display === 'grid' && idle.button.placeItems === 'center',
    idle.button ? `${idle.button.width}×${idle.button.height} ${idle.button.radius} ${idle.button.display}/${idle.button.placeItems}` : '没渲染')

  record('[版式] 圆钮字号 16px（`?` 是 16px 字，不是图标）',
    !!idle.button && idle.button.fontSize === '16px',
    idle.button ? idle.button.fontSize : '没渲染')

  record('[版式] 圆钮有投影（var(--ld-shadow-tooltip) → 非 none）',
    !!idle.button && idle.button.shadow && idle.button.shadow !== 'none',
    idle.button ? idle.button.shadow.slice(0, 40) : '没渲染')

  record('[版式] 停泊位 = `position:fixed` 右下角（right 19 / bottom 30）、z-index 60（六档体系第 1 档）',
    idle.wrapInDom && idle.wrapPosition === 'fixed' && idle.wrapRight === 19 &&
      idle.wrapBottom === 30 && idle.wrapZIndex === '60',
    idle.wrapInDom ? `${idle.wrapPosition} right:${idle.wrapRight} bottom:${idle.wrapBottom} z:${idle.wrapZIndex}` : '没渲染')

  // ——————————————————— ④ 悬停打开 ———————————————————
  await hoverFab(page)
  const opened = await readFab(page)
  record('[悬停] 鼠标进圆钮 → 菜单真进 DOM（`v-if` 转真）',
    opened.menu !== null, opened.menu ? '已在 DOM' : '没进 DOM')

  record('[悬停] `aria-expanded` 同步变 `"true"`',
    opened.button && opened.button.ariaExpanded === 'true',
    opened.button ? JSON.stringify(opened.button.ariaExpanded) : '没渲染')

  record('[结构] 菜单 = div.lark-doc-help-menu[role=menu][aria-label=帮助菜单]',
    !!opened.menu && opened.menu.tag === 'div' && opened.menu.classes.length === 1 &&
      opened.menu.classes[0] === 'lark-doc-help-menu' &&
      opened.menu.role === 'menu' && opened.menu.ariaLabel === '帮助菜单',
    opened.menu ? `${opened.menu.tag}[${opened.menu.classes.join('.')}] role=${opened.menu.role}` : '没渲染')

  record('[结构] 菜单 5 项，顺序 = 上传日志 / 联系客服 / 功能更新 / 帮助中心 / 快捷键',
    !!opened.menu && opened.menu.itemCount === 5 &&
      opened.menu.itemTexts.join('|') === '上传日志|联系客服|功能更新|帮助中心|快捷键',
    opened.menu ? opened.menu.itemTexts.join(' / ') : '没渲染')

  const ITEM_LABELS = ['上传日志', '联系客服', '功能更新', '帮助中心', '快捷键']
  record('[结构] 每项 = button.lark-doc-help-menu-item[type=button][role=menuitem]，图标 span 在前、文案 span 在后',
    !!opened.menu && opened.menu.items.every((item, index) => item.tag === 'button' && item.type === 'button' &&
      item.role === 'menuitem' && item.classes.length === 1 &&
      item.classes[0] === 'lark-doc-help-menu-item' &&
      item.childTags.length === 2 &&
      item.childTags[0] === 'span.lark-doc-icon' &&
      // 文案 span 是裸 `span`（className 为空串，模板里没有 class）
      item.childTags[1] === 'span.' &&
      // 图标在前、文案在后：文案 span 的文本就是整项文本去掉图标（图标无文本）
      item.labelText === ITEM_LABELS[index]),
    opened.menu ? opened.menu.items.map((item) => item.childTags.join('+')).join(' | ') : '没渲染')

  record('[结构] 每项图标是 16×16（`:size="16"` 落到内联宽高）',
    !!opened.menu && opened.menu.items.every((item) => item.iconWidth === 16 && item.iconHeight === 16),
    opened.menu ? opened.menu.items.map((item) => `${item.iconWidth}×${item.iconHeight}`).join(' ') : '没渲染')

  // ——————————————————— ⑤ 菜单版式 ———————————————————
  record('[版式] 菜单在圆钮**上方 12px**（`bottom: calc(100% + 12px)`）、宽 120px',
    !!opened.menu && opened.menu.gapToButton === 12 && opened.menu.width === 120,
    opened.menu ? `gap=${opened.menu.gapToButton}px width=${opened.menu.width}px` : '没渲染')

  record('[版式] 菜单 `display:grid` + `padding:8px 4px` + `border-radius:8px` + 右偏 14px',
    !!opened.menu && opened.menu.display === 'grid' &&
      opened.menu.paddingTop === '8px' && opened.menu.paddingLeft === '4px' &&
      opened.menu.radius === '8px' && opened.menu.right === 14,
    opened.menu ? `${opened.menu.display} pad ${opened.menu.paddingTop}/${opened.menu.paddingLeft} r=${opened.menu.radius} right=${opened.menu.right}` : '没渲染')

  record('[版式] 每项 112×30、`gap:8px`、字号 12px、左对齐',
    !!opened.menu && opened.menu.items.every((item) => item.width === 112 && item.height === 30 &&
      item.gap === '8px' && item.fontSize === '12px' && item.textAlign === 'left'),
    opened.menu ? opened.menu.items.map((item) => `${item.width}×${item.height}`).join(' ') : '没渲染')

  // ——————————————————— ⑥ 12px 缝隙不闪（160ms 抖动窗口） ———————————————————
  // 菜单底边与圆钮顶边之间有 12px 的「真空」，指针从这里过会先触发 wrap 的 mouseleave。
  // 160ms 窗口内必须还开着 —— 这是 07 §9 与二级子菜单同口径的要求。
  const buttonTop = opened.button.top
  const buttonX = opened.button.centerX
  await page.mouse.move(buttonX, buttonTop - 6)
  await page.waitForTimeout(100)
  const inGap = await readFab(page)
  record('[缝隙] 指针停在 12px 缝隙里 100ms → 菜单**仍然开着**（160ms 抖动窗口内不关）',
    inGap.menu !== null, inGap.menu ? '还开着' : '被提前关掉了（窗口 < 100ms）')

  await page.mouse.move(buttonX, buttonTop - 20)
  await page.waitForTimeout(100)
  const backInMenu = await readFab(page)
  record('[缝隙] 继续挪到菜单上 → 仍开着（`cancelHide` 接住了，没闪一下）',
    backInMenu.menu !== null, backInMenu.menu ? '还开着' : '跨缝隙后关掉了')

  // ——————————————————— ⑦ 移开 160ms 后关 ———————————————————
  await page.mouse.move(600, 500)
  await page.waitForTimeout(100)
  const justLeft = await readFab(page)
  record('[收起] 移开 100ms → 还在（窗口是 160ms，不是立刻关）',
    justLeft.menu !== null, justLeft.menu ? '还开着' : '立刻关了（窗口没生效）')

  await page.waitForTimeout(200)
  const gone = await readFab(page)
  record('[收起] 移开累计 300ms → 菜单真出 DOM，`aria-expanded` 回到 `"false"`',
    gone.menu === null && gone.button && gone.button.ariaExpanded === 'false',
    `menu=${gone.menu} expanded=${gone.button ? gone.button.ariaExpanded : '?'}`)

  // ——————————————————— ⑧ 点击 toggle 与 focus 打开 ———————————————————
  // 程序化 `element.click()` **不会**给元素焦点（浏览器的 focus 在 mousedown 阶段，
  // 合成 click 里没有），所以这两条单独量到的是 `toggleMenu` 那一支。
  await parkPointer(page)
  await page.evaluate(() => document.querySelector('.lark-doc-help-fab').click())
  await page.waitForTimeout(200)
  const byClick = await readFab(page)
  record('[点击] 程序化 click（不带焦点）→ 从关闭态打开（`toggleMenu` 的「开」分支）',
    byClick.menu !== null, byClick.menu ? '已打开' : '没打开')

  await page.evaluate(() => document.querySelector('.lark-doc-help-fab').click())
  await page.waitForTimeout(200)
  const byClickTwice = await readFab(page)
  record('[点击] 再点一次 → 关（`toggleMenu` 的「关」分支）',
    byClickTwice.menu === null, byClickTwice.menu ? '还开着' : '已关')

  // focus 打开：先失焦到正文，再 focus 圆钮
  await page.evaluate(() => {
    if (document.activeElement) document.activeElement.blur()
    document.querySelector('.lark-doc-help-fab').focus()
  })
  await page.waitForTimeout(200)
  const byFocus = await readFab(page)
  record('[焦点] 圆钮被聚焦 → 菜单打开（`@focus="showMenu"`，键盘用户可达）',
    byFocus.menu !== null, byFocus.menu ? '已打开' : '没打开')

  // 真实鼠标路径：hover 已经把菜单打开了，此时点击走 `toggleMenu` 的「关」分支。
  // 这不是 bug —— 鼠标用户的手感就是「悬停即开、再点就收起」，别顺手改成「点了才开」。
  await hoverFab(page)
  const beforeRealClick = await readFab(page)
  await page.mouse.click(beforeRealClick.button.centerX, beforeRealClick.button.centerY)
  await page.waitForTimeout(200)
  const afterRealClick = await readFab(page)
  record('[点击] 真实鼠标点击（hover 已开）→ 收起（悬停即开、再点收起，别改成「点了才开」）',
    beforeRealClick.menu !== null && afterRealClick.menu === null,
    `hover=${beforeRealClick.menu !== null} click后=${afterRealClick.menu !== null}`)

  // ——————————————————— ⑨ 5 项的落点：只有「快捷键」有 ———————————————————
  await hoverFab(page)
  await clickMenuItem(page, '功能更新')
  const afterNoop = await readFab(page)
  record('[落点] 点「功能更新」（外部服务入口）→ 菜单收起，**不打开任何抽屉**（不伪造跳转）',
    afterNoop.menu === null && afterNoop.drawerInDom === false,
    `menu=${afterNoop.menu} drawer=${afterNoop.drawerInDom}`)

  await hoverFab(page)
  await clickMenuItem(page, '快捷键')
  const afterShortcuts = await readFab(page)
  record('[落点] 点「快捷键」→ 菜单收起 + 快捷键抽屉打开（`.lark-doc-help-drawer`）',
    afterShortcuts.menu === null && afterShortcuts.drawerInDom === true,
    `menu=${afterShortcuts.menu} drawer=${afterShortcuts.drawerInDom}`)

  record('无脚本错误', errors.length === 0, errors.join(' | '))

  const passed = results.filter((item) => item.ok).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
