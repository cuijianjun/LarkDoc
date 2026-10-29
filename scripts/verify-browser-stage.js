'use strict'
/**
 * 浏览器级验证：幻灯片演示舞台（`editor/PaperStage.vue`，阶段 5 批次 5 前半）。
 *
 * 批次 5 要把 `PaperStage.vue`（41 行）换成原生 DOM 片段（`src/ui/stage.js`）。
 * 这块小，但它是**唯一一个用 `v-if` 直接换掉整页正文**的组件，三条语义一旦漂移就会
 * 变成「演示态漏出编辑正文」或「退出演示后正文回不来」，属于一眼可见的回归：
 *   ① 开合是 **`v-if`（真进真出 DOM）**，不是 `v-show`；
 *   ② 舞台与 `.lark-doc-paper` 是**二选一**，同时只能有一个可见（paper 是 `v-show`，
 *      所以它始终在 DOM 里、只切 `display`）—— 两者用了两种不同的显隐手段，别统一；
 *   ③ 舞台不是浮层：它就是 `.lark-doc-main` 的**首个子元素**，撑开正文流；
 *      位置一旦被挪进 `<div ref="xHost">` 之类的容器，`min-height:70vh` 就撑不动了。
 *
 * 分章逻辑（`viewModesMixin.slideChapters`）也在断言范围内，因为它是舞台文案的唯一
 * 来源：只按 **H1** 分章（H2/H3 不算）；没有 H1 时整篇算 1 章、标题用文档名、正文用
 * 全文（不是空串）。
 *
 * 量法说明（以实测 + `lark-doc.css:723` 为准，viewport 1440×900）：
 * - `display:grid` / `align-content:center` / `gap:25px`；
 * - `min-height:70vh` → **630px**（不是定值，换 viewport 会变，断言按 ≥70vh 判）；
 * - `width:min(100%,1100px)` → **1100px**（1440 宽下有富余，取上界）；
 * - `padding:clamp(25px,8vw,100px)` → 8vw=115.2 → **100px**；
 * - 页码 `color:var(--lark-doc-green)` → **rgb(0, 184, 135)**。
 *
 * 依赖：demo dev server（`window.__larkDoc`）。用法：
 *   node scripts/verify-browser-stage.js [url]
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

/** 舞台整体快照。演示态才返回，非演示态返回 null —— 断言「真不在 DOM 里」就靠这个 null。 */
const measureStage = () => {
  const el = document.querySelector('.lark-doc-slide-stage')
  if (!el) return null
  const cs = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const main = document.querySelector('.lark-doc-main')
  const kids = [...el.children]
  const buttons = kids[3] ? [...kids[3].children] : []
  const counter = el.querySelector('.lark-doc-slide-counter')
  const body = kids[2] || null
  const h1 = el.querySelector('h1')
  const paper = document.querySelector('.lark-doc-paper')
  return {
    tag: el.tagName.toLowerCase(),
    classes: [...el.classList],
    ariaLabel: el.getAttribute('aria-label'),
    // 只留下「非 class、非 aria-label」的属性名，用来锁「不许悄悄挂 role / data-*」
    extraAttrs: [...el.attributes].map((a) => a.name).filter((name) => name !== 'class' && name !== 'aria-label'),
    childTags: kids.map((n) => n.tagName.toLowerCase()),
    childClasses: kids.map((n) => n.className),
    counterText: counter ? counter.textContent.trim() : null,
    counterColor: counter ? getComputedStyle(counter).color : null,
    heading: h1 ? h1.textContent.trim() : null,
    headingSize: h1 ? getComputedStyle(h1).fontSize : null,
    body: body ? body.textContent.trim() : null,
    bodyWhiteSpace: body ? getComputedStyle(body).whiteSpace : null,
    bodyLineHeight: body ? getComputedStyle(body).lineHeight : null,
    // 按钮组必须是裸 div（无 class / 无 role）
    buttonWrap: kids[3] ? { tag: kids[3].tagName.toLowerCase(), className: kids[3].className, role: kids[3].getAttribute('role') } : null,
    buttons: buttons.map((b) => ({
      tag: b.tagName.toLowerCase(),
      type: b.getAttribute('type'),
      text: b.textContent.trim(),
      disabled: b.disabled,
      disabledAttr: b.hasAttribute('disabled'),
    })),
    style: {
      display: cs.display,
      alignContent: cs.alignContent,
      gap: cs.gap,
      minHeight: Math.round(parseFloat(cs.minHeight)),
      width: Math.round(rect.width),
      paddingTop: Math.round(parseFloat(cs.paddingTop)),
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      marginLeft: Math.round(parseFloat(cs.marginLeft)),
      marginRight: Math.round(parseFloat(cs.marginRight)),
    },
    viewportHeight: window.innerHeight,
    // ③ 舞台是正文流的首个子元素
    isMainFirstChild: !!main && main.firstElementChild === el,
    // ② 二选一：演示态下纸张容器还在 DOM 里、但 display:none（v-show 语义）
    paperDisplay: paper ? getComputedStyle(paper).display : null,
    rootClasses: document.querySelector('.lark-doc') ? [...document.querySelector('.lark-doc').classList] : [],
  }
}

