#!/usr/bin/env node
/**
 * 把构建产物同步到在线 Demo 的静态 vendor 目录。
 *
 *   node scripts/demo-sync-vendor.mjs          # dist/ → docs/public/demo/vendor/
 *   node scripts/demo-sync-vendor.mjs --check  # 只校验，不一致退出码 1
 *
 * 为什么必须拷「全部」分块，而不是只拷主文件：
 *   两个 UMD 产物都带 `__webpack_public_path__` 推导 —— 运行时读
 *   `document.currentScript.src`，把目录部分当成 publicPath。所以只要主文件放在
 *   `docs/public/demo/vendor/`，懒加载的 `lark-doc.umd.min.mermaid.js` 就会被请求成
 *   `./vendor/lark-doc.umd.min.mermaid.js`。只拷主文件 = 图表 / 公式 / 代码高亮 /
 *   Word 导入 / 编辑器浮层全部 404（表现为「图表渲染不出来、且刷新也不恢复」）。
 *
 * 因此本脚本做三件事：
 *   1. 从主 UMD 源码里解析出 webpack 的 chunk 映射表（`.u = function(e){ return "前缀" + {id:"名字"}[e] + ".js" }`），
 *      逐个断言 dist/ 里确实存在 —— 这样「产物新增了一个 chunk 而 vendor 没跟上」会在同步时就报错，
 *      而不是等到用户打开 demo 页看空图表。
 *   2. 把主文件 + 全部 chunk + 样式 + 字体全量拷过去，并清掉 dist 里已经不存在的旧 chunk
 *      （产物文件名不带 hash，旧 chunk 不删会一直躺着）。
 *   3. 写 `vendor/VERSION`，页面右上角用它显示版本号。
 *
 * 不挂在 prebuild / CI 上：改 package.json 或 workflow 都会影响发版链路，
 * 发版后手动跑一次、随发版 commit 提交即可。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(repoRoot, 'dist')
const VENDOR = path.join(repoRoot, 'docs/public/demo/vendor')

const argv = new Set(process.argv.slice(2))
const CHECK = argv.has('--check')
const QUIET = argv.has('--quiet')

/** 产物分块命名：lark-doc.umd.min.js / lark-doc.umd.min.mermaid.js / lark-doc-element.umd.min.office.js */
const BUNDLE_RE = /^lark-doc(?:-element)?\.umd\.min(?:\.[a-z0-9-]+)?\.js$/
/**
 * 按需区块自己还有样式（KaTeX）。webpack 的 `miniCssF` 会给它们取带 hash 的文件名，
 * 同样是「相对主文件」请求，漏拷就是公式变成裸字符。这里按 webpack 的命名习惯收：
 * `math.b46342c1.css` / `vendor.css` 之类。
 */
const CHUNK_CSS_RE = /^[a-z][a-z0-9-]*(?:\.[0-9a-f]{8,})?\.css$/
/** 两个入口主文件，缺任何一个都不算构建完成 */
const ENTRY_FILES = ['lark-doc.umd.min.js', 'lark-doc-element.umd.min.js']
/** 非 JS 的配套资源 */
const ASSET_FILES = ['lark-doc.css']
/** Demo 页另需的运行时，不来自 dist，只在缺失时兜底拷一次 */
const RUNTIME_FILES = ['vue.min.js']

const errors = []
const warnings = []
const done = []

/** 当前包版本，main() 里从 package.json 读入 */
let VERSION = ''

function fail(message) {
  errors.push(message)
}

