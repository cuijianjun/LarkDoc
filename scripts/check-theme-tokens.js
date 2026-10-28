#!/usr/bin/env node
/**
 * check-theme-tokens — 主题 token 止血 lint（12 T0-05）。
 *
 * 扫 src/ 下 js / vue / css / scss，禁止新增：
 *   1. 字面 hex 颜色（#RGB/#RGBA/#RRGGBB/#RRGGBBAA）；
 *   2. `white` 颜色关键字（white-space / whitelisted 等由词边界排除，不算）。
 *
 * 判定前会剥掉两类不可能承载 CSS 颜色的文本：块注释、http(s) URL（见 URL_RE 注释）。
 * 前者是文档说明，后者是 query / 锚点里的同名子串（如金数据 src 的 `background=white`）。
 *
 * 规则（基线计数法）：现存违例按「文件 → 数量」记在 baseline 里放行，
 * 只卡新增 —— 文件内违例数超过基线、或基线外文件出现违例即失败。
 * 收编期每完成一批字面色 → var(--ld-*) 改写，用 `node scripts/check-theme-tokens.js --update`
 * 收紧基线（数量只会下降），保证指针只进不退。
 *
 * 白名单：
 *   1. vendor 目录（第三方源码不做要求）；
 *   2. 色板常量表 `editor/palette.js` —— 全库唯一允许写字面 hex 的文件。
 *      色板值属「用户内容色」（写进文档 inline style，随文档走，不随主题变）
 *      与「多色图标资源」，不是 UI 皮肤色，收不进 CSS 变量（11 §V4 / 12 T0-05）。
 *   3. 语法配色表 `styles/code-block.css` —— 代码高亮的 hljs-* token 色，
 *      同为「内容色」：06 §6.5.2 实测换主题时代码 token 色两档不变，刻意写死。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const srcDir = path.join(root, 'src')
const baselineFile = path.join(__dirname, 'theme-tokens-baseline.json')
const shouldUpdate = process.argv.includes('--update')

const EXTS = ['.js', '.vue', '.css', '.scss']
const WHITELIST_PARTS = [`${path.sep}vendor${path.sep}`]
// 色板常量表：字面 hex 的唯一合法居所（见文件头白名单说明）。
const PALETTE_FILES = [`${path.sep}editor${path.sep}palette.js`]
// 语法配色表：代码高亮的 token 色（hljs-*）。与色板同理属「内容色」而非「UI 皮肤色」——
// 06 §6.5.2 实测「代码块是常暗卡片，换主题只动卡片 chrome 与卡底、token 色两档不变」，
// 因此刻意写死、不落 CSS 变量（落变量反而会让「换肤不换码色」的实测口径失效）。
const SYNTAX_FILES = [`${path.sep}styles${path.sep}code-block.css`]

// #RGB / #RGBA / #RRGGBB / #RRGGBBAA；后面跟字母数字的不算（如 #ifdef、URL 锚点后跟 / 或引号可命中，由白名单与人工复核兜底）。
// 注意：这里**不能带 g 标志**。带 g 的正则在 `RegExp.prototype.test` 上会读写 lastIndex，
// 而 lastIndex 是正则对象的持久状态、跨行复用 —— 于是「上一行命中后 lastIndex 停在中途，
// 下一行从半截开始扫」造成隔行漏报（实测 code-block.css 连续 5 行语法配色只报出 3 行）。
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/
// 独立 white 关键字：前后都不能是字母数字下划线或连字符（排除 white-space、--lark-doc-white）。
const WHITE_RE = /(^|[^\w-])white(?![\w-])/
// http(s) URL 整段（到空白或引号为止）。
// 规则只针对 CSS 颜色，而 URL 里不可能出现 CSS 颜色：query 参数和 `#` 锚点同样长成
// `white` / `#fff` 的样子，纯文本扫描分不出来。实例：金数据内嵌 src 的
// `?background=white&banner=show&...`（04 §4.3 ④.1 实测原值，必须原样保留）。
// 因此判定前先把 URL 剥掉，而不是给那个文件开白名单——开白名单会连它以后
// 真写的字面色一起放过。
const URL_RE = /https?:\/\/[^\s'"`]+/g

function isWhitelisted(file) {
  return (
    WHITELIST_PARTS.some((part) => file.includes(part)) ||
    PALETTE_FILES.some((part) => file.includes(part)) ||
    SYNTAX_FILES.some((part) => file.includes(part))
  )
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

/**
 * 去掉块注释（/* ... *\/），把注释内容替换成空格、保留换行，行号不漂移。
 * 注释里的 hex 只是文档说明（如「= --text-primary #1F2329」），不是着色处。
 */
function stripBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/** 数一个文件的违例，返回 [{ line, snippet }]。 */
function countViolations(rawContent) {
  const hits = []
  const content = stripBlockComments(rawContent)
  content.split('\n').forEach((line, index) => {
    // 自定义属性声明（--ld-text: #1F2329）是 token 的**定义处**，不是使用处：
    // 规则禁止的是组件里写字面色，token 声明本身必须允许写 hex，
    // 否则每加一个 token 都要放宽基线，基线就失去「只进不退」的意义。
    const checked = line
      .replace(/--[\w-]+\s*:\s*[^;{}]+/g, '')
      // URL 段先剥掉再判（见 URL_RE 注释）：query / 锚点里的 white、#fff 不是颜色。
      .replace(URL_RE, '')
    if (HEX_RE.test(checked) || WHITE_RE.test(checked)) {
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
