'use strict'

/**
 * Rollup 生成的 CJS / UMD 产物语法闸门。
 *
 * CJS 是传统打包器和 Node require 的兼容入口，UMD 是 CDN / 原生浏览器入口；
 * 两者都必须保持 ES2018 语法，避免 Node14 或 webpack4 acorn 在消费阶段失败。
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
    '\n修法：检查 Rollup 的 legacy / element 输出配置，并确认 CJS / UMD 产物保持 ES2018 语法。'
  )
  process.exit(1)
}

console.log(`✓ 产物语法等级检查通过（${TARGETS.length} 份均为 ES2018，acorn ${require('acorn/package.json').version}）`)