/** 纸张容器状态（非演示态用，含「舞台是否真的出 DOM」）。 */
const measurePaper = () => {
  const paper = document.querySelector('.lark-doc-paper')
  return {
    stageInDom: !!document.querySelector('.lark-doc-slide-stage'),
    paperInDom: !!paper,
    paperDisplay: paper ? getComputedStyle(paper).display : null,
    rootClasses: document.querySelector('.lark-doc') ? [...document.querySelector('.lark-doc').classList] : [],
  }
}

// —— 页面操作 ——

const setDoc = async (page, html) => {
  await page.evaluate((content) => {
    const editor = window.__larkDoc.getEditor()
    window.__larkDoc.setContent(content)
    editor.commands.focus('start')
    return true
  }, html)
  await page.waitForTimeout(360)
}

const enterSlides = async (page) => {
  await page.evaluate(() => document.querySelector('.lark-doc-toolbar button[aria-label="演示模式"]').click())
  await page.waitForTimeout(320)
}

const exitSlides = async (page) => {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.lark-doc-toolbar button')].find((b) => b.getAttribute('aria-label') === '退出演示')
    if (button) button.click()
  })
  await page.waitForTimeout(320)
}

const clickSlideButton = async (page, text) => {
  await page.evaluate((label) => {
    const stage = document.querySelector('.lark-doc-slide-stage')
    const button = [...stage.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
    button.click()
  }, text)
  await page.waitForTimeout(260)
}

const CHAPTERS = '<h1>第一章</h1><p>段一正文</p><h2>第一节</h2><p>不算一章</p><h1>第二章</h1><p>段二正文</p><h1>第三章</h1><p>段三正文</p>'

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  // 固定三章文档；H2 刻意夹在中间，验证分章只认 H1
  await setDoc(page, CHAPTERS)

  // ——————————————————— ① 开合语义（v-if vs v-show） ———————————————————
  const idle = await page.evaluate(measurePaper)
  record('[开合] 非演示态：舞台**不在 DOM 里**（v-if 语义，不是 display:none）',
    idle.stageInDom === false && idle.paperInDom === true && idle.paperDisplay !== 'none',
    `stage=${idle.stageInDom} paper=${idle.paperInDom}/${idle.paperDisplay}`)
  record('[开合] 非演示态：根部没有 `lark-doc-slides` 类',
    !idle.rootClasses.includes('lark-doc-slides'), idle.rootClasses.join(' '))

  await enterSlides(page)
  const snap = await page.evaluate(measureStage)
  record('[开合] 点工具栏「演示模式」→ 舞台真进 DOM，且是 `.lark-doc-main` 的**首个子元素**',
    !!snap && snap.isMainFirstChild === true,
    snap ? `first=${snap.isMainFirstChild}` : '没渲染')
  record('[开合] 演示态：纸张容器仍在 DOM 里但 `display:none`（v-show 语义，跟舞台的 v-if 相反）',
    !!snap && snap.paperDisplay === 'none',
    snap ? `paper=${snap.paperDisplay}` : '没渲染')
  record('[开合] 演示态：根部挂上 `lark-doc-slides`',
    !!snap && snap.rootClasses.includes('lark-doc-slides'), snap ? snap.rootClasses.join(' ') : '没渲染')

  // ——————————————————— ② 结构 ———————————————————
  record('[结构] 根是 div.lark-doc-slide-stage[aria-label=幻灯片演示]，无 role / 无 data-*',
    !!snap && snap.tag === 'div' && snap.classes.length === 1 && snap.classes[0] === 'lark-doc-slide-stage' &&
      snap.ariaLabel === '幻灯片演示' && snap.extraAttrs.length === 0,
    snap ? `${snap.tag}.${snap.classes.join('.')} extra=[${snap.extraAttrs.join(',')}]` : '没渲染')

  record('[结构] 四段子节点顺序 = 页码 p → h1 → 正文 p → 按钮组 div',
    !!snap && JSON.stringify(snap.childTags) === JSON.stringify(['p', 'h1', 'p', 'div']) &&
      snap.childClasses[0] === 'lark-doc-slide-counter' && snap.childClasses[1] === '' &&
      snap.childClasses[2] === '' && snap.childClasses[3] === '',
    snap ? snap.childTags.join(' > ') : '没渲染')

  record('[结构] 按钮组是**裸 div**（无 class / 无 role），三颗按钮都在它里面',
    !!snap && snap.buttonWrap && snap.buttonWrap.tag === 'div' &&
      snap.buttonWrap.className === '' && snap.buttonWrap.role === null && snap.buttons.length === 3,
    snap && snap.buttonWrap ? `${snap.buttonWrap.tag}[${snap.buttonWrap.className}] ${snap.buttons.length} 颗` : '没渲染')

  record('[结构] 三颗按钮 = button[type=button] × 3，文案「上一页 / 下一页 / 退出演示」',
    !!snap && snap.buttons.every((b) => b.tag === 'button' && b.type === 'button') &&
      snap.buttons.map((b) => b.text).join('|') === '上一页|下一页|退出演示',
    snap ? snap.buttons.map((b) => `${b.text}(${b.type})`).join(' / ') : '没渲染')

  // ——————————————————— ③ 版式（实测值） ———————————————————
  record('[版式] display:grid + align-content:center + gap:25px',
    !!snap && snap.style.display === 'grid' && snap.style.alignContent === 'center' && snap.style.gap === '25px',
    snap ? `${snap.style.display} / ${snap.style.alignContent} / ${snap.style.gap}` : '没渲染')

  record('[版式] min-height 是 `70vh`（viewport 900 → 630px），不是定值',
    !!snap && snap.style.minHeight === Math.round(snap.viewportHeight * 0.7),
    snap ? `${snap.style.minHeight}px (70vh of ${snap.viewportHeight})` : '没渲染')

  record('[版式] width = min(100%,1100px) → 1440 宽下取上界 1100px',
    !!snap && snap.style.width === 1100 && snap.style.width < 1440,
    snap ? `${snap.style.width}px` : '没渲染')

  record('[版式] padding = clamp(25px,8vw,100px) → 100px；左右 margin 相等（居中）',
    !!snap && snap.style.paddingTop === 100 && snap.style.marginLeft === snap.style.marginRight,
    snap ? `padding ${snap.style.paddingTop}px / margin ${snap.style.marginLeft} = ${snap.style.marginRight}` : '没渲染')

  record('[版式] 白底 + 纸张阴影',
    !!snap && snap.style.bg === 'rgb(255, 255, 255)' && /rgba?\([^)]*\)\s0px 8px 36px/.test(snap.style.shadow),
    snap ? `${snap.style.bg} / ${snap.style.shadow.slice(0, 42)}` : '没渲染')

  record('[版式] 页码色 = var(--lark-doc-green) → rgb(0, 184, 135)',
    !!snap && snap.counterColor === 'rgb(0, 184, 135)', snap ? snap.counterColor : '没渲染')

  record('[版式] h1 字号 = clamp(28px,5vw,54px) → 54px',
    !!snap && snap.headingSize === '54px', snap ? snap.headingSize : '没渲染')

  record('[版式] 正文 p 保留换行（white-space:pre-wrap）+ 行高 1.8（14×1.8=25.2px）',
    !!snap && snap.bodyWhiteSpace === 'pre-wrap' && snap.bodyLineHeight === '25.2px',
    snap ? `${snap.bodyWhiteSpace} / ${snap.bodyLineHeight}` : '没渲染')

  // ——————————————————— ④ 文案与分章 ———————————————————
  record('[分章] 页码文案是 `1 / 3`（空格分隔，不是 `1/3`）',
    !!snap && snap.counterText === '1 / 3', snap ? JSON.stringify(snap.counterText) : '没渲染')
  record('[分章] 只按 **H1** 分章：中间那个 H2 不算一章（3 章，不是 4 章）',
    !!snap && snap.counterText.split('/')[1].trim() === '3', snap ? snap.counterText : '没渲染')
    // 正文 p 的取值口径：`textBetween(本章 H1, 下个 H1)` 再去掉标题文本本身 —— 所以
  // **子标题（H2/H3）的文字会留在正文里**。这是 `slideChapters` 的现状行为，原生化
  // 不许顺手「修」掉，否则演示稿会和现在长得不一样。
  record('[分章] 首屏 h1 = 章节标题、正文 p = 该章正文（子标题文字留在正文里，现状口径）',
    !!snap && snap.heading === '第一章' && snap.body === '段一正文第一节不算一章',
    snap ? `${snap.heading} / ${JSON.stringify(snap.body)}` : '没渲染')

  // ——————————————————— ⑤ 翻页与阀门 ———————————————————
  record('[阀门] 首屏「上一页」disabled（属性真的在）、「下一页」enabled、「退出演示」enabled',
    !!snap && snap.buttons[0].disabled === true && snap.buttons[0].disabledAttr === true &&
      snap.buttons[1].disabled === false && snap.buttons[2].disabled === false,
    snap ? snap.buttons.map((b) => `${b.text}:${b.disabled}`).join(' ') : '没渲染')

  await clickSlideButton(page, '下一页')
  const second = await page.evaluate(measureStage)
  record('[翻页] 点「下一页」→ `2 / 3`，标题与正文同步到第二章',
    !!second && second.counterText === '2 / 3' && second.heading === '第二章' && second.body === '段二正文',
    second ? `${second.counterText} ${second.heading}/${second.body}` : '没渲染')
  record('[翻页] 第一章之后「上一页」解除禁用',
    !!second && second.buttons[0].disabled === false, second ? String(second.buttons[0].disabled) : '没渲染')

  await clickSlideButton(page, '上一页')
  const back = await page.evaluate(measureStage)
  record('[翻页] 点「上一页」→ 回到 `1 / 3`，「上一页」重新禁用',
    !!back && back.counterText === '1 / 3' && back.heading === '第一章' && back.buttons[0].disabled === true,
    back ? `${back.counterText} prev=${back.buttons[0].disabled}` : '没渲染')

  // 末页：下一页禁用、退出演示仍可用
  await clickSlideButton(page, '下一页')
  await clickSlideButton(page, '下一页')
  const last = await page.evaluate(measureStage)
  record('[阀门] 末页 `3 / 3`：「下一页」disabled，「退出演示」仍 enabled（不能把人锁在演示里）',
    !!last && last.counterText === '3 / 3' && last.buttons[1].disabled === true && last.buttons[1].disabledAttr === true &&
      last.buttons[2].disabled === false,
    last ? `${last.counterText} next=${last.buttons[1].disabled} exit=${last.buttons[2].disabled}` : '没渲染')

  // 键盘翻页（overlayDismissMixin: ArrowRight / ArrowLeft，且末页不越界）
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(240)
  const clamped = await page.evaluate(measureStage)
  record('[键盘] 末页按 → 不越界（仍 `3 / 3`）',
    !!clamped && clamped.counterText === '3 / 3', clamped ? clamped.counterText : '没渲染')

  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(240)
  const keyed = await page.evaluate(measureStage)
  record('[键盘] 按 ← 退一页 → `2 / 3`',
    !!keyed && keyed.counterText === '2 / 3' && keyed.heading === '第二章', keyed ? `${keyed.counterText} ${keyed.heading}` : '没渲染')

  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(240)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(240)
  const clampStart = await page.evaluate(measureStage)
  record('[键盘] 首页按 ← 不越界（仍 `1 / 3`）',
    !!clampStart && clampStart.counterText === '1 / 3', clampStart ? clampStart.counterText : '没渲染')

  // ——————————————————— ⑥ 退出 ———————————————————
  await clickSlideButton(page, '退出演示')
  const closed = await page.evaluate(measurePaper)
  record('[退出] 点「退出演示」→ 舞台真出 DOM、纸张容器恢复显示',
    closed.stageInDom === false && closed.paperDisplay !== 'none' && !closed.rootClasses.includes('lark-doc-slides'),
    `stage=${closed.stageInDom} paper=${closed.paperDisplay}`)

  // 重进 → Esc 退出（overlayDismissMixin 的 `slides` 分支）
  await enterSlides(page)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(320)
  const escaped = await page.evaluate(measurePaper)
  record('[退出] 演示态按 Esc → 同样真出 DOM（不残留 fixed 覆盖层）',
    escaped.stageInDom === false && escaped.paperDisplay !== 'none',
    `stage=${escaped.stageInDom} paper=${escaped.paperDisplay}`)

  // ——————————————————— ⑦ 无 H1 的兜底分章 ———————————————————
  await setDoc(page, '<p>只有正文，没有一级标题</p>')
  await enterSlides(page)
  const flat = await page.evaluate(measureStage)
  record('[兜底] 全文没有 H1 → 整篇算 1 章，页码 `1 / 1`，两个方向都禁用',
    !!flat && flat.counterText === '1 / 1' && flat.buttons[0].disabled === true && flat.buttons[1].disabled === true,
    flat ? `${flat.counterText} prev=${flat.buttons[0].disabled} next=${flat.buttons[1].disabled}` : '没渲染')
  record('[兜底] 兜底章的正文用**全文**（不是空串）',
    !!flat && flat.body && flat.body.length > 0 && flat.body.includes('只有正文'),
    flat ? JSON.stringify(flat.body) : '没渲染')
  await exitSlides(page)

  record('无脚本错误', errors.length === 0, errors.join(' | '))

  const passed = results.filter((item) => item.ok).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
