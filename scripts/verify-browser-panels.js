'use strict'
/**
 * 浏览器级验证：面板与宿主弹窗的「结构即契约」（阶段 5 批次 4b）。
 *
 * 批次 4b 要把 5 个「面板 / 宿主弹窗」SFC 换成原生 DOM 片段（`src/ui/panels.js`）：
 *   ① `editor/OutlinePanel.vue`   —— 目录侧栏（210px sticky，父级另有一颗 reopen 兄弟钮）
 *   ② `CommentPanel.vue`          —— 评论面板层（`display:contents` 容器 + 每线程一张 270 卡）
 *   ③ `VersionPanel.vue`          —— 历史记录全屏层（左栏预览 + 右栏按天时间线）
 *   ④ `SaveVersionDialog.vue`     —— 另存为版本 Dialog + 恢复成功 toast
 *   ⑤ `TemplateLibrary.vue`       —— 宿主侧模板库（**不在编辑器里**，独立路由）
 *
 * 这套断言就是那批改动的**回归闸门**：改前先跑绿，改完必须仍然全绿，一条都不许「调松」。
 *
 * 为什么这五个要单独一套（而不是并进 verify-browser-dialogs.js）：
 * - 它们的状态来源是 **mixin data + provider 数据**，不是「点开一个弹窗」。评论面板与
 *   历史记录面板在 demo 里**默认没有 provider**，必须页面内注入内存 Provider 才能画出
 *   有数据的那一支；模板库根本不在编辑器路由上（`/lark-doc-templates` 独立页）。
 * - 条件段密度远高于 4a：`v-if` 出现在面板头/回复行/草稿态/降级态/空态/分组/预览/diff
 *   十几处，改成 `display:none` 会被读屏念出来，所以每一处都要求**真进真出 DOM**。
 * - 四条反直觉行为是产品契约，不是实现细节：
 *   a) 历史记录 `Esc` **关不掉**（唯一出口是左栏「返回文档」）；
 *   b) 另存为版本 `Esc` **能关**、点遮罩**不关**（与 a 正好相反）；
 *   c) 页码文案恒为「编辑记录 N/M」，翻的是**游标**不是版本；
 *   d) 模板库「使用」= 交给宿主整篇复制，组件内不插内容。
 *
 * 量法说明（以 SFC + 实测 CSS 为准，改动前逐条核对过）：
 * - 目录：`flex:0 0 210px`、`position:sticky`、`padding:26px 12px 30px 18px`；
 *   item 缩进 `min(level-1,5)*10`；箭头是 8×12 的 CSS 三角（非 SVG）。
 * - 评论：层 `display:contents`；卡 270 宽 / radius 6 / `position:fixed` / `z-index:1040`；
 *   三态高度 150 / 156 / 238，草稿态再 +82（textarea 58→98）。
 * - 历史记录：全屏 fixed / `z-index:99` / flex / 左栏 flex:1 / 右栏 294；
 *   置灰底色恒为 `rgb(187, 191, 196)`。
 * - 模板库：31 个分类 tab，默认 `recommend` 激活，该分类 12 张卡
 *   （11 张打了 recommend + 1 张 `categories: []` 的野生模板，未打标签每类都露出）。
 *
 * 依赖：demo dev server（`window.__larkDoc`）+ 模板库路由（同一 server 的 `/lark-doc-templates`）。
 * 用法：node scripts/verify-browser-panels.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const TEMPLATE_BASE = BASE.replace(/\/lark-doc\/?$/, '/lark-doc-templates')
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

const HEADING_CONTENT = '<h1>第一章</h1><h2>第一节</h2><p>段一</p><h2>第二节</h2><h3>细节</h3><p>段二</p>'

// ══════════════ 页面内工具函数（必须自包含：会被 page.evaluate 序列化执行） ══════════════

/** 目录侧栏整体快照。 */
const measureOutline = () => {
  const el = document.querySelector('.lark-doc-outline')
  if (!el) return null
  const cs = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const heading = el.querySelector('.lark-doc-outline-heading')
  const closeBtn = heading ? heading.querySelector('button') : null
  const icons = (node) => {
    if (!node) return null
    const box = node.querySelector('.lark-doc-icon')
    if (!box) return null
    const r = box.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), svg: !!box.querySelector('svg') }
  }
  const items = [...el.querySelectorAll('.lark-doc-outline-item')].map((item) => {
    const kids = [...item.children]
    const toggle = kids[0] && kids[0].tagName === 'BUTTON' ? kids[0] : null
    const placeholder = kids[0] && kids[0].tagName === 'SPAN' ? kids[0] : null
    const jump = kids[1] || null
    const arrow = toggle ? toggle.querySelector('.lark-doc-outline-arrow') : null
    return {
      paddingLeft: item.style.paddingLeft,
      toggle: toggle ? {
        expanded: toggle.getAttribute('aria-expanded'),
        label: toggle.getAttribute('aria-label'),
        title: toggle.getAttribute('title'),
        type: toggle.getAttribute('type'),
      } : null,
      arrow: arrow ? { cls: arrow.className, ariaHidden: arrow.getAttribute('aria-hidden') } : null,
      placeholder: placeholder ? { cls: placeholder.className, ariaHidden: placeholder.getAttribute('aria-hidden') } : null,
      jump: jump ? {
        text: jump.textContent.trim(),
        disabled: jump.disabled,
        title: jump.getAttribute('title'),
        active: jump.classList.contains('active'),
        type: jump.getAttribute('type'),
      } : null,
    }
  })
  return {
    width: Math.round(rect.width),
    position: cs.position,
    flexBasis: cs.flexBasis,
    padding: cs.padding,
    overflowY: cs.overflowY,
    ariaLabel: el.getAttribute('aria-label'),
    tag: el.tagName.toLowerCase(),
    headingStrong: heading && heading.querySelector('strong') ? heading.querySelector('strong').textContent.trim() : null,
    headingChildren: heading ? [...heading.children].map((n) => n.tagName.toLowerCase()) : [],
    closeLabel: closeBtn ? closeBtn.getAttribute('aria-label') : null,
    closeType: closeBtn ? closeBtn.getAttribute('type') : null,
    closeIcon: icons(closeBtn),
    emptyText: el.querySelector(':scope > p') ? el.querySelector(':scope > p').textContent.trim() : null,
    items,
  }
}

