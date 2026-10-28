#!/usr/bin/env node
/**
 * 块契约生成器
 *
 * 目的：项目里「一个块长什么样」这件事目前有三份不完整的表达 ——
 *   ① requirements/02（散文 + 实测证据，单章最大 94 KB）
 *   ② src/core/blocks/*.js（真实实现，含 LIMITS / PATTERN / 默认值）
 *   ③ DEVELOPMENT.md（散落的样式数值）
 * agent 每次改块都要在 ① 里翻，这是上下文爆炸的主因。
 *
 * 本脚本以 ② 为真源，抽出机器可读契约，落到 _codex/contract/：
 *   contract/<block>.json   单块结构（节点名 / 属性 / 常量 / 证据锚点 / 源码）
 *   contract/INDEX.md       一屏总览（表格，~5 KB），查块先看这张
 *
 * 关键点：契约从代码生成，所以**永不漂移**；散文（02）降级为「人类备查的证据库」，
 * 代码注释里的 `02 §N` 锚点被自动收集成证据指针，需要时按锚点回查。
 *
 * 用法：
 *   node scripts/gen-contract.mjs           # 生成
 *   node scripts/gen-contract.mjs --check   # 只校验是否过期（CI / 提交前用）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC_DIR = path.join(ROOT, 'src/core/blocks')
const OUT_DIR = path.join(ROOT, '_codex', 'contract')

/* ---------- 轻量扫描工具：跳过字符串 / 模板 / 注释 / 正则，找配对括号 ---------- */

function skipToBalanced(src, openIdx) {
  const open = src[openIdx]
  const close = { '{': '}', '[': ']', '(': ')' }[open]
  if (!close) return -1
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i < 0) return -1; i++; continue }
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) break
        i++
      }
      continue
    }
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) return i }
  }
  return -1
}

/** 把对象字面量体按顶层逗号切开，返回 [{key, valueSrc, raw}] */
function splitTopLevel(body) {
  const parts = []
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < body.length) {
        if (body[i] === '\\') { i += 2; continue }
        if (body[i] === q) break
        i++
      }
      continue
    }
    if (c === '{' || c === '[' || c === '(') {
      const end = skipToBalanced(body, i)
      if (end < 0) break
      i = end
      continue
    }
    if (c === ',') {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts
    .map((p) =>
      p
        // 剥掉项首的注释（上一项逗号后残留的 `// 说明`），否则 key 正则匹配不到
        .replace(/^\s*(\/\/[^\n]*\n\s*)+/, '')
        .replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '')
        .trim()
    )
    .filter(Boolean)
}

const squash = (s) => s.replace(/\s+/g, ' ').trim()

/** 从 start 处取一个「值」，遇到顶层逗号 / 换行结束（跳过嵌套括号体） */
function readTopLevelValue(src, start) {
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) break
        i++
      }
      continue
    }
    if (c === '{' || c === '[' || c === '(') {
      const end = skipToBalanced(src, i)
      if (end < 0) break
      i = end
      continue
    }
    if (c === ',') return src.slice(start, i)
  }
  return src.slice(start)
}

/* ---------- 单文件解析 ---------- */

