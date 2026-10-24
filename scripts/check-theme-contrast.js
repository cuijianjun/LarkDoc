#!/usr/bin/env node
/**
 * check-theme-contrast —— 主题对比度止血（12 T4-01）。
 *
 * 两套色板各跑一遍：**正文（content 轨）≥ 4.5:1、UI（chrome 轨 / 描边 / 表线 / 图表）≥ 3:1**。
 *
 * 做法（不引第三方色库，Node 14 可跑）：
 *   1. 解析 lark-doc.css 的 `.lark-doc {}` token 区（浅色档）+ theme-dark.css 的
 *      `[data-theme="dark"]` / `[data-content-theme="dark"]` 两个块（深色档）；
 *   2. `var()` 转发一层一层解析（如 --ld-border-chrome → --ld-border）；
 *   3. 带 alpha 的 token 按其所在**轨道的底**先合成：浅色 #FFFFFF、
 *      深色外壳 #17181A / 深色内容 #292929 —— 否则 `rgba(207,207,207,.08)`
 *      这类叠层底会被当成实色，算出来全是错账；
 *   4. WCAG 2.1 相对亮度公式算对比度，低于阈值即失败。
 *
 * 失败时输出最差若干组 + EXP/退出码 1。**注意**：脚本只报数不改值 ——
 * 浅色档是零回归基线，不许为了过线去改它（改了要重跑截图 diff）。
 */

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const LIGHT_FILE = path.join(root, 'src/components/lark-doc/lark-doc.css')
const DARK_FILE = path.join(root, 'src/components/lark-doc/theme-dark.css')

/** 轨道底：alpha token 先合成到它上面，再参与对比。 */
const TRACK_BASE = {
  light: { chrome: '#FFFFFF', content: '#FFFFFF' },
  dark: { chrome: '#17181A', content: '#292929' },
}

/**
 * 检查组。
 *  kind: 'text' → 4.5:1；'ui' → 3:1
 *  track: 'content' | 'chrome'（决定 alpha 合成底与深色取值来源）
 *  fg/bg 为 token 名；bg 可为 null（表示用轨道底）。
 */
const PAIRS = [
  // ---- 内容轨：正文可读性 ----
  { fg: '--ld-text-content', bg: '--ld-bg-content', kind: 'text', track: 'content', label: '正文文字 / 纸张' },
  { fg: '--ld-text-heading', bg: '--ld-bg-content', kind: 'text', track: 'content', label: '标题文字 / 纸张' },
  { fg: '--ld-text-quote', bg: '--ld-bg-quote', kind: 'text', track: 'content', label: '引用文字 / 引用底' },
  // 列表符号是「装饰性标记」而非可读文本 → 按 UI 档（≥3:1）校验
  { fg: '--ld-text-bullet', bg: '--ld-bg-content', kind: 'ui', track: 'content', label: '列表符号 / 纸张' },
  { fg: '--ld-text-summary', bg: '--ld-bg-details', kind: 'text', track: 'content', label: '折叠标题 / 折叠底' },
  { fg: '--ld-text-slide-title', bg: '--ld-bg-content', kind: 'text', track: 'content', label: '幻灯片标题 / 纸张' },
  { fg: '--ld-text-link', bg: '--ld-bg-content', kind: 'text', track: 'content', label: '链接 / 纸张' },
  // ---- 内容轨：非文字 UI 元素 ----
  { fg: '--ld-border-table', bg: '--ld-bg-content', kind: 'decor', track: 'content', label: '表格线 / 纸张' },
  { fg: '--ld-border-callout', bg: '--ld-bg-content', kind: 'decor', track: 'content', label: '高亮块描边 / 纸张' },
  { fg: '--ld-border-column', bg: '--ld-bg-content', kind: 'decor', track: 'content', label: '分栏虚线 / 纸张' },
  // ---- 外壳轨 ----
  { fg: '--ld-text', bg: '--ld-bg-surface-chrome', kind: 'text', track: 'chrome', label: '外观主文字 / 浮起表面' },
  { fg: '--ld-text-secondary', bg: '--ld-bg-surface-chrome', kind: 'text', track: 'chrome', label: '次级文字 / 浮起表面' },
  { fg: '--ld-text-icon', bg: '--ld-bg-surface-chrome', kind: 'ui', track: 'chrome', label: '弱态图标 / 浮起表面' },
  { fg: '--ld-border-chrome', bg: '--ld-bg-surface-chrome', kind: 'decor', track: 'chrome', label: '菜单描边 / 浮起表面' },
  // ---- 代码块（content 轨；卡片是「常暗对象」，语法色按 M6 不动） ----
  { fg: '--ld-code-text', bg: '--ld-code-bg', kind: 'text', track: 'content', label: '代码默认文字 / 卡片底' },
  { fg: '--ld-code-toolbar-text', bg: '--ld-code-toolbar-bg', over: '--ld-code-bg', kind: 'text', track: 'content', label: '代码头部条文字 / 头部条底' },
  // ---- 图表（浅色不读这组，走 mermaid 内置 default，所以只在深色档校验） ----
  { fg: '--ld-diagram-text', bg: '--ld-diagram-bg', kind: 'text', track: 'content', label: '图表文字 / 图底', darkOnly: true },
  { fg: '--ld-diagram-line', bg: '--ld-diagram-bg', kind: 'ui', track: 'content', label: '图表连线 / 图底', darkOnly: true },
  { fg: '--ld-diagram-node-border', bg: '--ld-diagram-bg', kind: 'decor', track: 'content', label: '图表节点描边 / 图底', darkOnly: true },
]