/** 评论面板层整体快照（只取第一张卡，多卡场景另有断言）。 */
const measureComments = () => {
  const layer = document.querySelector('.lark-doc-comment-layer')
  const panel = document.querySelector('.lark-doc-comment-panel')
  if (!layer || !panel) return { layer: !!layer, panel: !!panel }
  const cs = getComputedStyle(panel)
  const rect = panel.getBoundingClientRect()
  const head = panel.querySelector('.lark-doc-comment-head')
  const controls = panel.querySelector('.lark-doc-comment-controls')
  const replies = [...panel.querySelectorAll('.lark-doc-comment-reply')]
  const firstReply = replies[0] || null
  const replyMain = firstReply ? firstReply.querySelector('.lark-doc-comment-reply-main') : null
  const avatar = firstReply ? firstReply.querySelector('.lark-doc-comment-avatar') : null
  const avatarIcon = avatar ? avatar.querySelector('.lark-doc-icon') : null
  const textareaWrap = panel.querySelector('.lark-doc-comment-textarea')
  const textarea = panel.querySelector('.lark-doc-comment-input-zone')
  const actions = panel.querySelector('.lark-doc-comment-actions')
  const moreMenu = panel.querySelector('.lark-doc-comment-more-menu')
  const replyMenu = panel.querySelector('.lark-doc-comment-reply-menu')
  const iconSize = (node) => {
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  }
  return {
    layer: true,
    panel: true,
    layerDisplay: getComputedStyle(layer).display,
    panelCount: document.querySelectorAll('.lark-doc-comment-panel').length,
    role: panel.getAttribute('role'),
    ariaLabel: panel.getAttribute('aria-label'),
    inlineStyle: panel.getAttribute('style'),
    rect: { w: Math.round(rect.width), h: Math.round(rect.height), left: Math.round(rect.left) },
    css: { position: cs.position, zIndex: cs.zIndex, radius: cs.borderTopLeftRadius },
    headChildren: head ? [...head.children].map((n) => n.className) : [],
    quote: head && head.querySelector('.lark-doc-comment-quote') ? head.querySelector('.lark-doc-comment-quote').textContent.trim() : null,
    cells: controls ? [...controls.children].map((n) => ({
      cls: n.className,
      childTag: n.children[0] ? n.children[0].tagName.toLowerCase() : null,
    })) : [],
    buttons: controls ? [...controls.querySelectorAll('button')].map((b) => ({
      label: b.getAttribute('aria-label'),
      cls: b.className,
      type: b.getAttribute('type'),
      hasIcon: !!b.querySelector('.lark-doc-icon'),
      hasDots: !!b.querySelector('.lark-doc-comment-dots'),
      iconSize: iconSize(b.querySelector('.lark-doc-icon')),
    })) : [],
    split: (() => {
      const node = controls ? controls.querySelector('.lark-doc-comment-split') : null
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), ariaHidden: node.getAttribute('aria-hidden') }
    })(),
    replyCount: replies.length,
    reply: firstReply ? {
      hasMain: !!replyMain,
      avatarSize: avatarIcon ? iconSize(avatarIcon) : null,
      avatarHidden: avatar ? avatar.getAttribute('aria-hidden') : null,
      name: firstReply.querySelector('.lark-doc-comment-name') ? firstReply.querySelector('.lark-doc-comment-name').textContent.trim() : null,
      time: firstReply.querySelector('.lark-doc-comment-time') ? firstReply.querySelector('.lark-doc-comment-time').textContent.trim() : null,
      body: firstReply.querySelector('.lark-doc-comment-body') ? firstReply.querySelector('.lark-doc-comment-body').textContent.trim() : null,
      controls: [...firstReply.querySelectorAll('.lark-doc-comment-reply-controls button')].map((b) => ({
        label: b.getAttribute('aria-label'),
        type: b.getAttribute('type'),
        cls: b.className,
      })),
    } : null,
    replyMenu: replyMenu ? {
      items: [...replyMenu.querySelectorAll('.lark-doc-comment-menu-item')].map((li) => ({
        text: li.querySelector('.lark-doc-comment-menu-label') ? li.querySelector('.lark-doc-comment-menu-label').textContent.trim() : li.textContent.trim(),
        arrows: li.querySelectorAll('.lark-doc-comment-menu-arrow').length,
      })),
    } : null,
    textarea: textarea ? {
      label: textarea.getAttribute('aria-label'),
      readonly: textarea.readOnly,
      value: textarea.value,
      wrapHeight: textareaWrap ? Math.round(textareaWrap.getBoundingClientRect().height) : null,
      wrapInline: textareaWrap ? textareaWrap.getAttribute('style') : null,
      operation: (() => {
        const btn = panel.querySelector('.lark-doc-comment-operation')
        return btn ? { label: btn.getAttribute('aria-label'), type: btn.getAttribute('type'), iconSize: iconSize(btn.querySelector('.lark-doc-icon')) } : null
      })(),
    } : null,
    actions: actions ? [...actions.querySelectorAll('.lark-doc-comment-action')].map((b) => ({
      text: b.textContent.trim(),
      cls: b.className,
      type: b.getAttribute('type'),
    })) : null,
    moreMenu: moreMenu ? {
      rowChildren: [...(moreMenu.querySelector('.lark-doc-comment-more-row') || { children: [] }).children].map((n) => n.className),
      iconSize: iconSize(moreMenu.querySelector('.lark-doc-comment-more-icon .lark-doc-icon')),
      title: moreMenu.querySelector('.lark-doc-comment-more-title') ? moreMenu.querySelector('.lark-doc-comment-more-title').textContent.trim() : null,
      switchRole: (() => {
        const sw = moreMenu.querySelector('.lark-doc-comment-switch')
        return sw ? { role: sw.getAttribute('role'), checked: sw.getAttribute('aria-checked'), cls: sw.className, handler: !!sw.querySelector('.lark-doc-comment-switch-handler') } : null
      })(),
      hint: moreMenu.querySelector('.lark-doc-comment-more-hint') ? moreMenu.querySelector('.lark-doc-comment-more-hint').textContent.trim() : null,
    } : null,
  }
}

/** 历史记录全屏层整体快照。 */
const measureVersions = () => {
  const el = document.querySelector('.lark-doc-version-layer')
  if (!el) return null
  const cs = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const leftHeader = el.querySelector('.lark-doc-version-left-header')
  const pager = el.querySelector('.lark-doc-version-pager')
  const rightHeader = el.querySelector('.lark-doc-version-right-header')
  const rightIcon = rightHeader ? rightHeader.querySelector('.lark-doc-icon') : null
  const backIcon = el.querySelector('.lark-doc-version-back .lark-doc-icon')
  const size = (node) => {
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  }
  return {
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    ariaModal: el.getAttribute('aria-modal'),
    tabindex: el.getAttribute('tabindex'),
    rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
    css: { position: cs.position, zIndex: cs.zIndex, display: cs.display },
    columns: [...el.children].map((n) => n.className),
    leftHeaderChildren: leftHeader ? [...leftHeader.children].map((n) => n.className) : [],
    back: (() => {
      const btn = el.querySelector('.lark-doc-version-back')
      return btn ? { label: btn.getAttribute('aria-label'), type: btn.getAttribute('type'), iconSize: size(backIcon) } : null
    })(),
    restore: (() => {
      const btn = el.querySelector('.lark-doc-version-restore')
      if (!btn) return null
      return {
        text: btn.textContent.trim(),
        disabled: btn.disabled,
        title: btn.getAttribute('title'),
        type: btn.getAttribute('type'),
        bg: getComputedStyle(btn).backgroundColor,
        cursor: getComputedStyle(btn).cursor,
      }
    })(),
    pager: pager ? {
      cursor: pager.querySelector('.lark-doc-version-cursor') ? pager.querySelector('.lark-doc-version-cursor').textContent.trim() : null,
      steps: [...pager.querySelectorAll('.lark-doc-version-step')].map((b) => ({
        text: b.textContent.trim(),
        disabled: b.disabled,
        bg: getComputedStyle(b).backgroundColor,
      })),
    } : null,
    divider: !!el.querySelector('.lark-doc-version-header-divider'),
    empties: [...el.querySelectorAll('.lark-doc-version-empty')].map((p) => p.textContent.trim()),
    preview: (() => {
      const box = el.querySelector('.lark-doc-version-preview')
      if (!box) return null
      const meta = box.querySelector('.lark-doc-version-preview-meta')
      const diff = box.querySelector('.lark-doc-version-diff')
      return {
        title: box.querySelector('.lark-doc-version-preview-title') ? box.querySelector('.lark-doc-version-preview-title').textContent.trim() : null,
        kind: box.querySelector('.lark-doc-version-preview-kind') ? box.querySelector('.lark-doc-version-preview-kind').textContent.trim() : null,
        meta: meta ? [...meta.children].map((n) => n.textContent.trim().replace(/\s+/g, ' ')) : [],
        degraded: box.querySelector('.lark-doc-version-degraded') ? box.querySelector('.lark-doc-version-degraded').textContent.trim() : null,
        diff: diff ? {
          title: diff.querySelector('.lark-doc-version-diff-title') ? diff.querySelector('.lark-doc-version-diff-title').textContent.trim() : null,
          row: diff.querySelector('.lark-doc-version-diff-row') ? diff.querySelector('.lark-doc-version-diff-row').textContent.trim().replace(/\s+/g, ' ') : null,
        } : null,
        binary: [...box.querySelectorAll('.lark-doc-version-body .lark-doc-version-binary')].map((p) => p.textContent.trim().replace(/\s+/g, ' ')),
      }
    })(),
    rightTitle: rightHeader && rightHeader.querySelector('.lark-doc-version-right-title') ? rightHeader.querySelector('.lark-doc-version-right-title').textContent.trim() : null,
    rightIconSize: size(rightIcon),
    days: [...el.querySelectorAll('.lark-doc-version-day')].map((day) => ({
      label: day.querySelector('.lark-doc-version-day-label') ? day.querySelector('.lark-doc-version-day-label').textContent.trim() : null,
      items: [...day.querySelectorAll('.lark-doc-version-item')].map((item) => ({
        cls: item.className,
        name: item.querySelector('.lark-doc-version-item-name') ? item.querySelector('.lark-doc-version-item-name').textContent.trim() : null,
        desc: item.querySelector('.lark-doc-version-item-desc') ? item.querySelector('.lark-doc-version-item-desc').textContent.trim() : null,
        user: item.querySelector('.lark-doc-version-item-user') ? item.querySelector('.lark-doc-version-item-user').textContent.trim() : null,
      })),
    })),
    footer: el.querySelector('.lark-doc-version-right-footer') ? el.querySelector('.lark-doc-version-right-footer').textContent.trim() : null,
  }
}