/** 取 `X.create({...})` / `X.extend({...})` 的配置对象体 */
function findNodeConfig(src) {
  const re = /(?:Node|Heading|Paragraph|Text|[A-Z][A-Za-z0-9_]*)\.create\(\{/g
  let m
  while ((m = re.exec(src))) {
    const braceIdx = m.index + m[0].length - 1
    const end = skipToBalanced(src, braceIdx)
    if (end < 0) continue
    const body = src.slice(braceIdx + 1, end)
    if (/\bname\s*:/.test(body)) return { body, start: braceIdx, end }
  }
  // extend(...) 没有 name，靠上下文文件名推断
  const ext = /([A-Za-z][A-Za-z0-9_]*)\.extend\(\{/
  const em = ext.exec(src)
  if (em) {
    const braceIdx = em.index + em[0].length - 1
    const end = skipToBalanced(src, braceIdx)
    if (end >= 0) return { body: src.slice(braceIdx + 1, end), start: braceIdx, end, extended: em[1] }
  }
  return null
}

/** 从配置体里取标量式顶层键 */
function readScalarKeys(body, keys) {
  const out = {}
  for (const key of keys) {
    const re = new RegExp(`(?:^|[,\\s{])${key}\\s*:\\s*([^,\\n}]+)`)
    const m = re.exec(body)
    if (m) out[key] = squash(m[1]).replace(/,$/, '')
  }
  return out
}

/** 取 addAttributes 的顶层属性名与 default。attrs 若定义在同目录 `*-attrs.js` 里，一并读 */
function readAttributes(src, dir, base) {
  const own = readAttrsFrom(src)
  if (own.length) return own
  const sibling = path.join(dir, `${base}-attrs.js`)
  if (fs.existsSync(sibling)) {
    const alt = readAttrsFrom(fs.readFileSync(sibling, 'utf8'))
    if (alt.length) return alt.map((a) => ({ ...a, from: path.basename(sibling) }))
  }
  return []
}

function readAttrsFrom(src) {
  // 两种写法都要认：`addAttributes(){...}` 与拆出去的 `function xxxAttributes(){...}`
  const anchors = []
  const at = src.indexOf('addAttributes')
  if (at >= 0) anchors.push(at)
  const fn = /function\s+\w*[Aa]ttributes\w*\s*\(/.exec(src)
  if (fn) anchors.push(fn.index)

  for (const anchor of anchors) {
    const braceIdx = src.indexOf('{', anchor)
    if (braceIdx < 0) continue
    const attrBodyEnd = skipToBalanced(src, braceIdx)
    if (attrBodyEnd < 0) continue
    const attrBody = src.slice(braceIdx + 1, attrBodyEnd)

    const retIdx = attrBody.indexOf('return')
    if (retIdx < 0) continue
    const objOpen = attrBody.indexOf('{', retIdx)
    if (objOpen < 0) continue
    const objEnd = skipToBalanced(attrBody, objOpen)
    if (objEnd < 0) continue
    const objBody = attrBody.slice(objOpen + 1, objEnd)

    const attrs = []
    for (const item of splitTopLevel(objBody)) {
      const m = /^['"]?([A-Za-z_$][\w$]*)['"]?\s*:/.exec(item)
      if (!m) continue
      const name = m[1]
      // value 里找 default：取到该 attr 的顶层逗号为止（跳过嵌套体）
      const defm = /\bdefault\s*:\s*/.exec(item)
      let def = null
      if (defm) {
        def = squash(readTopLevelValue(item, defm.index + defm[0].length))
        if (def.length > 60) def = def.slice(0, 57) + '...'
      }
      attrs.push({ name, default: def === 'null' ? null : def })
    }
    if (attrs.length) return attrs
  }
  return []
}

/** parseHTML 里出现的 tag 选择器 */
function readTags(src) {
  const tags = new Set()
  const re = /tag\s*:\s*(['"`])(.*?)\1/g
  let m
  while ((m = re.exec(src))) tags.add(m[2])
  // 形如 `h${level}` 的模板：记为 h1..h6 提示
  if (/`h\$\{level\}`/.test(src) || /level <= 6 \? `h\$/.test(src)) tags.add('h1..h6 / div[data-type="heading"][data-level]')
  return [...tags]
}

/** renderHTML 里写出的 data-* 属性 */
function readDataAttrs(src) {
  const out = new Set()
  const re = /'(data-[a-z-]+)'\s*:\s*(['"`]?)([^,}]*)\2/g
  let m
  while ((m = re.exec(src))) out.add(`${m[1]}=${squash(m[3]) || '…'}`)
  return [...out]
}

/** 模块级大写常量（内联 ≤ 220 字符的字面量，否则只记名字） */
function readConstants(src) {
  const out = []
  const re = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*=\s*/gm
  let m
  while ((m = re.exec(src))) {
    const name = m[1]
    const valStart = m.index + m[0].length
    // 取到行尾，或以 { [ ( 开始的平衡体
    let valSrc
    const first = src[valStart]
    if (first === '{' || first === '[') {
      const end = skipToBalanced(src, valStart)
      if (end < 0) continue
      valSrc = src.slice(valStart, end + 1)
    } else {
      const nl = src.indexOf('\n', valStart)
      valSrc = src.slice(valStart, nl < 0 ? undefined : nl)
    }
    valSrc = squash(valSrc)
    const isNumeric = /\d/.test(valSrc)
    out.push({
      name,
      value: valSrc.length <= 220 ? valSrc : `（见源码，${valSrc.length} 字符）`,
      numeric: isNumeric,
    })
  }
  return out
}

/** 导出符号（函数名 / 非大写常量名），帮助判断有哪些 query 入口 */
function readExports(src) {
  const out = new Set()
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g
  let m
  while ((m = re.exec(src))) out.add(m[1])
  const blockRe = /export\s*\{([\s\S]*?)\}/g
  while ((m = blockRe.exec(src))) {
    for (const piece of m[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name)
    }
  }
  return [...out]
}

/** 注释里的 `02 §N` 证据锚点。02 只有 0–30 章，N>30 记为行号（源码里两种写法混用） */
function readAnchors(src) {
  const out = new Set()
  const re = /0?2\s*§\s*(\d+(?:\.\d+)*)/g
  let m
  while ((m = re.exec(src))) out.add(m[1])
  return [...out].sort((a, b) => parseFloat(a) - parseFloat(b))
}

/** 首行 JSDoc 摘要 */
function readSummary(src) {
  const m = /^\s*\/\*\*?\s*\n?\s*\*?\s*(.+)/.exec(src)
  return m ? squash(m[1].replace(/\*\/\s*$/, '')) : ''
}

/* ---------- 汇总 ---------- */

function collectBlockFiles() {
  if (!fs.existsSync(SRC_DIR)) return []
  return fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(SRC_DIR, f))
}

function parseBlockFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  const base = path.basename(file, '.js')
  const cfg = findNodeConfig(src)
  const nameMatch = cfg && /\bname\s*:\s*['"`]([\w-]+)['"`]/.exec(cfg.body)
  // `X.extend({...})` 没有 name，按被扩展的基类名推断（Heading → heading）
  const nodeName = nameMatch
    ? nameMatch[1]
    : cfg && cfg.extended
      ? cfg.extended.toLowerCase()
      : null

  const scalars = cfg ? readScalarKeys(cfg.body, ['name', 'group', 'content', 'inline', 'atom', 'marks', 'defining', 'isolating', 'draggable', 'selectable', 'code', 'topNode']) : {}
  const attrs = readAttributes(src, path.dirname(file), base)
  const constants = readConstants(src)
  const anchors = readAnchors(src)

  return {
    block: nodeName || base,
    source: path.relative(ROOT, file),
    summary: readSummary(src),
    node: nodeName,
    extended: cfg && cfg.extended ? cfg.extended : null,
    schema: Object.fromEntries(
      Object.entries(scalars)
        .filter(([k]) => k !== 'name')
        .map(([k, v]) => [k, v.replace(/^['"`]|['"`]$/g, '')])
    ),
    attrs,
    html: { tags: readTags(src), dataAttrs: readDataAttrs(src) },
    constants,
    evidence: anchors.map((a) => (parseFloat(a) <= 30 ? `requirements/02#§${a}` : `requirements/02#L${a}`)),
    exports: readExports(src).filter((n) => !/^[A-Z][A-Z0-9_]+$/.test(n)),
  }
}

function buildIndex(blocks) {
  const lines = []
  lines.push('# 块契约索引（自动生成，勿手改）')
  lines.push('')
  lines.push('> 源：`src/core/blocks/*.js`（代码是真源）。重新生成：`node scripts/gen-contract.mjs`')
  lines.push('> 读法：**改某个块前先看这一行**；需要默认值/常量全文时再读 `contract/<块名>.json`；')
  lines.push('> 想追飞书实证证据，按「证据」列的锚点回查 `requirements/02`。')
  lines.push('')
  lines.push(`共 ${blocks.length} 个块 / 节点。`)
  lines.push('')
  lines.push('| 块 | attrs（* = 有默认值） | 关键数值常量 | 证据 | 源码 |')
  lines.push('| --- | --- | --- | --- | --- |')

  // 只有真正定义节点（或有独立属性层）的进主表；渲染层/工具文件放最后的附注行，
  // 免得 agent 把 `document-key` 当成一个块去找。
  const isBlockRow = (b) => (b.node && !/-(attrs|render)$/.test(b.block)) || (b.attrs.length && !/-(attrs|render)$/.test(b.block))
  const blockRows = blocks.filter(isBlockRow)
  const utilityFiles = blocks.filter((b) => !isBlockRow(b)).map((b) => b.block)

  const row = (b) => {
    const attrs = b.attrs.map((a) => (a.default !== null && a.default !== undefined ? `${a.name}*` : a.name)).join(' ')
    const nums = b.constants
      .filter((c) => c.numeric && /(HEIGHT|SIZE|WIDTH|LIMIT|MAX|MIN|PATTERN|VERSION|DEFAULT|OFFSET)/.test(c.name))
      .slice(0, 5)
      .map((c) => `${c.name.replace(/^[A-Z_]+?_/, '')}=${c.value}`)
      .join('; ')
    const ev = b.evidence.length
      ? b.evidence.map((e) => e.replace('requirements/02#', '')).join(' ')
      : '—'
    const src = '`' + b.source.replace('src/core/blocks/', '') + '`'
    const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s || '—')
    // 定义了 ProseMirror 节点的用块名，纯渲染/工具文件前缀 ~ 以示区别
    const label = b.node ? `\`${b.block}\`` : `~\`${b.block}\``
    return `| ${label} | ${short(attrs, 46)} | ${short(nums, 52)} | ${ev} | ${src} |`
  }

  for (const b of blockRows) lines.push(row(b))
  lines.push('')
  if (utilityFiles.length) {
    lines.push('同目录另有渲染层 / 工具文件（**不是块**，按需查）：')
    lines.push('')
    lines.push(utilityFiles.map((f) => '`' + f + '`').join('、'))
    lines.push('')
  }
  return lines.join('\n')
}

/* ---------- main ---------- */

function main() {
  const checkOnly = process.argv.includes('--check')
  const files = collectBlockFiles()
  // 全部收录：解析不全的块也要出现在索引里（宁可标 `?`，也不能让 agent 以为它不存在）
  const blocks = files.map(parseBlockFile)
  blocks.sort((a, b) => a.block.localeCompare(b.block))

  const index = buildIndex(blocks)
  const outputs = new Map()
  outputs.set(path.join(OUT_DIR, 'INDEX.md'), index)
  for (const b of blocks) {
    outputs.set(path.join(OUT_DIR, `${b.block}.json`), JSON.stringify(b, null, 2) + '\n')
  }

  if (checkOnly) {
    // 全新 clone 里 _codex/ 还没生成过（整个目录被 .gitignore 覆盖）：
    // 没有产物就谈不上「过期」，直接放行，否则 CI 会误红。
    if (!fs.existsSync(OUT_DIR)) {
      console.log('· 契约尚未生成，跳过过期检查（需要时跑 node scripts/gen-contract.mjs）')
      return
    }
    const stale = []
    for (const [file, content] of outputs) {
      const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
      if (cur !== content) stale.push(path.relative(ROOT, file))
    }
    if (stale.length) {
      console.error(`✗ 契约已过期（${stale.length} 个文件需重新生成）：`)
      for (const s of stale.slice(0, 10)) console.error('  - ' + s)
      console.error('\n  修复：node scripts/gen-contract.mjs')
      process.exit(1)
    }
    console.log(`✓ 契约是最新的（${blocks.length} 个块）`)
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  let bytes = 0
  for (const [file, content] of outputs) {
    fs.writeFileSync(file, content)
    bytes += Buffer.byteLength(content, 'utf8')
  }
  console.log(`✓ 生成 ${blocks.length} 个块契约 → ${path.relative(ROOT, OUT_DIR)}/（${(bytes / 1024).toFixed(1)} KB）`)
  console.log(`  INDEX.md ${(Buffer.byteLength(index, 'utf8') / 1024).toFixed(1)} KB ≈ ${Math.round(Buffer.byteLength(index, 'utf8') / 3)} token`)
}

main()