function warn(message) {
  warnings.push(message)
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function statSize(file) {
  try {
    return fs.statSync(file).size
  } catch {
    return -1
  }
}

/**
 * 从 UMD 产物里解析 webpack 的 chunk 映射。
 * 形如：.u=function(e){return"lark-doc.umd.min."+{21:"highlight",304:"mermaid"}[e]+".js"}
 */
function readChunkMap(source) {
  const matched = source.match(
    /\.u\s*=\s*function\s*\([^)]*\)\s*\{\s*return\s*"([^"]*)"\s*\+\s*\{([^}]+)\}\s*\[[^\]]+\]\s*\+\s*"([^"]*)"/,
  )
  if (!matched) return { prefix: '', suffix: '.js', names: [] }
  const names = [...matched[2].matchAll(/"([^"]+)"\s*:/g)].map((item) => item[1])
  return { prefix: matched[1], suffix: matched[3], names }
}

/** dist/ 里本轮应该出现在 vendor 的全部文件名（不含字体与 VERSION） */
function collectDistFiles() {
  const names = new Set()
  for (const name of fs.readdirSync(DIST)) {
    if (BUNDLE_RE.test(name) || ASSET_FILES.includes(name) || CHUNK_CSS_RE.test(name)) names.add(name)
  }
  return names
}

/**
 * 按需区块的样式表名。webpack 会生成
 *   .miniCssF = function(e){ return "math.b46342c1.css" }
 * 或 map 形态 `.miniCssF=function(e){return{149:"math.x.css"}[e]}`，两种都收。
 */
function readChunkCss(source) {
  const matched = source.match(/\.miniCssF\s*=\s*function\s*\([^)]*\)\s*\{\s*return\s*([^}]*)\}/)
  if (!matched) return []
  return [...matched[1].matchAll(/"([^"]+\.css)"/g)].map((item) => item[1])
}

