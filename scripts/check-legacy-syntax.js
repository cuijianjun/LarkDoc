'use strict'

/**
 * 「webpack 4 只要一行 alias」的语法闸门。
 *
 * 背景：0.13 删掉了 package.json 的 `browser` 字段（它一旦存在，webpack4/5 会跳过
 * ESM、直落 UMD 的「浏览器直挂档」，于是 SSR 与浏览器吃到两份不同产物）。删掉之后
 * webpack4 会顺着 mainFields 落到 `module` → `esm.js`，而 esm.js 里有 `import.meta`，
 * acorn 6.4.2 解析不了 —— 文档于是承诺「一行 alias 指到 CJS 档」。
 *
 * 这条承诺成立的前提是：**CJS 档本身也得是 ES2018 语法**。否则 alias 过去照样
 * `Module parse failed`，宿主还得回头挂 babel，文档的「一行配置」就成空话了。
 *
 * 所以这里用 acorn 以 ecmaVersion 2018 真实解析两份「给老打包器吃」的产物：
 *   - dist/lark-doc.common.js            （webpack4 主入口：alias 指到这里；Node 也是它）
 *   - dist/lark-doc-element.umd.min.js   （`<script>` 直挂 / CDN / 无 Vue 宿主；
 *                                          阶段 3 起兼任原 UMD 档职责，UMD 单档已退场）
 *
 * esm.js 不在这里 —— 它面向认 `exports` 的现代打包器，保留 ES2020+ 是刻意的。
 *
 * 用法：node scripts/check-legacy-syntax.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

/** ecmaVersion 2018 + script：等价于 webpack 4（acorn 6.4.x）的解析能力。 */
const TARGETS = [
  { file: 'dist/lark-doc.common.js', label: 'CJS（webpack4 alias 目标 / Node require）' },
  { file: 'dist/lark-doc-element.umd.min.js', label: 'Element UMD（无 Vue 宿主 / CDN 直挂）' }
]

let acorn
try {
  acorn = require('acorn')
} catch (e) {
  console.error('缺少 acorn（devDependency），无法校验产物语法等级：', e.message)
  process.exit(1)
}

/** webpack 4 用的是 acorn 6，Node ecological 默认给的是 8；两者对 ecmaVersion 的语义一致。 */
const OPTIONS = { ecmaVersion: 2018, sourceType: 'script', allowReturnOutsideFunction: true }

const failures = []

for (const target of TARGETS) {
  const abs = path.join(ROOT, target.file)
  if (!fs.existsSync(abs)) {
    failures.push(`${target.file}（${target.label}）缺失 —— 先跑 npm run build*`)
    continue
  }
  const src = fs.readFileSync(abs, 'utf8')
  try {
    acorn.parse(src, OPTIONS)
    console.log(`  ✓ ES2018 可解析  ${target.file}  ${(src.length / 1024 / 1024).toFixed(2)} MB`)
  } catch (err) {
    failures.push(
      `${target.file}（${target.label}）不是 ES2018：${
        err && err.message ? err.message : String(err)
      } @ ${err && err.loc ? `${err.loc.line}:${err.loc.column}` : '未知位置'}`
    )
  }
}

if (failures.length) {
  console.error(`\n✗ 产物语法等级检查失败 ${failures.length}/${TARGETS.length}`)
  for (const line of failures) console.error(`  - ${line}`)
  console.error(
    '\n修法：这三份产物的构建脚本要带 LARK_DOC_LEGACY=1（见 package.json 的 build / build:umd / build:element、' +
      'babel.config.js 与 legacy-syntax.js），降级后才满足 webpack 4 的 acorn。'
  )
  process.exit(1)
}

console.log(`✓ 产物语法等级检查通过（${TARGETS.length} 份均为 ES2018，acorn ${require('acorn/package.json').version}）`)