/** 另存为版本 Dialog + toast。 */
const measureSaveDialog = () => {
  const mask = document.querySelector('.lark-doc-save-version-mask')
  const wrap = document.querySelector('.lark-doc-save-version-wrap')
  const dialog = document.querySelector('.lark-doc-save-version-dialog')
  const notice = document.querySelector('.lark-doc-version-notice')
  const rect = dialog ? dialog.getBoundingClientRect() : null
  const header = dialog ? dialog.querySelector('.lark-doc-save-version-header') : null
  const closeBtn = header ? header.querySelector('.lark-doc-save-version-close') : null
  const input = document.querySelector('#lark-doc-save-version-input')
  const size = (node) => {
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  }
  return {
    mask: !!mask,
    wrap: wrap ? {
      role: wrap.getAttribute('role'),
      ariaModal: wrap.getAttribute('aria-modal'),
      tabindex: wrap.getAttribute('tabindex'),
      ariaLabel: wrap.getAttribute('aria-label'),
    } : null,
    dialog: dialog ? {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      radius: getComputedStyle(dialog).borderTopLeftRadius,
      title: dialog.querySelector('.lark-doc-save-version-title') ? dialog.querySelector('.lark-doc-save-version-title').textContent.trim() : null,
      titleTag: dialog.querySelector('.lark-doc-save-version-title') ? dialog.querySelector('.lark-doc-save-version-title').tagName.toLowerCase() : null,
    } : null,
    close: closeBtn ? { label: closeBtn.getAttribute('aria-label'), type: closeBtn.getAttribute('type'), iconSize: size(closeBtn.querySelector('.lark-doc-icon')) } : null,
    label: (() => {
      const node = dialog ? dialog.querySelector('.lark-doc-save-version-label') : null
      return node ? { text: node.textContent.trim(), for: node.getAttribute('for'), tag: node.tagName.toLowerCase() } : null
    })(),
    input: input ? {
      type: input.getAttribute('type'),
      maxlength: input.getAttribute('maxlength'),
      placeholder: input.getAttribute('placeholder'),
      value: input.value,
      id: input.id,
    } : null,
    counter: dialog && dialog.querySelector('.lark-doc-save-version-counter') ? dialog.querySelector('.lark-doc-save-version-counter').textContent.trim() : null,
    footer: dialog ? [...dialog.querySelectorAll('.lark-doc-save-version-footer button')].map((b) => ({
      cls: b.className,
      text: b.textContent.trim(),
      type: b.getAttribute('type'),
      disabled: b.disabled,
      title: b.getAttribute('title'),
    })) : [],
    error: dialog && dialog.querySelector('.lark-doc-save-version-error') ? dialog.querySelector('.lark-doc-save-version-error').textContent.trim() : null,
    notice: notice ? {
      role: notice.getAttribute('role'),
      text: notice.tagName.toLowerCase() === 'div' && notice.firstChild ? notice.firstChild.textContent.trim() : notice.textContent.trim(),
      link: (() => {
        const a = notice.querySelector('.lark-doc-version-notice-link')
        return a ? { text: a.textContent.trim(), tag: a.tagName.toLowerCase() } : null
      })(),
    } : null,
  }
}

/** 模板库（宿主侧）整体快照。 */
const measureTemplateLibrary = () => {
  const root = document.querySelector('.lark-doc-template-library')
  if (!root) return null
  const cs = getComputedStyle(root)
  const search = root.querySelector('.lark-doc-template-search input')
  const tabs = [...root.querySelectorAll('.lark-doc-template-categories button')]
  const cards = [...root.querySelectorAll('.lark-doc-template-card')]
  const rect = root.getBoundingClientRect()
  return {
    role: root.getAttribute('role'),
    ariaModal: root.getAttribute('aria-modal'),
    ariaLabel: root.getAttribute('aria-label'),
    position: cs.position,
    rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
    mask: !!root.querySelector('.lark-doc-template-library-mask'),
    modal: !!root.querySelector('.lark-doc-template-library-modal'),
    target: (() => {
      const node = root.querySelector('.lark-doc-template-target')
      if (!node) return null
      return { text: node.textContent.trim().replace(/\s+/g, ' '), strongChild: !!node.querySelector('strong'), childTags: [...node.children].map((n) => n.tagName.toLowerCase()) }
    })(),
    search: search ? {
      type: search.getAttribute('type'),
      placeholder: search.getAttribute('placeholder'),
      ariaLabel: search.getAttribute('aria-label'),
      value: search.value,
    } : null,
    headerRight: (() => {
      const box = root.querySelector('.lark-doc-template-header-right')
      if (!box) return null
      const close = box.querySelector('.lark-doc-template-close')
      return {
        children: [...box.children].map((n) => n.className),
        type: box.querySelector('.lark-doc-template-type') ? box.querySelector('.lark-doc-template-type').textContent.trim() : null,
        close: close ? { text: close.textContent.trim(), label: close.getAttribute('aria-label'), type: close.getAttribute('type'), hasIcon: !!close.querySelector('.lark-doc-icon') } : null,
      }
    })(),
    tablist: (() => {
      const nav = root.querySelector('.lark-doc-template-categories')
      return nav ? { tag: nav.tagName.toLowerCase(), role: nav.getAttribute('role'), ariaLabel: nav.getAttribute('aria-label') } : null
    })(),
    tabs: tabs.map((tab) => ({
      role: tab.getAttribute('role'),
      selected: tab.getAttribute('aria-selected'),
      active: tab.classList.contains('is-active'),
      category: tab.getAttribute('data-category-id'),
      type: tab.getAttribute('type'),
      text: tab.textContent.trim(),
    })),
    grid: !!root.querySelector('.lark-doc-template-grid'),
    empty: root.querySelector('.lark-doc-template-empty') ? root.querySelector('.lark-doc-template-empty').textContent.trim() : null,
    cards: cards.map((card) => {
      const head = card.querySelector('.lark-doc-template-card-head')
      const foot = card.querySelector('.lark-doc-template-card-foot')
      const thumb = card.querySelector('.lark-doc-template-card-thumb img')
      return {
        tag: card.tagName.toLowerCase(),
        tabindex: card.getAttribute('tabindex'),
        id: card.getAttribute('data-template-id'),
        headChildren: head ? [...head.children].map((n) => n.className) : [],
        iconText: head && head.querySelector('.lark-doc-template-card-icon') ? head.querySelector('.lark-doc-template-card-icon').textContent.trim() : null,
        iconHidden: head && head.querySelector('.lark-doc-template-card-icon') ? head.querySelector('.lark-doc-template-card-icon').getAttribute('aria-hidden') : null,
        name: head && head.querySelector('.lark-doc-template-card-name') ? head.querySelector('.lark-doc-template-card-name').textContent.trim() : null,
        thumb: thumb ? { alt: thumb.getAttribute('alt'), loading: thumb.getAttribute('loading'), hasSrc: !!thumb.getAttribute('src') } : null,
        footChildren: foot ? [...foot.children].map((n) => n.className) : [],
        meta: foot && foot.querySelector('.lark-doc-template-card-meta') ? foot.querySelector('.lark-doc-template-card-meta').textContent.trim() : null,
        actions: foot ? [...foot.querySelectorAll('.lark-doc-template-card-actions button')].map((b) => ({ cls: b.className, text: b.textContent.trim(), type: b.getAttribute('type') })) : [],
      }
    }),
  }
}

/**
 * 注入内存评论 Provider（页面内自包含）。
 *
 * 契约见 `src/providers/comments.js`：必须有 `list / createThread / reply / resolve / reopen`
 * 五个方法，缺一个 `session.setProvider` 会直接抛。
 */
const installCommentsProvider = () => {
  const session = window.__larkDoc.getWorkspace().getSession()
  const store = { threads: [] }
  let seq = 0
  const now = Date.now()
  session.setProvider('comments', {
    list: async () => store.threads.slice(),
    createThread: async (input) => {
      seq += 1
      const thread = {
        id: `thread-${seq}`,
        blockId: input.blockId,
        anchor: input.anchor,
        quote: input.quote,
        resolved: false,
        createdAt: now,
        replies: [{ id: `reply-${seq}`, author: input.author, content: input.content, createdAt: now }],
      }
      store.threads.push(thread)
      return thread
    },
    reply: async (input) => {
      const thread = store.threads.find((item) => item.id === input.threadId)
      const reply = { id: `reply-${seq}-x`, author: input.author, content: input.content, createdAt: now }
      if (thread) thread.replies.push(reply)
      return reply
    },
    resolve: async (threadId) => {
      const thread = store.threads.find((item) => item.id === threadId)
      if (thread) thread.resolved = true
      return thread
    },
    reopen: async (threadId) => {
      const thread = store.threads.find((item) => item.id === threadId)
      if (thread) thread.resolved = false
      return thread
    },
  })
  return !!session.getProvider('comments')
}

/**
 * 注入内存 versioning Provider（页面内自包含）。
 *
 * 三条记录分两天：`v3`/`v2` 落在「今天」、`v1` 落在「昨天」，用于验证按天分组；
 * 块数 7 / 5 / 5 让 diff 同时出现「新增 2 个块」与「块数无变化」两种文案，
 * `v1` 是最早一条 → 描述固定为「最早一条记录，无更早版本可比」。
 */
const installVersioningProvider = () => {
  const session = window.__larkDoc.getWorkspace().getSession()
  const documentId = session && session.documentId ? session.documentId : ''
  const now = Date.now()
  const today = now - 60 * 1000
  const yesterday = now - 26 * 3600 * 1000
  const records = [
    { id: 'v3', documentId, label: '终稿', author: '张三', kind: 'manual', createdAt: today, blockCount: 7, sizeBytes: 1024, payload: new Uint8Array(1024) },
    { id: 'v2', documentId, label: '二稿', author: '', kind: 'auto', createdAt: today - 90 * 1000, blockCount: 5, sizeBytes: 900, payload: new Uint8Array(900) },
    { id: 'v1', documentId, label: '初稿', author: '李四', kind: 'restore', createdAt: yesterday, blockCount: 5, sizeBytes: 800, payload: new Uint8Array(800) },
  ]
  session.setProvider('versioning', {
    list: async () => records.map((item) => ({ ...item, payload: undefined })),
    get: async (versionId) => records.find((item) => item.id === versionId) || null,
    createSnapshot: async (input) => ({ ...input, id: 'v-new', payload: input.payload || new Uint8Array(16) }),
    restore: async (versionId) => records.find((item) => item.id === versionId) || null,
  })
  return !!session.getProvider('versioning')
}