/** 解析每个入口的 chunk 表（JS + 按需 CSS），返回运行时一定会请求的文件名 */
function collectRequiredChunks(entryFiles) {
  const required = new Map() // 文件名 → 触发它的入口
  for (const entry of entryFiles) {
    const file = path.join(DIST, entry)
    if (!fs.existsSync(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    const map = readChunkMap(source)
    for (const name of map.names) {
      const chunk = `${map.prefix}${name}${map.suffix}`
      if (!required.has(chunk)) required.set(chunk, entry)
    }
    for (const name of readChunkCss(source)) {
      if (!required.has(name)) required.set(name, entry)
    }
  }
  return required
}

function checkVersionStamp() {
  const stampFile = path.join(VENDOR, 'VERSION')
  if (!fs.existsSync(stampFile)) {
    fail(`缺少 ${path.relative(repoRoot, stampFile)}`)
    return
  }
  const stamped = fs.readFileSync(stampFile, 'utf8').trim()
  if (stamped !== VERSION) fail(`vendor/VERSION 是 ${stamped || '(空)'}，package.json 是 ${VERSION}`)
}

function checkRuntime() {
  for (const name of RUNTIME_FILES) {
    if (!fs.existsSync(path.join(VENDOR, name))) {
      warn(`vendor/${name} 不存在，Demo 页需要它；可从 node_modules/vue/dist/${name} 手工放一份`)
    }
  }
}

function checkFiles(expected, requiredChunks, distFiles) {
  for (const name of expected) {
    const from = path.join(DIST, name)
    const to = path.join(VENDOR, name)
    const distSize = statSize(from)
    const vendorSize = statSize(to)
    if (vendorSize < 0) {
      fail(`vendor/${name} 缺失（dist 里 ${fmt(distSize)}）`)
      continue
    }
    if (vendorSize !== distSize) {
      fail(`vendor/${name} 与 dist 不一致：${fmt(vendorSize)} vs ${fmt(distSize)}`)
    }
  }
  for (const [chunk, entry] of requiredChunks) {
    if (!distFiles.has(chunk)) fail(`dist/${chunk} 不存在，但 ${entry} 运行时会请求它（构建不完整？）`)
  }
  for (const name of fs.existsSync(VENDOR) ? fs.readdirSync(VENDOR) : []) {
    if (!BUNDLE_RE.test(name) && !CHUNK_CSS_RE.test(name)) continue
    if (!expected.includes(name)) fail(`vendor/${name} 是陈旧产物，dist 里已没有它`)
  }
}

function copyIfChanged(from, to) {
  const fromSize = statSize(from)
  if (fromSize < 0) return false
  if (statSize(to) === fromSize) return false
  fs.copyFileSync(from, to)
  return true
}

function syncFiles(expected) {
  for (const name of expected) {
    const changed = copyIfChanged(path.join(DIST, name), path.join(VENDOR, name))
    done.push({ name, size: statSize(path.join(DIST, name)), changed })
  }
}

function pruneStale(expected) {
  for (const name of fs.readdirSync(VENDOR)) {
    if (!BUNDLE_RE.test(name) && !CHUNK_CSS_RE.test(name)) continue
    if (expected.includes(name)) continue
    fs.rmSync(path.join(VENDOR, name))
    done.push({ name, size: 0, changed: true, removed: true })
  }
}

function syncFonts() {
  const from = path.join(DIST, 'fonts')
  if (!fs.existsSync(from)) {
    warn('dist/fonts 不存在，公式字体可能 404（lark-doc.css 里有 ./fonts/ 引用）')
    return
  }
  const to = path.join(VENDOR, 'fonts')
  fs.mkdirSync(to, { recursive: true })
  let copied = 0
  for (const name of fs.readdirSync(from)) {
    const source = path.join(from, name)
    if (!fs.statSync(source).isFile()) continue
    if (copyIfChanged(source, path.join(to, name))) copied += 1
  }
  if (copied > 0) done.push({ name: `fonts/ × ${copied}`, size: 0, changed: true })
}

function syncRuntime() {
  for (const name of RUNTIME_FILES) {
    const target = path.join(VENDOR, name)
    if (fs.existsSync(target)) continue
    const candidates = [
      path.join(repoRoot, 'node_modules/vue/dist', name),
      path.join(repoRoot, 'node_modules/vue/dist/vue.runtime.min.js'),
    ]
    const source = candidates.find((file) => fs.existsSync(file))
    if (!source) {
      warn(`找不到 ${name}，请手工放一份到 docs/public/demo/vendor/`)
      continue
    }
    fs.copyFileSync(source, target)
    done.push({ name, size: statSize(target), changed: true })
  }
}

function writeVersionStamp() {
  const stampFile = path.join(VENDOR, 'VERSION')
  const current = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : ''
  if (current === VERSION) return
  fs.writeFileSync(stampFile, `${VERSION}\n`)
  done.push({ name: 'VERSION', size: `${VERSION}`.length, changed: true })
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  VERSION = pkg.version
  const version = VERSION

  if (!fs.existsSync(DIST)) {
    console.error('FAIL：缺少 dist/。先跑 `npm run build` 与 `npm run build:element`。')
    process.exit(1)
  }

  const distFiles = collectDistFiles()
  for (const entry of ENTRY_FILES) {
    if (!distFiles.has(entry)) fail(`dist/${entry} 不存在，构建产物不完整`)
  }
  const presentEntries = ENTRY_FILES.filter((entry) => distFiles.has(entry))
  const requiredChunks = collectRequiredChunks(presentEntries)
  for (const [chunk, entry] of requiredChunks) {
    if (!distFiles.has(chunk)) fail(`dist/${chunk} 不存在，但 ${entry} 运行时会请求它（构建不完整？）`)
  }

  // 主文件排在前面，chunk 按名字排序，输出稳定
  const expected = [...distFiles].sort((a, b) => {
    const rank = (name) => (ENTRY_FILES.includes(name) ? 0 : ASSET_FILES.includes(name) ? 1 : 2)
    return rank(a) - rank(b) || a.localeCompare(b)
  })

  if (CHECK) {
    if (errors.length === 0) {
      checkVersionStamp()
      checkFiles(expected, requiredChunks, distFiles)
      checkRuntime()
    }
  } else {
    fs.mkdirSync(VENDOR, { recursive: true })
    pruneStale(expected)
    syncFiles(expected)
    syncFonts()
    syncRuntime()
    if (errors.length === 0) writeVersionStamp()
  }

  const label = CHECK ? '校验' : '同步'
  if (!QUIET && !CHECK) {
    for (const item of done) {
      const mark = item.removed ? 'DEL' : item.changed ? ' OK' : ' --'
      const size = item.removed ? '-' : item.size > 0 ? fmt(item.size) : '-'
      console.log(`  ${mark}  ${item.name.padEnd(38)} ${size}`)
    }
  }

  if (warnings.length > 0) {
    for (const message of warnings) console.warn(`WARN：${message}`)
  }

  if (errors.length > 0) {
    console.error(`\n${label}失败（${errors.length} 项）：`)
    for (const message of errors) console.error(`  - ${message}`)
    process.exit(1)
  }

  const unchanged = done.filter((item) => !item.changed).length
  console.log(
    CHECK
      ? `OK：vendor 与 dist 一致（v${version}，${expected.length} 个文件，${requiredChunks.size} 个按需分块）`
      : `OK：已同步 v${version} → docs/public/demo/vendor/（${expected.length} 个文件，${requiredChunks.size} 个按需分块，${unchanged} 个未变）`,
  )
}

main()