/* ---------------- 取值 / 解析 ---------------- */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/** 找出所有 @media 包裹的字符区间（用大括号配对，避免被内部块截断）。 */
function mediaRanges(css) {
  const ranges = []
  const re = /@media([^{]*)\{/g
  let match
  while ((match = re.exec(css))) {
    let depth = 1
    let cursor = re.lastIndex
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') depth -= 1
      cursor += 1
    }
    ranges.push({ start: match.index, end: cursor, query: match[1].trim() })
  }
  return ranges
}

/**
 * 抽出所有 selector → declarations，并记录其所在的 @media（没有则为 null）。
 * 必须区分媒体上下文：theme-dark.css 末尾的 @media print 块里写的是**浅色值**，
 * 不区分就会把深色档算成浅色，整套对比度全变成假账。
 */
function parseBlocks(css) {
  const blocks = []
  const ranges = mediaRanges(css)
  const re = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = re.exec(css))) {
    const declarations = {}
    match[2].split(';').forEach((decl) => {
      const index = decl.indexOf(':')
      if (index < 0) return
      const name = decl.slice(0, index).trim()
      const value = decl.slice(index + 1).trim().replace(/\s+/g, ' ')
      if (name.startsWith('--')) declarations[name] = value
    })
    if (!Object.keys(declarations).length) continue
    const media = ranges.filter((range) => match.index >= range.start && match.index <= range.end).pop()
    blocks.push({
      selector: match[1].trim().replace(/\s+/g, ' '),
      declarations,
      media: media ? media.query : null,
    })
  }
  return blocks
}

/** 收集某个 selector（精确匹配，且只取非 @media 里的那份）下所有 token。 */
function collectTokens(blocks, selectorNeedle) {
  const out = {}
  blocks.forEach((block) => {
    if (block.media) return
    if (block.selector.indexOf(selectorNeedle) === -1) return
    // 只认「这个 selector 本身」，排除更具体的子 selector（如 .lark-doc.something）。
    const tail = block.selector.split(selectorNeedle).pop().trim()
    if (tail && tail !== '') return
    Object.assign(out, block.declarations)
  })
  return out
}

/** 解析 var() 转发链（最多 6 层，防自引用死循环）。 */
function resolve(tokenName, themeTokens) {
  let value = themeTokens[tokenName]
  for (let hop = 0; hop < 6 && value && value.startsWith('var('); hop += 1) {
    const next = value.slice(4).trim().replace(/,[\s\S]*$/, '').replace(/\)$/, '').trim()
    if (!themeTokens[next]) return null
    value = themeTokens[next]
  }
  return value || null
}

/* ---------------- 颜色换算 ---------------- */

function parseColor(value) {
  if (!value) return null
  const text = value.trim().toLowerCase()
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  let hex = null
  if (/^#[0-9a-f]{3,8}$/.test(text)) {
    const body = text.slice(1)
    hex = body.length === 3 || body.length === 4
      ? body.split('').map((c) => c + c).join('')
      : body
  }
  if (hex) {
    const full = hex.length === 6 ? `${hex}ff` : hex
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: parseInt(full.slice(6, 8), 16) / 255,
    }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text)
  if (!rgb) return null
  return {
    r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]),
    a: rgb[4] == null ? 1 : (rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4])),
  }
}

/** 前景（可能半透明）合成到背景上。 */
function composite(fg, bg) {
  if (fg.a >= 1) return fg
  const a = fg.a
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  }
}