// ────────────────────────── 页面操作 ──────────────────────────

/** 关掉所有浮层并重置文档。 */
async function resetTo(page, html) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 420)
  await page.waitForTimeout(180)
  await page.evaluate((content) => window.__larkDoc.setContent(content), html)
  await page.waitForTimeout(340)
}

const open = (page, selector) => page.evaluate((sel) => !!document.querySelector(sel), selector)

/**
 * 在页面里调 mixin 方法 / 改 data。
 *
 * 坑：`section.lark-doc` 上的 `__vue__` 不一定是 `LarkDocEditor`（`resetTo` 重挂之后可能指到
 * 外层 `LarkDocWorkspace`），直接 `vue.openVersionPanel()` 会 `is not a function`。
 * 所以从 `$root` 起把整棵组件树摊平，挑**带目标方法**的那个实例。
 */
const vueCall = (page, body) => page.evaluate((source) => {
  // eslint-disable-next-line no-new-func
  const fn = new Function('vue', 'sleep', `return (async () => { ${source} })()`)
  const anchor = document.querySelector('.lark-doc')
  if (!anchor || !anchor.__vue__) throw new Error('[vueCall] `.lark-doc` 上没有 Vue 实例')
  const seen = new Set()
  const flat = []
  const walk = (node) => {
    if (!node || seen.has(node)) return
    seen.add(node)
    flat.push(node)
    ;(node.$children || []).forEach(walk)
  }
  walk(anchor.__vue__.$root)
  const vue = flat.find((item) => typeof item.openVersionPanel === 'function') || flat[0]
  return fn(vue, (ms) => new Promise((resolve) => setTimeout(resolve, ms)))
}, body)

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })

  /* ═══════════════════ ① 目录侧栏 ═══════════════════ */

  await resetTo(page, HEADING_CONTENT)
  await page.waitForTimeout(240)
  const outline = await page.evaluate(measureOutline)

  record('[目录] 默认展开（宽视口）+ `aside[aria-label="文档目录"]`',
    !!outline && outline.tag === 'aside' && outline.ariaLabel === '文档目录',
    outline ? `${outline.tag}/${outline.ariaLabel}` : '没渲染')

  record('[目录] 210px 固定宽 / sticky / padding 26 12 30 18 / 纵向滚动',
    !!outline && outline.width === 210 && outline.position === 'sticky' &&
      outline.flexBasis === '210px' && outline.padding === '26px 12px 30px 18px' && outline.overflowY === 'auto',
    outline ? `${outline.width}px ${outline.position} ${outline.padding}` : '没渲染')

  record('[目录] 头部 = strong「目录」+ 关闭钮（icon 14×14）',
    !!outline && outline.headingStrong === '目录' && outline.closeLabel === '关闭目录' &&
      outline.closeType === 'button' && !!outline.closeIcon && outline.closeIcon.w === 14 && outline.closeIcon.h === 14 &&
      outline.closeIcon.svg === true,
    outline ? `${outline.headingStrong}/${outline.closeLabel}/${JSON.stringify(outline.closeIcon)}` : '没渲染')

  // 缩进：h1 → 0px、h2 → 10px、h3 → 20px，封顶 50。
  // 注意只统计**标题**：`HEADING_CONTENT` 里的两段 `<p>` 不产出目录条目，所以是 4 项不是 6 项。
  const paddings = outline ? outline.items.map((item) => item.paddingLeft) : []
  record('[目录] 条目缩进 = min(level-1,5)*10（h1 0 / h2 10 / h2 10 / h3 20）',
    JSON.stringify(paddings) === JSON.stringify(['0px', '10px', '10px', '20px']),
    paddings.join(','))

  const withToggle = outline ? outline.items[0] : null
  record('[目录] 有子节点 → 折叠钮带 aria-expanded / title / 8×12 三角',
    !!withToggle && !!withToggle.toggle && withToggle.toggle.expanded === 'true' &&
      withToggle.toggle.title === '收起目录' && withToggle.toggle.type === 'button' &&
      withToggle.toggle.label === '收起目录：第一章' &&
      !!withToggle.arrow && withToggle.arrow.ariaHidden === 'true' && withToggle.arrow.cls.indexOf('is-collapsed') === -1,
    withToggle ? JSON.stringify(withToggle.toggle) : '没渲染')

  const withoutToggle = outline ? outline.items[1] : null
  record('[目录] 无子节点 → `span.-toggle-placeholder[aria-hidden]`（不是空按钮）',
    !!withoutToggle && withoutToggle.toggle === null && !!withoutToggle.placeholder &&
      withoutToggle.placeholder.ariaHidden === 'true' &&
      withoutToggle.placeholder.cls.indexOf('lark-doc-outline-toggle-placeholder') !== -1,
    withoutToggle ? JSON.stringify(withoutToggle.placeholder) : '没渲染')

  record('[目录] 跳转钮：outlinePending=false 时无 title 属性',
    !!withToggle && !!withToggle.jump && withToggle.jump.text === '第一章' &&
      withToggle.jump.disabled === false && withToggle.jump.title === null && withToggle.jump.type === 'button',
    withToggle ? JSON.stringify(withToggle.jump) : '没渲染')

  // 折叠第一项：箭头转 is-collapsed、title 变「展开目录」、子项隐藏
  await vueCall(page, 'vue.toggleOutline(vue.outlineItems[0].pos); await sleep(260)')
  const collapsed = await page.evaluate(measureOutline)
  record('[目录] 折叠后 aria-expanded=false / title=展开目录 / 箭头 is-collapsed',
    !!collapsed && collapsed.items[0].toggle.expanded === 'false' &&
      collapsed.items[0].toggle.title === '展开目录' &&
      collapsed.items[0].arrow.cls.indexOf('is-collapsed') !== -1,
    collapsed ? JSON.stringify(collapsed.items[0].toggle) : '没渲染')

  record('[目录] 折叠真的从 DOM 里摘掉子项（不是 display:none）',
    !!collapsed && collapsed.items.length < (outline ? outline.items.length : 0),
    `折叠前 ${outline ? outline.items.length : '?'} 项 → 折叠后 ${collapsed ? collapsed.items.length : '?'} 项`)

  await vueCall(page, 'vue.toggleOutline(vue.outlineItems[0].pos); await sleep(260)')

  // pending 态：disabled + 提示文案
  await vueCall(page, 'vue.outlinePending = true; await sleep(240)')
  const pending = await page.evaluate(measureOutline)
  record('[目录] outlinePending=true → 跳转钮 disabled + title「正文还在载入，稍后可跳转」',
    !!pending && pending.items[0].jump.disabled === true &&
      pending.items[0].jump.title === '正文还在载入，稍后可跳转',
    pending ? JSON.stringify(pending.items[0].jump) : '没渲染')

  // active 态
  await vueCall(page, 'vue.outlinePending = false; vue.activeHeading = vue.outlineItems[0].pos; await sleep(240)')
  const activeState = await page.evaluate(measureOutline)
  record('[目录] activeHeading 命中 → 跳转钮带 `active`（折叠钮同时激活）',
    !!activeState && activeState.items[0].jump.active === true &&
      (activeState.items[0].toggle ? activeState.items[0].toggle.expanded === 'true' : false),
    activeState ? JSON.stringify(activeState.items[0].jump) : '没渲染')

  // 关闭 → reopen 兄弟钮 → 再开
  await page.evaluate(() => document.querySelector('.lark-doc-outline-heading button').click())
  await page.waitForTimeout(320)
  const reopen = await page.evaluate(() => {
    const button = document.querySelector('button.lark-doc-outline-reopen')
    if (!button) return null
    const cs = getComputedStyle(button)
    const rect = button.getBoundingClientRect()
    return {
      label: button.getAttribute('aria-label'),
      title: button.getAttribute('title'),
      text: button.textContent.trim(),
      position: cs.position,
      zIndex: cs.zIndex,
      size: { w: Math.round(rect.width), h: Math.round(rect.height) },
      aside: !!document.querySelector('.lark-doc-outline'),
    }
  })
  record('[目录] 关闭后侧栏真出 DOM，父级出现 ☰ 展开钮（fixed / z44 / 34×34）',
    !!reopen && reopen.aside === false && reopen.label === '展开目录' && reopen.title === '展开目录' &&
      reopen.text === '☰' && reopen.position === 'fixed' && reopen.zIndex === '44' &&
      reopen.size.w === 34 && reopen.size.h === 34,
    JSON.stringify(reopen))

  await page.evaluate(() => document.querySelector('button.lark-doc-outline-reopen').click())
  await page.waitForTimeout(320)
  record('[目录] 点展开钮侧栏回来', await open(page, '.lark-doc-outline'))

  // 工具栏「目录」项（`src/ui/toolbar.js:271`，收尾组第 2 个）：唯一从工具栏开合侧栏的入口，
  // 走 `toggleOutlineOpen()` 裸取反，没有 aria-pressed —— 状态只能从侧栏本体读。
  const outlineButton = await page.evaluate(() => {
    const node = document.querySelector('.lark-doc-toolbar button[aria-label="目录"]')
    if (!node) return null
    const icon = node.querySelector('.lark-doc-icon')
    const rect = node.getBoundingClientRect()
    return {
      title: node.getAttribute('title'),
      type: node.type,
      pressed: node.getAttribute('aria-pressed'),
      group: node.parentElement ? node.parentElement.className : '',
      size: { w: Math.round(rect.width), h: Math.round(rect.height) },
      icon: icon ? { w: Math.round(icon.getBoundingClientRect().width), h: Math.round(icon.getBoundingClientRect().height) } : null,
    }
  })
  record('[目录] 工具栏收尾组第 2 个 = 「目录」钮（icon 16×16，无 aria-pressed）',
    !!outlineButton && outlineButton.type === 'button' && outlineButton.title === '目录' &&
      outlineButton.pressed === null && outlineButton.group === 'lark-doc-tools-end-inner' &&
      !!outlineButton.icon && outlineButton.icon.w === 16 && outlineButton.icon.h === 16,
    JSON.stringify(outlineButton))

  await page.evaluate(() => document.querySelector('.lark-doc-toolbar button[aria-label="目录"]').click())
  await page.waitForTimeout(320)
  const closedByToolbar = await page.evaluate(() => ({
    aside: !!document.querySelector('.lark-doc-outline'),
    reopen: !!document.querySelector('button.lark-doc-outline-reopen'),
    still: !!document.querySelector('.lark-doc-toolbar button[aria-label="目录"]'),
  }))
  record('[目录] 点工具栏「目录」→ 侧栏真出 DOM，☰ 展开钮出现（钮本身留在工具栏）',
    closedByToolbar.aside === false && closedByToolbar.reopen === true && closedByToolbar.still === true,
    JSON.stringify(closedByToolbar))

  await page.evaluate(() => document.querySelector('.lark-doc-toolbar button[aria-label="目录"]').click())
  await page.waitForTimeout(320)
  const openedByToolbar = await page.evaluate(() => ({
    aside: !!document.querySelector('.lark-doc-outline'),
    reopen: !!document.querySelector('button.lark-doc-outline-reopen'),
  }))
  record('[目录] 再点一次工具栏「目录」→ 侧栏回来，☰ 展开钮同步摘掉',
    openedByToolbar.aside === true && openedByToolbar.reopen === false,
    JSON.stringify(openedByToolbar))

  // 空态
  await resetTo(page, '<p>只有正文没有标题</p>')
  const emptyOutline = await page.evaluate(measureOutline)
  record('[目录] 没有标题 → 空态文案「添加标题后自动生成目录」且零条目',
    !!emptyOutline && emptyOutline.emptyText === '添加标题后自动生成目录' && emptyOutline.items.length === 0,
    emptyOutline ? `${emptyOutline.emptyText}/${emptyOutline.items.length}` : '没渲染')

  /* ═══════════════════ ② 历史记录（无 provider 降级态） ═══════════════════ */

  await resetTo(page, HEADING_CONTENT)
  await vueCall(page, 'await vue.openVersionPanel(); await sleep(420)')
  const degraded = await page.evaluate(measureVersions)

  record('[版本] 打开后是 `role=dialog[aria-label="历史记录"][aria-modal][tabindex=-1]` 全屏层',
    !!degraded && degraded.role === 'dialog' && degraded.ariaLabel === '历史记录' &&
      degraded.ariaModal === 'true' && degraded.tabindex === '-1',
    degraded ? `${degraded.role}/${degraded.ariaLabel}` : '没渲染')

  record('[版本] fixed / z-index 99 / flex / 满屏 1440×900',
    !!degraded && degraded.css.position === 'fixed' && degraded.css.zIndex === '99' &&
      degraded.css.display === 'flex' && degraded.rect.w === 1440 && degraded.rect.h === 900,
    degraded ? `${degraded.css.position}/${degraded.css.zIndex}/${degraded.rect.w}x${degraded.rect.h}` : '没渲染')

  record('[版本] 两栏结构 = 左预览 + 右时间线',
    !!degraded && degraded.columns.length === 2 &&
      degraded.columns[0] === 'lark-doc-version-left' && degraded.columns[1] === 'lark-doc-version-right',
    degraded ? degraded.columns.join(',') : '没渲染')

  record('[版本] 左栏顶栏四段序 = 返回 / 还原 / 分页 / 分隔线',
    !!degraded && JSON.stringify(degraded.leftHeaderChildren) === JSON.stringify([
      'lark-doc-version-back', 'lark-doc-version-restore', 'lark-doc-version-pager', 'lark-doc-version-header-divider',
    ]),
    degraded ? degraded.leftHeaderChildren.join(',') : '没渲染')

  record('[版本] 返回钮 aria-label=返回文档 + undo 图标 24×24',
    !!degraded && degraded.back.label === '返回文档' && degraded.back.type === 'button' &&
      degraded.back.iconSize.w === 24 && degraded.back.iconSize.h === 24,
    degraded ? JSON.stringify(degraded.back) : '没渲染')

  record('[版本] 无 provider → 还原钮 disabled + title 说明 + 灰底 rgb(187,191,196)',
    !!degraded && degraded.restore.text === '还原此历史记录' && degraded.restore.disabled === true &&
      degraded.restore.title === '未配置 versioning Provider' &&
      degraded.restore.bg === 'rgb(187, 191, 196)' && degraded.restore.cursor === 'not-allowed',
    degraded ? JSON.stringify(degraded.restore) : '没渲染')

  record('[版本] 页码恒为「编辑记录 N/M」，无数据时 0/0 且两个翻页钮都禁用',
    !!degraded && degraded.pager.cursor === '编辑记录 0/0' &&
      degraded.pager.steps.length === 2 && degraded.pager.steps[0].text === '上一项' &&
      degraded.pager.steps[1].text === '下一项' &&
      degraded.pager.steps[0].disabled && degraded.pager.steps[1].disabled,
    degraded ? `${degraded.pager.cursor}/${degraded.pager.steps.map((s) => s.disabled).join(',')}` : '没渲染')

  record('[版本] 降级文案左右两栏同步出现（不是只在左栏）',
    !!degraded && degraded.empties.length === 2 &&
      degraded.empties[0] === '未配置 versioning Provider，历史记录不可用' &&
      degraded.empties[1] === degraded.empties[0] &&
      degraded.preview === null,
    degraded ? degraded.empties.join(' | ') : '没渲染')

  record('[版本] 右栏标题「历史记录」+ chevronDown 24 + 底栏「显示更改」',
    !!degraded && degraded.rightTitle === '历史记录' && degraded.rightIconSize.w === 24 &&
      degraded.rightIconSize.h === 24 && degraded.footer === '显示更改' && degraded.days.length === 0,
    degraded ? `${degraded.rightTitle}/${degraded.footer}` : '没渲染')

  // Esc 关不掉（与另存为 Dialog 相反）
  await page.keyboard.press('Escape')
  await page.waitForTimeout(240)
  record('[版本] `Esc` 关不掉（唯一出口是左栏返回钮）', await open(page, '.lark-doc-version-layer'))

  await page.evaluate(() => document.querySelector('.lark-doc-version-back').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  await page.waitForTimeout(320)
  record('[版本] 点「返回文档」关闭整层', !(await open(page, '.lark-doc-version-layer')))

  /* ═══════════════════ ③ 历史记录（注入 provider 后的完整分支） ═══════════════════ */

  const versioningReady = await page.evaluate(installVersioningProvider)
  record('[版本] 页面内注入 versioning Provider 成功', versioningReady === true)

  await vueCall(page, 'await vue.openVersionPanel(); await sleep(420)')
  const filled = await page.evaluate(measureVersions)

  record('[版本] 三条记录 → 按天分 2 组（今天 / 昨天），页码 编辑记录 1/3',
    !!filled && filled.days.length === 2 && filled.days[0].label === '今天' &&
      filled.days[0].items.length === 2 && filled.days[1].items.length === 1 &&
      filled.pager.cursor === '编辑记录 1/3',
    filled ? `${filled.days.map((d) => `${d.label}:${d.items.length}`).join(' ')} / ${filled.pager.cursor}` : '没渲染')

  record('[版本] 有数据 → 降级文案消失、还原钮可用、上一项禁用下一项可用',
    !!filled && filled.empties.length === 0 && filled.restore.disabled === false &&
      filled.pager.steps[0].disabled === true && filled.pager.steps[1].disabled === false,
    filled ? `empties=${filled.empties.length} restore=${filled.restore.disabled}` : '没渲染')

  record('[版本] 预览头 = 版本名 + 类型徽标（未 selectVersion 时回落「未命名版本」）',
    !!filled && !!filled.preview && filled.preview.title === '未命名版本' && filled.preview.kind === '手动保存',
    filled && filled.preview ? `${filled.preview.title}/${filled.preview.kind}` : '没渲染')

  // 没有 preview 载荷时只出前两项（时间 / 作者），后两项**真不进 DOM**——这是刻意的：
  // 没拿到 `get()` 结果就不许编字节数、也不许编块数（补 0 就是假数据）。
  record('[版本] 未 selectVersion → meta 只出「时间 / 作者」，字节数与块数**不进 DOM**',
    !!filled && !!filled.preview && filled.preview.meta.length === 2 &&
      /\d+月\d+日 \d{2}:\d{2}$/.test(filled.preview.meta[0]) &&
      filled.preview.meta[1] === '张三',
    filled && filled.preview ? filled.preview.meta.join(' | ') : '没渲染')

  record('[版本] 未 selectVersion → 正文段只说「没有可取回的正文」，不假装能渲染',
    !!filled && !!filled.preview && filled.preview.binary.length === 1 &&
      filled.preview.binary[0] === '该版本没有可取回的正文，只能查看元信息。',
    filled && filled.preview ? filled.preview.binary.join(' | ') : '没渲染')

  record('[版本] 时间线条目 = 名称 / 描述 / 作者三行，最新一条带 selected',
    !!filled && filled.days[0].items[0].cls.indexOf('selected') !== -1 &&
      /^\d+月\d+日 \d{2}:\d{2}$/.test(filled.days[0].items[0].name) &&
      filled.days[0].items[0].desc === '新增 2 个块' &&
      filled.days[0].items[0].user === '张三',
    filled ? JSON.stringify(filled.days[0].items[0]) : '没渲染')

  record('[版本] 最早一条的 desc = 「最早一条记录，无更早版本可比」',
    !!filled && filled.days[1].items[0].desc === '最早一条记录，无更早版本可比',
    filled ? filled.days[1].items[0].desc : '没渲染')

  record('[版本] 块数相同 → desc「块数无变化」，作者缺失回落「未知作者」',
    !!filled && filled.days[0].items[1].desc === '块数无变化' &&
      filled.days[0].items[1].user === '未知作者',
    filled ? JSON.stringify(filled.days[0].items[1]) : '没渲染')

  // 选中一条 → 预览换成真实的版本名与降级文案
  await page.evaluate(() => document.querySelectorAll('.lark-doc-version-item')[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  await page.waitForTimeout(400)
  const selected = await page.evaluate(measureVersions)
  record('[版本] 点时间线条目 → 预览头换成该版本名（终稿）且 selected 类跟着走',
    !!selected && !!selected.preview && selected.preview.title === '终稿' &&
      selected.days[0].items[0].cls.indexOf('selected') !== -1,
    selected && selected.preview ? selected.preview.title : '没渲染')

  // 选中后 `versionPreview` 才有值 → meta 补上后两项、diff 与二进制文案一起出现
  record('[版本] 有载荷 → meta 补满四项 = 时间 / 作者 / 二进制字节 / 块数',
    !!selected && !!selected.preview && selected.preview.meta.length === 4 &&
      /\d+月\d+日 \d{2}:\d{2}$/.test(selected.preview.meta[0]) &&
      selected.preview.meta[1] === '张三' &&
      selected.preview.meta[2] === '二进制快照 1024 字节' &&
      selected.preview.meta[3] === '7 个块',
    selected && selected.preview ? selected.preview.meta.join(' | ') : '没渲染')

  record('[版本] diff 段 = 标题 + `块数 5 → 7（+2）`（与更早一条比，不是与上一条比）',
    !!selected && !!selected.preview && !!selected.preview.diff &&
      selected.preview.diff.title === '与更早版本的差异' &&
      /^块数 5 → 7\s*（\+2）$/.test(selected.preview.diff.row),
    selected && selected.preview && selected.preview.diff ? JSON.stringify(selected.preview.diff.row) : '没渲染')

  record('[版本] 正文只有二进制快照 → 只说「需由协同运行时解码」，不假装能渲染',
    !!selected && !!selected.preview && selected.preview.binary.length === 1 &&
      /^该版本正文为二进制快照（1024 字节），需由协同运行时解码后才能渲染。$/.test(selected.preview.binary[0]),
    selected && selected.preview ? selected.preview.binary.join(' | ') : '没渲染')

  await page.evaluate(() => document.querySelector('.lark-doc-version-back').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  await page.waitForTimeout(300)

  /* ═══════════════════ ④ 评论面板 ═══════════════════ */

  await resetTo(page, '<p>甲乙丙丁戊己庚辛</p>')
  const commentsReady = await page.evaluate(installCommentsProvider)
  record('[评论] 页面内注入 comments Provider 成功', commentsReady === true)

  const threadCreated = await vueCall(page, `
    const editor = window.__larkDoc.getEditor()
    editor.chain().focus().setTextSelection({ from: 1, to: 5 }).run()
    await sleep(140)
    const thread = await vue.createCommentFromSelection('这里要改')
    await sleep(420)
    return thread ? thread.id : ''
  `)
  record('[评论] 划词建线程 → 线程与面板各一条', threadCreated === 'thread-1')

  const comments = await page.evaluate(measureComments)
  record('[评论] 容器 `-layer` 是 display:contents（不产生盒子）',
    !!comments.layer && comments.layerDisplay === 'contents')

  record('[评论] 每线程一张 270 宽 / radius 6 / fixed / z-index 1040 的 `role=dialog[aria-label="评论"]`',
    !!comments.panel && comments.role === 'dialog' && comments.ariaLabel === '评论' &&
      comments.rect.w === 270 && comments.css.position === 'fixed' &&
      comments.css.zIndex === '1040' && comments.css.radius === '6px',
    comments.panel ? `${comments.rect.w}/${comments.css.zIndex}/${comments.css.radius}` : '没渲染')

  record('[评论] 头部段序 = 引用 + 控件条',
    !!comments.panel && JSON.stringify(comments.headChildren) === JSON.stringify([
      'lark-doc-comment-quote', 'lark-doc-comment-controls',
    ]),
    comments.panel ? comments.headChildren.join(',') : '没渲染')

  record('[评论] 引用段显示原文（甲乙丙丁）', comments.panel && comments.quote === '甲乙丙丁', comments.quote)

  record('[评论] 控件条 6 格 = 5 个按钮 + 1 条 1×16 分隔（`aria-hidden`）',
    !!comments.panel && comments.cells.length === 6 &&
      comments.cells.filter((cell) => cell.childTag === 'button').length === 5 &&
      !!comments.split && comments.split.w === 1 && comments.split.h === 16 && comments.split.ariaHidden === 'true',
    comments.panel ? `${comments.cells.length} 格 / split=${JSON.stringify(comments.split)}` : '没渲染')

  record('[评论] 五个控件顺序与文案 = 下一条 / 上一条 / 复制锚点 / 解决评论 / 更多',
    !!comments.panel && JSON.stringify(comments.buttons.map((b) => b.label)) === JSON.stringify([
      '下一条评论', '上一条评论', '复制锚点', '解决评论', '更多',
    ]),
    comments.panel ? comments.buttons.map((b) => b.label).join(',') : '没渲染')

  record('[评论] 单条线程 → 前后翻都 is-disabled，解决钮 is-primary，更多钮画圆点不画图标',
    !!comments.panel && comments.buttons[0].cls.indexOf('is-disabled') !== -1 &&
      comments.buttons[1].cls.indexOf('is-disabled') !== -1 &&
      comments.buttons[3].cls.indexOf('is-primary') !== -1 &&
      comments.buttons[4].hasDots === true && comments.buttons[4].hasIcon === false &&
      comments.buttons[2].iconSize.w === 14 && comments.buttons[3].iconSize.w === 14,
    comments.panel ? comments.buttons.map((b) => b.cls).join(' | ') : '没渲染')

  record('[评论] 回复行 = 18×18 头像 + 名字 / 时间 / 正文',
    !!comments.panel && !!comments.reply && comments.reply.hasMain === true &&
      comments.reply.avatarSize.w === 18 && comments.reply.avatarSize.h === 18 &&
      comments.reply.name === '我' && !!comments.reply.time && comments.reply.body === '这里要改',
    comments.panel && comments.reply ? `${comments.reply.name}/${comments.reply.body}` : '没渲染')

  record('[评论] 回复行三颗控件 = 添加表情回复 / 引用回复 / 更多菜单',
    !!comments.panel && comments.reply.controls.length === 3 &&
      comments.reply.controls.map((b) => b.label).join(',') === '添加表情回复,引用回复,更多菜单',
    comments.panel && comments.reply ? comments.reply.controls.map((b) => b.label).join(',') : '没渲染')

  record('[评论] 无草稿 → 输入区高 58、无「取消 / 发送」',
    !!comments.panel && !!comments.textarea && comments.textarea.label === '回复' &&
      comments.textarea.readonly === false && comments.textarea.wrapHeight === 58 &&
      comments.actions === null,
    comments.panel && comments.textarea ? `h=${comments.textarea.wrapHeight} actions=${comments.actions}` : '没渲染')

  record('[评论] 插入图片钮 aria-label=插入图片 + 16×16 图标',
    !!comments.panel && !!comments.textarea && !!comments.textarea.operation &&
      comments.textarea.operation.label === '插入图片' && comments.textarea.operation.type === 'button' &&
      comments.textarea.operation.iconSize.w === 16,
    comments.panel && comments.textarea ? JSON.stringify(comments.textarea.operation) : '没渲染')

  // 回复行更多菜单：自己发的回复只出现三项（编辑 / 翻译 / 删除），「举报」只对别人的回复开放
  await vueCall(page, `
    const panel = vue.commentPanels[0]
    vue.toggleCommentReplyMenu(panel.id, panel.replies[0].id)
    await sleep(300)
  `)
  const replyMenu = await page.evaluate(measureComments)
  record('[评论] 回复行更多菜单三项 = 编辑 / 翻译为简体中文 / 删除（own 无举报）',
    !!replyMenu.panel && !!replyMenu.replyMenu &&
      JSON.stringify(replyMenu.replyMenu.items.map((item) => item.text)) === JSON.stringify([
        '编辑', '翻译为简体中文', '删除',
      ]),
    replyMenu.replyMenu ? replyMenu.replyMenu.items.map((item) => item.text).join(',') : '没渲染')

  record('[评论] 只有「翻译」带二级箭头（chevronDown 12）',
    !!replyMenu.replyMenu && replyMenu.replyMenu.items.filter((item) => item.arrows === 1).length === 1 &&
      replyMenu.replyMenu.items[1].arrows === 1,
    replyMenu.replyMenu ? replyMenu.replyMenu.items.map((item) => item.arrows).join(',') : '没渲染')

  await vueCall(page, 'vue.closeCommentMenus(); await sleep(240)')

  // 面板头「更多」→ 只有私有评论开关，没有删除 / 解决
  await vueCall(page, 'vue.toggleCommentMoreMenu(vue.commentPanels[0].id); await sleep(300)')
  const moreMenu = await page.evaluate(measureComments)
  record('[评论] 面板头「更多」= 图标 + 「私有评论」+ switch（aria-checked=false）',
    !!moreMenu.panel && !!moreMenu.moreMenu &&
      JSON.stringify(moreMenu.moreMenu.rowChildren) === JSON.stringify([
        'lark-doc-comment-more-icon', 'lark-doc-comment-more-title', 'lark-doc-comment-switch',
      ]) &&
      moreMenu.moreMenu.iconSize.w === 20 && moreMenu.moreMenu.title === '私有评论' &&
      moreMenu.moreMenu.switchRole.role === 'switch' && moreMenu.moreMenu.switchRole.checked === 'false' &&
      moreMenu.moreMenu.switchRole.handler === true,
    moreMenu.moreMenu ? JSON.stringify(moreMenu.moreMenu.rowChildren) : '没渲染')

  record('[评论] 「更多」里有开关**没有**删除 / 解决项（解决是头部独立按钮）',
    !!moreMenu.moreMenu && moreMenu.moreMenu.hint.indexOf('开启后，仅提及的协作者、文档所有者') === 0 &&
      (await page.evaluate(() => document.querySelectorAll('.lark-doc-comment-more-menu button').length)) === 1,
    moreMenu.moreMenu ? moreMenu.moreMenu.hint.slice(0, 16) + '…' : '没渲染')

  await vueCall(page, 'vue.closeCommentMenus(); await sleep(240)')

  // 草稿态：高度 156 → 238、textarea 58 → 98、取消/发送真进 DOM
  await vueCall(page, 'vue.setCommentDraft(vue.commentPanels[0].id, "补充一句"); await sleep(320)')
  const drafting = await page.evaluate(measureComments)
  record('[评论] 有草稿 → 面板高 238、输入区高 98、「取消 / 发送」真进 DOM',
    !!drafting.panel && drafting.rect.h === 238 && drafting.textarea.wrapHeight === 98 &&
      !!drafting.actions && drafting.actions.length === 2 &&
      drafting.actions[0].text === '取消' && drafting.actions[0].cls.indexOf('is-outlined') !== -1 &&
      drafting.actions[1].text === '发送' && drafting.actions[1].cls.indexOf('is-filled') !== -1,
    drafting.panel ? `h=${drafting.rect.h} textarea=${drafting.textarea.wrapHeight} actions=${JSON.stringify(drafting.actions)}` : '没渲染')

  await vueCall(page, 'vue.clearCommentDraft(vue.commentPanels[0].id); await sleep(300)')
  const cleared = await page.evaluate(measureComments)
  record('[评论] 清空草稿 → 行高回落 156，「取消 / 发送」真出 DOM',
    !!cleared.panel && cleared.rect.h === 156 && cleared.actions === null,
    cleared.panel ? `h=${cleared.rect.h} actions=${cleared.actions}` : '没渲染')

  /* ═══════════════════ ⑤ 另存为版本 Dialog + 恢复 toast ═══════════════════ */

  const opened = await vueCall(page, 'const ok = vue.openSaveVersionDialog(); await sleep(360); return ok')
  record('[版本弹窗] openSaveVersionDialog() 在 Provider 就绪后返回 true',
    opened === true, String(opened))

  const save = await page.evaluate(measureSaveDialog)
  record('[版本弹窗] 遮罩 + `role=dialog[aria-modal][tabindex=-1]` 外壳（aria-label 跟 h3 标题同值）',
    !!save.mask && !!save.wrap && save.wrap.role === 'dialog' && save.wrap.ariaModal === 'true' &&
      save.wrap.tabindex === '-1' && !!save.dialog &&
      save.wrap.ariaLabel === save.dialog.title &&
      /^保存 .+ 的文档版本$/.test(save.wrap.ariaLabel),
    save.wrap ? JSON.stringify(save.wrap) : '没渲染')

  record('[版本弹窗] 卡片 420 宽 / h3 标题 / 关闭钮 aria-label=关闭 + 20×20 图标',
    !!save.dialog && save.dialog.w === 420 && save.dialog.titleTag === 'h3' &&
      !!save.close && save.close.label === '关闭' && save.close.type === 'button' &&
      save.close.iconSize.w === 20,
    save.dialog ? `${save.dialog.w}px ${save.dialog.title}` : '没渲染')

  record('[版本弹窗] `label[for]` 指向输入框 id，输入框 maxlength=1000 / placeholder=请输入名称',
    !!save.label && save.label.tag === 'label' && save.label.text === '版本名称' &&
      save.label.for === 'lark-doc-save-version-input' &&
      !!save.input && save.input.id === 'lark-doc-save-version-input' &&
      save.input.type === 'text' && save.input.maxlength === '1000' &&
      save.input.placeholder === '请输入名称',
    save.input ? JSON.stringify(save.input) : '没渲染')

  record('[版本弹窗] 计数随输入**替换**而非追加（N/1000 与输入框同步）',
    /^\d+\/1000$/.test(String(save.counter)) &&
      String(save.counter).split('/')[0] === String(save.input ? save.input.value.length : -1),
    `counter=${save.counter} value=${save.input ? save.input.value : '?'}`)

  record('[版本弹窗] 底栏 = 取消（is-* 描边）+ 确定（:disabled 跟 versionCanCreate）',
    save.footer.length === 2 && save.footer[0].text === '取消' &&
      save.footer[0].cls.indexOf('lark-doc-save-version-cancel') !== -1 &&
      save.footer[1].text === '确定' && save.footer[1].disabled === false &&
      save.footer[1].title === '',
    save.footer.map((b) => `${b.text}:${b.disabled}`).join(','))

  record('[版本弹窗] 无错误时 `-error` 段不在 DOM 里',
    save.error === null, String(save.error))

  // 输入 → 计数更新；Esc 关闭（与历史记录面板相反）
  await page.evaluate(() => {
    const input = document.querySelector('#lark-doc-save-version-input')
    input.focus()
    input.value = '周报 第 3 版'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(300)
  const typed = await page.evaluate(measureSaveDialog)
  record('[版本弹窗] 输入 8 字 → 计数变 8/1000',
    typed.counter === '8/1000', String(typed.counter))

  // 点遮罩**不关**
  await page.mouse.click(20, 20)
  await page.waitForTimeout(320)
  record('[版本弹窗] 点遮罩**不关闭**（与常规弹窗口径不同）', await open(page, '.lark-doc-save-version-wrap'))

  await page.evaluate(() => document.querySelector('#lark-doc-save-version-input').focus())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(320)
  record('[版本弹窗] `Esc` 关闭（与历史记录面板正好相反）',
    !(await open(page, '.lark-doc-save-version-wrap')))

  // 恢复成功 toast
  await vueCall(page, 'vue.versionNotice = "已恢复为新版本，原版本仍保留在历史记录中"; await sleep(320)')
  const notice = await page.evaluate(measureSaveDialog)
  record('[版本弹窗] 恢复后 `role=status` toast + 「立即查看」链接',
    !!notice.notice && notice.notice.role === 'status' &&
      notice.notice.text === '已恢复为新版本，原版本仍保留在历史记录中' &&
      !!notice.notice.link && notice.notice.link.text === '立即查看' &&
      notice.notice.link.tag === 'button',
    notice.notice ? JSON.stringify(notice.notice) : '没渲染')

  await page.evaluate(() => document.querySelector('.lark-doc-version-notice-link').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  await page.waitForTimeout(420)
  const noticeClick = await page.evaluate(() => ({
    panel: !!document.querySelector('.lark-doc-version-layer'),
    notice: !!document.querySelector('.lark-doc-version-notice'),
  }))
  record('[版本弹窗] 点「立即查看」→ 开历史记录面板并收掉 toast',
    noticeClick.panel === true && noticeClick.notice === false,
    JSON.stringify(noticeClick))

  await page.evaluate(() => document.querySelector('.lark-doc-version-back').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  await page.waitForTimeout(300)

  /* ═══════════════════ ⑥ 模板库（宿主侧，独立路由） ═══════════════════ */

  const tplPage = await context.newPage()
  tplPage.on('pageerror', (error) => errors.push(error.message))
  await tplPage.goto(TEMPLATE_BASE, { waitUntil: 'networkidle' })
  await tplPage.waitForSelector('.lark-doc-template-library', { timeout: 30000 })

  const tpl = await tplPage.evaluate(measureTemplateLibrary)
  record('[模板库] `role=dialog[aria-modal][aria-label="模板库"]` + 遮罩 + 弹窗体',
    !!tpl && tpl.role === 'dialog' && tpl.ariaModal === 'true' &&
      tpl.ariaLabel === '模板库' && tpl.mask === true && tpl.modal === true,
    tpl ? `${tpl.role}/${tpl.ariaLabel}` : '没渲染')

  record('[模板库] 「新建到 <strong>目标</strong>」——目标值用 strong 强调',
    !!tpl && !!tpl.target && tpl.target.strongChild === true &&
      tpl.target.text === '新建到 我的文档库 / 产品',
    tpl && tpl.target ? tpl.target.text : '没渲染')

  record('[模板库] 搜索框 type=search / placeholder=搜索模板 / aria-label=搜索模板',
    !!tpl && !!tpl.search && tpl.search.type === 'search' &&
      tpl.search.placeholder === '搜索模板' && tpl.search.ariaLabel === '搜索模板',
    tpl ? JSON.stringify(tpl.search) : '没渲染')

  record('[模板库] 右侧 = 「所有类型」+ 关闭钮（文本 ×，不是图标）',
    !!tpl && !!tpl.headerRight && tpl.headerRight.type === '所有类型' &&
      !!tpl.headerRight.close && tpl.headerRight.close.text === '×' &&
      tpl.headerRight.close.label === '关闭模板库' && tpl.headerRight.close.hasIcon === false,
    tpl && tpl.headerRight ? JSON.stringify(tpl.headerRight.close) : '没渲染')

  record('[模板库] 左栏 `nav[role=tablist][aria-label=模板分类]`，31 个 tab',
    !!tpl && !!tpl.tablist && tpl.tablist.tag === 'nav' && tpl.tablist.role === 'tablist' &&
      tpl.tablist.ariaLabel === '模板分类' && tpl.tabs.length === 31,
    tpl ? `${tpl.tabs.length} 个 tab` : '没渲染')

  const activeTabs = tpl ? tpl.tabs.filter((tab) => tab.active) : []
  record('[模板库] 默认激活 `recommend`，且每个 tab 都有 role/aria-selected/data-category-id',
    activeTabs.length === 1 && activeTabs[0].category === 'recommend' &&
      activeTabs[0].selected === 'true' && activeTabs[0].role === 'tab' &&
      tpl.tabs.every((tab) => tab.role === 'tab' && tab.selected !== null && !!tab.category && tab.type === 'button'),
    activeTabs.length === 1 ? activeTabs[0].category : `${activeTabs.length} 个激活`)

  // 12 = 11 张打了 `recommend` + 1 张 `categories: []`（未打标签 → 每个分类都露出，见
  // `core/templates/library.js` 的 `templatesOf`：`tags.length === 0 || tags.indexOf(id) !== -1`）。
  record('[模板库] 推荐分类 12 张卡 = 11 张打了 recommend + 1 张未打标签，末卡 = no-category',
    !!tpl && tpl.grid === true && tpl.empty === null && tpl.cards.length === 12 &&
      tpl.cards[0].id === 'weekly-report' && tpl.cards[0].name === '团队周报' &&
      tpl.cards[11].id === 'no-category',
    tpl ? `${tpl.cards.length} 张 / ${tpl.cards[0] && tpl.cards[0].id} … ${tpl.cards[tpl.cards.length - 1] && tpl.cards[tpl.cards.length - 1].id}` : '没渲染')

  record('[模板库] 卡片 = article[tabindex=0] + 头(图标▤+名称) + 缩略图 + 底(元信息+两个动作)',
    !!tpl && tpl.cards[0].tag === 'article' && tpl.cards[0].tabindex === '0' &&
      JSON.stringify(tpl.cards[0].headChildren) === JSON.stringify([
        'lark-doc-template-card-icon', 'lark-doc-template-card-name',
      ]) &&
      tpl.cards[0].iconText === '▤' && tpl.cards[0].iconHidden === 'true' &&
      !!tpl.cards[0].thumb && tpl.cards[0].thumb.alt === '' &&
      tpl.cards[0].thumb.loading === 'lazy' && tpl.cards[0].thumb.hasSrc === true &&
      JSON.stringify(tpl.cards[0].footChildren) === JSON.stringify([
        'lark-doc-template-card-meta', 'lark-doc-template-card-actions',
      ]) &&
      tpl.cards[0].actions.map((b) => b.text).join(',') === '预览,使用',
    tpl ? JSON.stringify(tpl.cards[0]) : '没渲染')

  // 切分类：is-active 与 aria-selected 一起走，卡片数随之变化
  await tplPage.evaluate(() => document.querySelector('.lark-doc-template-categories button[data-category-id="office"]').click())
  await tplPage.waitForTimeout(300)
  const switched = await tplPage.evaluate(measureTemplateLibrary)
  record('[模板库] 切到「办公常用」→ is-active 与 aria-selected 一起移动，卡片变 3 张（2 office + 无标签）',
    !!switched && switched.tabs.filter((tab) => tab.active).length === 1 &&
      switched.tabs.find((tab) => tab.active).category === 'office' &&
      switched.tabs.find((tab) => tab.category === 'office').selected === 'true' &&
      switched.tabs.find((tab) => tab.category === 'recommend').selected === 'false' &&
      switched.cards.length === 3,
    switched ? `${switched.tabs.find((tab) => tab.active).category} / ${switched.cards.length} 张` : '没渲染')

  // 搜索：无结果 → 网格真出 DOM、空态真进 DOM
  await tplPage.evaluate(() => {
    const input = document.querySelector('.lark-doc-template-search input')
    input.value = 'zzz-不存在'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await tplPage.waitForTimeout(300)
  const noResult = await tplPage.evaluate(measureTemplateLibrary)
  record('[模板库] 无匹配 → `-grid` 真出 DOM、空态「没有匹配的模板」真进 DOM',
    !!noResult && noResult.grid === false && noResult.cards.length === 0 &&
      noResult.empty === '没有匹配的模板',
    noResult ? `grid=${noResult.grid} empty=${noResult.empty}` : '没渲染')

  await tplPage.evaluate(() => {
    const input = document.querySelector('.lark-doc-template-search input')
    input.value = '周报'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await tplPage.waitForTimeout(300)
  const searched = await tplPage.evaluate(measureTemplateLibrary)
  record('[模板库] 关键词命中 → 网格回来且只剩匹配卡（团队周报）',
    !!searched && searched.grid === true && searched.cards.length === 1 &&
      searched.cards[0].id === 'weekly-report',
    searched ? `${searched.cards.length} 张 / ${searched.cards[0] && searched.cards[0].id}` : '没渲染')

  // 预览：emit 到宿主，弹窗不关
  await tplPage.evaluate(() => document.querySelectorAll('.lark-doc-template-card')[0].querySelector('.lark-doc-template-preview').click())
  await tplPage.waitForTimeout(240)
  const previewEvent = await tplPage.evaluate(() => ({
    pre: document.querySelector('.tpl-demo__body pre').textContent,
    open: !!document.querySelector('.lark-doc-template-library'),
  }))
  record('[模板库] 点「预览」→ emit preview 到宿主且弹窗保持打开',
    /"event": "preview"/.test(previewEvent.pre) && /"id": "weekly-report"/.test(previewEvent.pre) &&
      previewEvent.open === true,
    previewEvent.pre.replace(/\s+/g, ' ').slice(0, 80))

  // 点遮罩关闭
  await tplPage.evaluate(() => document.querySelector('.lark-doc-template-library-mask').click())
  await tplPage.waitForTimeout(300)
  record('[模板库] 点遮罩 → emit close，弹窗真出 DOM',
    !(await open(tplPage, '.lark-doc-template-library')))

  // 重开 → 「使用」= emit use + 关闭
  await tplPage.evaluate(() => document.querySelector('.tpl-demo__open').click())
  await tplPage.waitForTimeout(320)
  await tplPage.evaluate(() => document.querySelectorAll('.lark-doc-template-card')[0].querySelector('.lark-doc-template-use').click())
  await tplPage.waitForTimeout(320)
  const useEvent = await tplPage.evaluate(() => ({
    pre: document.querySelector('.tpl-demo__body pre').textContent,
    open: !!document.querySelector('.lark-doc-template-library'),
  }))
  record('[模板库] 点「使用」→ emit use（交给宿主整篇复制）+ 弹窗关闭',
    /"event": "use"/.test(useEvent.pre) &&
      /"next": "server.createNodeCopy\(\)"/.test(useEvent.pre) && useEvent.open === false,
    useEvent.pre.replace(/\s+/g, ' ').slice(0, 90))

  record('无脚本错误', errors.length === 0, errors.join(' | '))

  const passed = results.filter((item) => item.ok).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
