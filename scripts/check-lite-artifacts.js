'use strict'

/**
 * `lark-doc/lite` 的契约闸门。
 *
 * 阶段 4 对外承诺：lite 产物**不含** katex / docx / mammoth / marked / turndown /
 * highlight.js / mermaid 这些重依赖 —— 它们被 build-lite.js alias 成「求值即抛错」的
 * stub，宿主想要时再加载 `lark-doc/features/*` 恢复。
 *
 * 这个承诺已经**静默失效过两次**，两次都不是报错而是「没检查」：
 *   1. build-esm.js 与 build-lite.js 同为 `LARK_DOC_TARGET=esm`，共用同一个 webpack
 *      filesystem cache.name；webpack 命中 esm 链的解析结果，alias 整套被绕过 ——
 *      dist/lite.math.esm.js 与 dist/math.esm.js 逐字节相同（384,904 B）。
 *      修法：LARK_DOC_CACHE_FLAVOR=lite 拼进 cache.name（见 vue.config.js）。
 *   2. 修完之后 dist 里的旧产物没人删（`--no-clean` 是全仓约定）。区块集合随 stub
 *      化变化 —— markdown / highlight 两个区块因为整块塌成同一个 stub 被 office 区块
 *      吸收，不再单独落文件 —— 于是 `lite.markdown.esm.js`／`lite.highlight.esm.js`
 *      以「上一版的真依赖内容」继续躺在 dist 里，闸门读到的就是它们的旧内容。
 *      修法：build-lite.js 收尾时清掉自己命名空间里本轮没产出的文件。
 *
 * 所以闸门不能靠「某个区块的文件长什么样」来判断 —— 区块集合是会变的。判据改成
 * **重依赖指纹不许出现在任何 lite 产物里**（负向），并且每条指纹都要能在全量产物里
 * 找到（正向对照，否则指纹早就失效了、闸门却在假通过）。
 *
 * 用法：node scripts/check-lite-artifacts.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.resolve(ROOT, 'dist')

/** stub 化之后单个按需区块不该超过的体积（字节）。真 katex 是 384 KB、mermaid 是 3.3 MB。 */
const MAX_STUB_CHUNK_BYTES = 64 * 1024
const STUB_MARKER = 'lite 构建不含该可选依赖'
/**
 * 重依赖指纹。每个 token 是对应库内部的字符串（不是包名 —— 包名会出现在特性注册表的
 * 字符串里，比如 'office.mammoth'），全量产物里必然存在、lite 产物里必须不存在。
 */
const HEAVY_DEPS = [
  { name: 'katex', token: 'KaTeX', where: 'math.esm.js' },
  { name: 'docx', token: 'openxmlformats', where: 'office.esm.js' },
  { name: 'mammoth', token: 'zwobble.org', where: 'office.esm.js' },
  { name: 'mermaid', token: 'mermaidAPI', where: 'mermaid.esm.js' },
  { name: 'highlight.js', token: 'highlightBlock', where: 'highlight.esm.js' },
  { name: 'turndown', token: 'keepReplacement', where: 'markdown.esm.js' },
  // marked 静态可达（utils/export/markdown.js），所以它落在全量主包而不是 markdown 区块。
  { name: 'marked', token: 'extension level must be', where: 'lark-doc.esm.js' },
]

const LITE_MAIN = 'lark-doc-lite.esm.js'
const FULL_MAIN = 'lark-doc.esm.js'

const assertions = []
let failed = 0

function check(name, fn) {
  try {
    fn()
    assertions.push({ name, ok: true })
  } catch (error) {
    failed += 1
    assertions.push({ name, ok: false, message: error && error.message })
  }
}

function requireFile(file) {
  const abs = path.resolve(DIST, file)
  if (!fs.existsSync(abs)) {
    throw new Error(`缺少产物 ${file} —— 先跑 npm run build:esm && npm run build:lite`)
  }
  return abs
}

function readOf(file) {
  return fs.readFileSync(requireFile(file), 'utf8')
}

