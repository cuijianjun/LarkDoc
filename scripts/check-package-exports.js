#!/usr/bin/env node
/**
 * 包契约闸门：npm 包对外声明的每一个落点，都必须在打包后真实存在。
 *
 * 为什么需要它：
 *   package.json 的 `exports` / `main` / `unpkg` / `files` 是一份「对宿主的承诺」，
 *   但 JSON 里写一个不存在的路径不会有任何报错 —— 宿主会在 `import` 时才炸，
 *   而那通常是另一台机器、另一条 CI。0.12 之前 `browser` 字段指向 UMD，导致
 *   webpack4/5 与 vite 拿到的是「浏览器直挂档」而不是 ESM，坑了很久才定位。
 *   本闸门把这些「声明与产物不一致」提前到 `npm run check` 阶段。
 *
 * 检查项：
 *   E1  exports 里每个叶子路径（含 `*` 通配的目录）在磁盘上存在
 *   E2  main / module / unpkg / jsdelivr / style 落点存在
 *   E3  files 里声明的每个条目存在
 *   E4  不得再有 `browser` 字段（阶段 1-A 摘掉；它会让打包器跳过 ESM 走 UMD）
 *   E5  sideEffects 不得出现 `dist/*` 这种一网打尽的写法（会让 tree-shaking 全废）
 *   E6  exports 必须保留 `./package.json` 逃生口（工具链读元信息的标准做法）
 *   E7  PENDING 清单里的子入口一旦产出就必须从清单移除（清单只减不增）
 *
 * 关于 PENDING：
 *   `exports` 提前声明了还没产出的子入口（`./lite` / `./features/*` / `./plugin`），
 *   目的是让宿主从今天起就能看到契约的终点、不用等三个大阶段后才改文档。
 *   这些落点在对应阶段（4 / 6 / 7）产出前磁盘上不存在，直接报错会挡住 CI；
 *   所以用一个显式清单把它们标成「待产出」。**清单只减不增**：一旦文件真的被
 *   构建出来，闸门就报错逼你把它从清单里删掉 —— 防止「声明了却永远没人兑现」。
 *
 * 用法：node scripts/check-package-exports.js
 */

'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const errors = []
const notes = []

/**
 * 已声明但尚未产出的子入口：`subpath glob` → 兑现它的阶段。
 * 见文件头的「关于 PENDING」。**只减不增。**
 */
const PENDING = {
  './dist/plugin.mjs': '阶段 6',
  './dist/plugin.cjs': '阶段 6',
}

const exists = (rel) => {
  if (!rel || typeof rel !== 'string') return false
  return fs.existsSync(path.join(ROOT, rel.replace(/^\.\//, '')))
}

/** 展开 exports 的叶子：条件对象递归取值，字符串即叶子 */
function leaves(node, trail) {
  if (node === null || node === undefined) return
  if (typeof node === 'string') {
    trail.push(node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item) => leaves(item, trail))
    return
  }
  if (typeof node === 'object') {
    for (const key of Object.keys(node)) leaves(node[key], trail)
  }
}

/* ---------- E1 exports 落点存在 ---------- */
const exportLeaves = []
leaves(pkg.exports, exportLeaves)
const pendingKeys = Object.keys(PENDING)
for (const leaf of exportLeaves) {
  // E7：清单里的条目一旦产出，就必须从清单移除（否则永远得不到「契约已兑现」的信号）
  if (pendingKeys.includes(leaf) && exists(leaf)) {
    errors.push(
      `E7 PENDING 清单里的 "${leaf}" 已经产出，请从 scripts/check-package-exports.js 的\n` +
        `     PENDING 常量中删除该条目（清单只减不增，防止「声明了却没人兑现」）。`
    )
    continue
  }
  if (pendingKeys.includes(leaf)) {
    notes.push(`  · 待产出 ${leaf}（${PENDING[leaf]}）`)
    continue
  }
  if (leaf.includes('*')) {
    // `./dist/*` 这类通配：只能校验目录存在（具体文件名由宿主决定）
    const dir = leaf.replace(/^\.\//, '').split('*')[0].replace(/\/$/, '')
    if (!dir || !fs.existsSync(path.join(ROOT, dir))) {
      errors.push(`E1 exports 通配 "${leaf}" 指向的目录不存在：${dir || '(空)'}`)
    } else {
      notes.push(`  · exports 通配 ${leaf} → 目录 ${dir} 存在`)
    }
    continue
  }
  if (!exists(leaf)) errors.push(`E1 exports 落点不存在：${leaf}`)
}

/* ---------- E2 顶层入口字段 ---------- */
for (const field of ['main', 'module', 'unpkg', 'jsdelivr', 'style']) {
  if (field in pkg && !exists(pkg[field])) {
    errors.push(`E2 package.json 的 "${field}" 指向不存在：${pkg[field]}`)
  }
}

/* ---------- E3 files ---------- */
for (const entry of pkg.files || []) {
  if (entry.includes('*')) continue
  if (!exists(entry)) errors.push(`E3 files 里声明的 "${entry}" 不存在`)
}

/* ---------- E4 browser 字段必须消失 ---------- */
if ('browser' in pkg) {
  errors.push(
    'E4 不得声明 "browser" 字段：它会让 webpack4/5 与部分工具跳过 ESM 直接落 UMD，\n' +
      '     宿主拿到的就不是可 tree-shaking 的模块产物（阶段 1-A 已摘，勿复活）。\n' +
      '     SSR 与浏览器应吃同一份产物 —— 需要环境差异请走 exports 的 condition。'
  )
}

/* ---------- E5 sideEffects 不得一网打尽 ---------- */
const sideEffects = pkg.sideEffects
if (Array.isArray(sideEffects)) {
  for (const glob of sideEffects) {
    if (/^(\*\*?|\.\/)?dist\/\*(\.js)?$/.test(glob) || glob === 'dist/*') {
      errors.push(
        `E5 sideEffects 含 "${glob}" —— 这等于宣布 dist 下所有 JS 都有副作用，\n` +
          '     宿主打包器的 tree-shaking 会整体失效。请只列真正有副作用的文件\n' +
          '     （UMD / element 自注册档、CJS 档、CSS / SCSS）。'
      )
    }
  }
}

/* ---------- E6 ./package.json 逃生口 ---------- */
if (!pkg.exports || !('./package.json' in pkg.exports)) {
  errors.push('E6 exports 缺 "./package.json" 逃生口（工具链读元信息会失败）')
}

/* ---------- 输出 ---------- */
const kb = (rel) => {
  try {
    return `${(fs.statSync(path.join(ROOT, rel.replace(/^\.\//, ''))).size / 1024).toFixed(1)} KiB`
  } catch {
    return '?'
  }
}

console.log('\n[包契约] lark-doc@' + pkg.version)
console.log(`  main      ${pkg.main} (${kb(pkg.main)})`)
console.log(`  module    ${pkg.module} (${kb(pkg.module)})`)
console.log(`  unpkg     ${pkg.unpkg} (${kb(pkg.unpkg)})`)
console.log(`  exports   共 ${exportLeaves.length} 个落点`)
for (const n of notes) console.log(n)

if (errors.length) {
  console.error(`\n✗ 包契约校验失败（${errors.length} 项）：`)
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log('✓ 包契约校验通过（exports / main / files / sideEffects 落点全部存在）\n')