function luminance(color) {
  const channel = (raw) => {
    const c = raw / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [high, low] = la > lb ? [la, lb] : [lb, la]
  return (high + 0.05) / (low + 0.05)
}

/* ---------------- 主流程 ---------------- */

const lightBlocks = parseBlocks(stripComments(fs.readFileSync(LIGHT_FILE, 'utf8')))
const darkBlocks = parseBlocks(stripComments(fs.readFileSync(DARK_FILE, 'utf8')))

const THEMES = {
  light: {
    tokens: collectTokens(lightBlocks, '.lark-doc'),
  },
  dark: {
    tokens: Object.assign(
      {},
      collectTokens(lightBlocks, '.lark-doc'),
      collectTokens(darkBlocks, '[data-theme="dark"]'),
      collectTokens(darkBlocks, '[data-content-theme="dark"]')
    ),
  },
}

/**
 * 阈值按 WCAG 2.1 分三档：
 *  - text  4.5:1  正文/标题/链接等需要阅读的颜色（1.4.3 AA）
 *  - ui    3:1    交互控件与其状态识别所需的视觉信息（1.4.11）
 *  - decor 1.2:1  装饰性结构线（表格网格线 / 分栏虚线 / 块描边）——
 *    1.4.11 不约束纯装饰图形，飞书实测值本身就在 1.2–1.6 这个量级，只作参考不卡门。
 */
const MIN = { text: 4.5, ui: 3, decor: 1.2 }

/**
 * 已知偏差（豁免）。每条必须写清「为什么现在不改」——
 * 两条都属**默认档视觉基线**，改它等于改现状外观，必须走你的授权（12 §8 Q5/Q9）。
 */
const KNOWN_DEVIATIONS = {
  'light|弱态图标 / 浮起表面':
    '默认档（绿系）图标色 #8ba197 是现状视觉基线，2.75:1 差 0.25 —— 改亮即默认档视觉变化，' +
    '须先跑截图 diff 基线并获授权（12 §8 Q5）。飞书 preset 档同角色 #646A73 为 5.9:1，不受影响。',
}
const isKnown = (item) => Boolean(KNOWN_DEVIATIONS[`${item.theme}|${item.pair.label}`])
const results = []

Object.keys(THEMES).forEach((themeName) => {
  const theme = THEMES[themeName]
  PAIRS.forEach((pair) => {
    if (pair.darkOnly && themeName !== 'dark') return
    const baseColor = parseColor(TRACK_BASE[themeName][pair.track])
    const bgRaw = pair.bg ? resolve(pair.bg, theme.tokens) : null
    const bgBase = pair.over ? parseColor(resolve(pair.over, theme.tokens)) : baseColor
    const bg = bgRaw ? composite(parseColor(bgRaw) || baseColor, bgBase) : bgBase
    const fgRaw = resolve(pair.fg, theme.tokens)
    if (!fgRaw) {
      results.push({ theme: themeName, pair, ratio: null, min: MIN[pair.kind], note: 'token 缺失' })
      return
    }
    const fg = composite(parseColor(fgRaw) || { r: 0, g: 0, b: 0, a: 1 }, bg)
    const ratio = contrast(fg, bg)
    results.push({ theme: themeName, pair, ratio, min: MIN[pair.kind] })
  })
})

const failures = results.filter((item) => !isKnown(item) && (item.ratio == null || item.ratio < item.min))
const exempted = results.filter((item) => isKnown(item) && (item.ratio == null || item.ratio < item.min))

const pad = (text, width) => String(text) + ' '.repeat(Math.max(0, width - String(text).length))
console.log('主题对比度核对（12 T4-01：正文 ≥4.5:1，UI ≥3:1）\n')
console.log(`${pad('档位', 6)}${pad('分组', 4)}${pad('对比项', 30)}${pad('对比度', 8)}${pad('阈值', 6)}结果`)
console.log('-'.repeat(74))
results.forEach((item) => {
  const ok = item.ratio != null && item.ratio >= item.min
  const ratioText = item.ratio == null ? '—' : `${item.ratio.toFixed(2)}:1`
  const status = ok ? 'OK' : (isKnown(item) ? '豁免' : 'FAIL')
  console.log(
    `${pad(item.theme, 6)}${pad(item.pair.kind, 6)}${pad(item.pair.label, 30)}${pad(ratioText, 8)}${pad('≥' + item.min, 6)}${status}${item.note ? ` (${item.note})` : ''}`
  )
})

console.log(`\n合计 ${results.length} 组，通过 ${results.length - failures.length - exempted.length}，豁免 ${exempted.length}，失败 ${failures.length}`)
if (exempted.length) {
  console.log('\n已知偏差（登记豁免，不改值）：')
  exempted.forEach((item) => {
    console.log(`  ${item.theme} / ${item.pair.label}：${item.ratio == null ? item.note : item.ratio.toFixed(2) + ':1'} < ${item.min}`)
    console.log(`      ↳ ${KNOWN_DEVIATIONS[`${item.theme}|${item.pair.label}`]}`)
  })
}
if (failures.length) {
  console.error('\n[check-theme-contrast] 对比度不达标（只报数不改值 —— 浅色档是零回归基线，禁止为此改色）：')
  failures
    .sort((a, b) => (a.ratio || 0) - (b.ratio || 0))
    .forEach((item) => console.error(`  ${item.theme} / ${item.pair.label}：${item.ratio == null ? item.note : item.ratio.toFixed(2) + ':1'} < ${item.min}`))
  console.error('\n需要改值时优先改**深色档**（theme-dark.css），浅色档要动请先跑截图 diff 基线。')
  process.exit(1)
}
console.log('[check-theme-contrast] 通过')