function sizeOf(file) {
  return fs.statSync(requireFile(file)).size
}

/** 全部 lite 产物：主文件 + 本轮构建产出的按需区块。 */
function liteArtifacts() {
  const files = fs.readdirSync(DIST)
  return [LITE_MAIN, ...files.filter((file) => /^lite\..+\.esm\.js$/.test(file)).sort()]
}

/** 全量 esm 产物：正向对照的搜索空间（排除所有 lite 文件）。 */
function fullArtifacts() {
  return fs.readdirSync(DIST)
    .filter((file) => file.endsWith('.esm.js'))
    .filter((file) => file !== LITE_MAIN && !file.startsWith('lite.'))
    .sort()
}

const liteFiles = liteArtifacts()
const liteSources = new Map(liteFiles.map((file) => [file, readOf(file)]))
const fullSources = new Map(fullArtifacts().map((file) => [file, readOf(file)]))

/* ---- 负向：任何 lite 产物里都不许出现重依赖指纹 ---- */
for (const dep of HEAVY_DEPS) {
  check(`lite 产物不含 ${dep.name}（指纹「${dep.token}」）`, () => {
    const hits = liteFiles.filter((file) => liteSources.get(file).includes(dep.token))
    if (hits.length) {
      throw new Error(`${hits.join('、')} 里命中了「${dep.token}」—— alias 没生效`)
    }
  })
}

/* ---- 正向对照：每条指纹在全量产物里必须找得到，否则指纹已失效、闸门在假通过 ---- */
for (const dep of HEAVY_DEPS) {
  check(`指纹有效：全量产物仍能找到 ${dep.name}`, () => {
    const hits = [...fullSources.entries()].filter(([, source]) => source.includes(dep.token)).map(([file]) => file)
    if (!hits.length) {
      throw new Error(`全量产物里找不到「${dep.token}」（预期在 ${dep.where}）—— 依赖换了版本或构建变了，请更新指纹`)
    }
  })
}

/* ---- 区块体积：存在的 lite 区块必须小到装不下真依赖 ---- */
for (const file of liteFiles.filter((name) => name.startsWith('lite.'))) {
  check(`${file} < ${MAX_STUB_CHUNK_BYTES / 1024} KB`, () => {
    const size = sizeOf(file)
    if (size > MAX_STUB_CHUNK_BYTES) throw new Error(`${size} B —— 重依赖被打了进去`)
  })
}

/* ---- stub 机制确实进了产物（否则上面的「不含」可能只是没跑到） ---- */
check('lite 产物含 stub 文案', () => {
  const hits = liteFiles.filter((file) => liteSources.get(file).includes(STUB_MARKER))
  if (!hits.length) throw new Error(`没找到「${STUB_MARKER}」—— stub 没进产物`)
})

/* ---- 主文件必须比全量小：stub 化后引用边更少 ---- */
check('lite 主产物小于全量 esm 主产物', () => {
  const lite = sizeOf(LITE_MAIN)
  const full = sizeOf(FULL_MAIN)
  if (lite >= full) throw new Error(`lite ${lite} B >= 全量 ${full} B —— stub 化应当让主文件更小`)
})

const total = assertions.length
if (failed) {
  console.error(`\n[lite 契约] ${failed}/${total} 项未通过\n`)
  for (const item of assertions) {
    if (item.ok) continue
    console.error(`  ✗ ${item.name}`)
    console.error(`    ${item.message}`)
  }
  console.error('\n修法：确认 scripts/build-lite.js 设置了 LARK_DOC_CACHE_FLAVOR=lite，')
  console.error('      再跑 npm run build:esm && npm run build:lite 重建。\n')
  process.exit(1)
}

console.log(`[lite 契约] ${total}/${total} 项通过 —— ${HEAVY_DEPS.length} 个重依赖全部 stub 化`)
for (const file of liteFiles) {
  console.log(`  ${file.padEnd(28)}${sizeOf(file)} B`)
}
