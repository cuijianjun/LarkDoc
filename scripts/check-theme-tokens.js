#!/usr/bin/env node
/**
 * check-theme-tokens — 主题 token 止血 lint（12 T0-05）。
 *
 * 扫 src/ 下 js / vue / css / scss，禁止新增：
 *   1. 字面 hex 颜色（#RGB/#RGBA/#RRGGBB/#RRGGBBAA）；
 *   2. `white` 颜色关键字（white-space / whitelisted 等由词边界排除，不算）。
 *
 * 规则（基线计数法）：现存违例按「文件 → 数量」记在 baseline 里放行，
 * 只卡新增 —— 文件内违例数超过基线、或基线外文件出现违例即失败。
 * 收编期每完成一批字面色 → var(--ld-*) 改写，用 `node scripts/check-theme-tokens.js --update`
 * 收紧基线（数量只会下降），保证指针只进不退。
 *
 * 白名单：vendor 目录（第三方源码不做要求）。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const srcDir = path.join(root, 'src')
const baselineFile = path.join(__dirname, 'theme-tokens-baseline.json')
const shouldUpdate = process.argv.includes('--update')

const EXTS = ['.js', '.vue', '.css', '.scss']
const WHITELIST_PARTS = [`${path.sep}vendor${path.sep}`]

// #RGB / #RGBA / #RRGGBB / #RRGGBBAA；后面跟字母数字的不算（如 #ifdef、URL 锚点后跟 / 或引号可命中，由白名单与人工复核兜底）。
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g
// 独立 white 关键字：前后都不能是字母数字下划线或连字符（排除 white-space、--lark-doc-white）。
const WHITE_RE = /(^|[^\w-])white(?![\w-])/g

function isWhitelisted(file) {
  return WHITELIST_PARTS.some((part) => file.includes(part))
}

function walk(dir, files) {
  fs.readdirSync(dir).forEach((name) => {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      walk(full, files)
      return
    }
    if (EXTS.indexOf(path.extname(name)) !== -1) files.push(full)
  })
  return files
}

/** 数一个文件的违例，返回 [{ line, snippet }]。 */
function countViolations(content) {
  const hits = []
  content.split('\n').forEach((line, index) => {
    if (HEX_RE.test(line) || WHITE_RE.test(line)) {
      hits.push({ line: index + 1, snippet: line.trim().slice(0, 120) })
    }
  })
  return hits
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
  } catch (error) {
    return {}
  }
}

const files = walk(srcDir, [])
const violations = {} // 相对路径 -> hits
files.forEach((file) => {
  if (isWhitelisted(file)) return
  const hits = countViolations(fs.readFileSync(file, 'utf8'))
  if (hits.length) violations[path.relative(root, file)] = hits
})

const baseline = readBaseline()

if (shouldUpdate) {
  const next = {}
  Object.keys(violations).sort().forEach((file) => { next[file] = violations[file].length })
  fs.writeFileSync(baselineFile, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`[check-theme-tokens] 基线已更新：${Object.keys(next).length} 个文件，共 ${Object.keys(next).reduce((sum, key) => sum + next[key], 0)} 处存量违例`)
  process.exit(0)
}

const failures = []
Object.keys(violations).forEach((file) => {
  const allowed = typeof baseline[file] === 'number' ? baseline[file] : 0
  const current = violations[file].length
  if (current > allowed) {
    // 新增的违例 = 超出基线的部分（按行号从后往前对齐不精确，报文件 + 全量行号供人工核对）。
    const lines = violations[file].map((hit) => `${file}:${hit.line}`).join('\n  ')
    failures.push(
      allowed === 0
        ? `[check-theme-tokens] 新文件出现字面色（基线外）：\n  ${lines}`
        : `[check-theme-tokens] ${file} 违例数 ${current} 超过基线 ${allowed}（新增部分请改用 var(--ld-*)）：\n  ${lines}`
    )
  }
})

if (failures.length) {
  console.error(failures.join('\n'))
  console.error(`\n[check-theme-tokens] 主题 token 止血失败：组件 CSS 禁止新增字面 hex / white 关键字（12 T0-05）。`)
  console.error(`[check-theme-tokens] 收编改写后如需收紧基线：node scripts/check-theme-tokens.js --update`)
  process.exit(1)
}

console.log(`[check-theme-tokens] 通过：${files.length} 个文件，存量违例 ${Object.keys(violations).reduce((sum, key) => sum + violations[key].length, 0)} 处（均在基线内），0 新增`)
